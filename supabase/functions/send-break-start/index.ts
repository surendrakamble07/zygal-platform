import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char]!,
  );
}

function normalizeBreakEventId(value: unknown): string | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) return null;
    text = String(value);
  } else if (typeof value === "string" && /^\d+$/.test(value)) {
    text = value;
  } else {
    return null;
  }

  if (text.length > 19) return null;

  try {
    const id = BigInt(text);
    if (id <= 0n || id > 9223372036854775807n) return null;
    return id.toString();
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const bearerMatch = authHeader?.match(/^Bearer\s+(\S+)$/i);
    if (!bearerMatch) {
      return json({ error: "Authentication required" }, 401);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON request" }, 400);
    }

    if (
      !body
      || typeof body !== "object"
      || Array.isArray(body)
      || Object.keys(body).length !== 1
      || !Object.prototype.hasOwnProperty.call(body, "break_event_id")
    ) {
      return json({ error: "Request must contain only break_event_id" }, 400);
    }

    const breakEventId = normalizeBreakEventId(
      (body as Record<string, unknown>).break_event_id,
    );
    if (!breakEventId) {
      return json({ error: "Invalid break_event_id" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const adminEmail = Deno.env.get("ADMIN_NOTIFY_EMAIL");
    if (!supabaseUrl || !serviceRoleKey || !resendApiKey || !adminEmail) {
      console.error("Required server secrets are missing");
      return json({ error: "Server configuration error" }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: authError } = await supabase.auth.getUser(
      bearerMatch[1],
    );
    if (authError || !userData.user) {
      return json({ error: "Invalid or expired login session" }, 401);
    }

    const userId = userData.user.id;
    const { data: breakEvent, error: breakError } = await supabase
      .from("break_events")
      .select("id, user_id, break_type, started_at, planned_minutes, start_remark, ended_at")
      .eq("id", breakEventId)
      .eq("user_id", userId)
      .maybeSingle();

    if (breakError) {
      console.error("Break lookup failed:", breakError.message);
      return json({ error: "Could not verify break event" }, 500);
    }
    if (!breakEvent) {
      return json({ error: "Break event not found for this employee" }, 404);
    }
    if (breakEvent.ended_at !== null) {
      return json({ error: "Break event has already ended" }, 409);
    }
    if (breakEvent.break_type !== "Lunch" && breakEvent.break_type !== "Tea") {
      return json({ error: "Break event has an invalid break type" }, 400);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      console.error("Profile lookup failed:", profileError.message);
      return json({ error: "Could not verify employee profile" }, 500);
    }
    if (!profile) {
      return json({ error: "Employee profile not found" }, 404);
    }

    const fullName = profile.full_name?.trim() || "Employee";
    const subjectName = fullName.replace(/[\r\n]+/g, " ");
    const startedAt = new Date(breakEvent.started_at);
    if (!Number.isFinite(startedAt.getTime())) {
      return json({ error: "Break event has an invalid start time" }, 500);
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Zygal Platform <onboarding@resend.dev>",
        to: [adminEmail],
        subject: `Employee Started ${breakEvent.break_type} Break – ${subjectName}`,
        html: `
          <h2>Employee Started a Break</h2>
          <p><strong>Employee:</strong> ${escapeHtml(fullName)}</p>
          <p><strong>Break Type:</strong> ${escapeHtml(breakEvent.break_type)}</p>
          <p><strong>Started At:</strong> ${escapeHtml(startedAt.toISOString())}</p>
          <p><strong>Planned Duration:</strong> ${breakEvent.planned_minutes} minutes</p>
          <p><strong>Remark:</strong> ${escapeHtml(breakEvent.start_remark?.trim() || "")}</p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const resendError = await emailResponse.text();
      console.error("Resend email failed:", resendError);
      return json({ error: "Break started, but the admin email could not be sent" }, 502);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Unexpected function error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
