import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Authentication required" }, 401);
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
    const token = authHeader.slice("Bearer ".length);

    const { data: userData, error: authError } =
      await supabase.auth.getUser(token);

    if (authError || !userData.user) {
      return json({ error: "Invalid or expired login session" }, 401);
    }

    const userId = userData.user.id;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, email, role, is_active")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.error("Profile lookup failed:", profileError.message);
      return json({ error: "Could not verify employee profile" }, 500);
    }

    if (!profile || !profile.is_active) {
      return json({ error: "Active employee account required" }, 403);
    }

    let body: { message?: unknown };

    try {
      body = await req.json();
    } catch {
      return json({ error: "Invalid JSON request" }, 400);
    }

    if (typeof body.message !== "string") {
      return json({ error: "Feedback message is required" }, 400);
    }

    const message = body.message.trim();

    if (!message || message.length > 2000) {
      return json({ error: "Feedback must contain 1 to 2000 characters" }, 400);
    }

    // Save feedback against the authenticated employee's profile.
    const { data: feedback, error: insertError } = await supabase
      .from("feedback")
      .insert({
        user_id: userId,
        message,
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("Feedback insert failed:", insertError.message);
      return json({ error: "Could not save feedback" }, 500);
    }

    const safeName = escapeHtml(profile.full_name || "Employee");
    const safeEmail = escapeHtml(profile.email || userData.user.email || "");
    const safeMessage = escapeHtml(message).replace(/\n/g, "<br>");

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Zygal Platform <onboarding@resend.dev>",
        to: [adminEmail],
        subject: "New Feedback - Zygal Platform",
        html: `
          <h2>New Employee Feedback</h2>
          <p><strong>Employee:</strong> ${safeName}</p>
          <p><strong>Email:</strong> ${safeEmail}</p>
          <p><strong>Feedback:</strong></p>
          <p>${safeMessage}</p>
          <p><strong>Feedback ID:</strong> ${feedback.id}</p>
        `,
      }),
    });

    if (!emailResponse.ok) {
      const resendError = await emailResponse.text();
      console.error("Resend email failed:", resendError);

      return json(
        {
          success: false,
          feedback_saved: true,
          notification_sent: false,
          message: "Feedback saved, but email notification failed.",
        },
        502,
      );
    }

    return json({
      success: true,
      feedback_saved: true,
      notification_sent: true,
    });
  } catch (error) {
    console.error("Unexpected function error:", error);
    return json({ error: "Internal server error" }, 500);
  }
});
