const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: corsHeaders },
    );
  }

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    const recipient = Deno.env.get("RESEND_TEST_TO");

    if (!apiKey || !recipient) {
      return Response.json(
        { error: "Required email secrets are missing" },
        { status: 500, headers: corsHeaders },
      );
    }

    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Zygal Testing <onboarding@resend.dev>",
        to: [recipient],
        subject: "Zygal Platform - Test Email",
        html: `
            <h2>Email Test Successful!</h2>
            <p>Resend API is connected to your Zygal Supabase project.</p>
          `,
      }),
    });

    const result = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend error:", result);

      return Response.json(
        { error: "Email sending failed", details: result },
        { status: 502, headers: corsHeaders },
      );
    }

    return Response.json(
      { success: true, message: "Test email sent successfully" },
      { headers: corsHeaders },
    );
  } catch (error) {
    console.error("Function error:", error);

    return Response.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders },
    );
  }
});
