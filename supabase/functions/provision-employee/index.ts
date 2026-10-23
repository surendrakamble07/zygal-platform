// Edge Function: provision-employee
// Creates a new employee login (Admin only) and their profile row.
// Runs on the server with the service_role key, which never reaches the browser.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ROLES = ["support", "team_lead", "admin"];
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Not signed in." }, 401);

  // Client bound to the CALLER's own token: used only to check who is calling.
  const callerClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: "Not signed in." }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerProfile } = await admin
    .from("profiles")
    .select("role, is_active")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (!callerProfile?.is_active || callerProfile.role !== "admin") {
    return json({ error: "Only an Admin can add or change employees." }, 403);
  }

  let body: {
    action?: string;
    email?: string;
    full_name?: string;
    role?: string;
    job_title?: string;
    user_id?: string;
    is_active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid request." }, 400);
  }

  // ---- Create a new employee ----
  if (body.action === "create") {
    const email = (body.email ?? "").trim().toLowerCase();
    const fullName = (body.full_name ?? "").trim();
    const role = body.role ?? "support";

    if (!email || !email.includes("@"))
      return json({ error: "Enter a valid email address." }, 400);
    if (!fullName) return json({ error: "Enter the full name." }, 400);
    if (!ALLOWED_ROLES.includes(role))
      return json({ error: "Invalid role." }, 400);

    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true, // they sign in with an OTP code, not a confirmation link
      });
    if (createErr) {
      const msg = createErr.message.includes("already")
        ? "This email is already registered."
        : createErr.message;
      return json({ error: msg }, 400);
    }

    const { error: profileErr } = await admin.from("profiles").insert({
      id: created.user.id,
      email,
      full_name: fullName,
      role,
      job_title: body.job_title?.trim() || null,
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(created.user.id); // don't leave an orphaned login
      return json(
        { error: "Could not save the profile. Please try again." },
        400,
      );
    }

    return json({ ok: true, user_id: created.user.id });
  }

  // ---- Change an existing employee's role or job title ----
  if (body.action === "update") {
    if (!body.user_id) return json({ error: "Missing user." }, 400);
    const patch: Record<string, unknown> = {};
    if (body.role) {
      if (!ALLOWED_ROLES.includes(body.role))
        return json({ error: "Invalid role." }, 400);
      patch.role = body.role;
    }
    if (body.job_title !== undefined)
      patch.job_title = body.job_title?.trim() || null;
    if (body.full_name !== undefined) {
      if (!body.full_name.trim())
        return json({ error: "Name cannot be empty." }, 400);
      patch.full_name = body.full_name.trim();
    }
    const { error } = await admin
      .from("profiles")
      .update(patch)
      .eq("id", body.user_id);
    if (error) return json({ error: "Could not update the employee." }, 400);
    return json({ ok: true });
  }

  // ---- Activate / deactivate (never delete) ----
  if (body.action === "set_active") {
    if (!body.user_id || typeof body.is_active !== "boolean")
      return json({ error: "Missing data." }, 400);
    if (body.user_id === userData.user.id && !body.is_active) {
      return json({ error: "You cannot deactivate your own account." }, 400);
    }
    const { error } = await admin
      .from("profiles")
      .update({ is_active: body.is_active })
      .eq("id", body.user_id);
    if (error) return json({ error: "Could not update the employee." }, 400);
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
});
