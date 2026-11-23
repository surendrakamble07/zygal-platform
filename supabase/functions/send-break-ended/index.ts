import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@^9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface BreakEndClaim {
  claimed: boolean;
  notification_status: string;
  break_event_id: number | string;
  user_id: string;
  recipient_email: string | null;
  break_type: string;
  started_at: string;
  ended_at: string | null;
  planned_minutes: number;
  attempt_count: number;
  claim_token: string | null;
  last_error: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function isBreakEndClaim(value: unknown): value is BreakEndClaim {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.claimed === "boolean"
    && typeof row.notification_status === "string"
    && (typeof row.break_event_id === "number" || typeof row.break_event_id === "string")
    && typeof row.user_id === "string"
    && (row.recipient_email === null || typeof row.recipient_email === "string")
    && typeof row.break_type === "string"
    && typeof row.started_at === "string"
    && (row.ended_at === null || typeof row.ended_at === "string")
    && typeof row.planned_minutes === "number"
    && typeof row.attempt_count === "number"
    && (row.claim_token === null || typeof row.claim_token === "string")
    && (row.last_error === null || typeof row.last_error === "string");
}

function recipientMatches(value: unknown, recipient: string): boolean {
  if (typeof value === "string") {
    return value.toLowerCase() === recipient.toLowerCase();
  }
  if (value && typeof value === "object" && "address" in value) {
    const address = value.address;
    return typeof address === "string"
      && address.toLowerCase() === recipient.toLowerCase();
  }
  return false;
}

function getSmtpResponseCode(error: unknown): number | null {
  if (
    !error
    || typeof error !== "object"
    || !("responseCode" in error)
    || typeof error.responseCode !== "number"
  ) {
    return null;
  }
  return error.responseCode;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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
  const smtpHost = Deno.env.get("SMTP_HOST");
  const smtpPort = Number(Deno.env.get("SMTP_PORT"));
  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = Deno.env.get("SMTP_PASS");
  const smtpFrom = Deno.env.get("SMTP_FROM");
  if (
    !supabaseUrl
    || !serviceRoleKey
    || !smtpHost
    || !Number.isInteger(smtpPort)
    || smtpPort <= 0
    || smtpPort > 65535
    || !smtpUser
    || !smtpPass
    || !smtpFrom
  ) {
    console.error("send-break-ended is missing required server configuration");
    return json({ error: "Server configuration error" }, 500);
  }

  try {
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data: userData, error: authError } = await supabase.auth.getUser(
      bearerMatch[1],
    );
    if (authError || !userData.user) {
      return json({ error: "Invalid or expired login session" }, 401);
    }

    const userId = userData.user.id;
    const { data, error: claimError } = await supabase.rpc(
      "claim_break_end_notification",
      {
        p_break_event_id: breakEventId,
        p_user_id: userId,
      },
    );

    if (claimError) {
      if (claimError.code === "42501") {
        return json({ error: "Break event is not eligible for notification" }, 403);
      }
      console.error("Break-end notification claim failed");
      return json({ error: "Could not prepare break-end notification" }, 500);
    }

    const claimRows: unknown = data;
    if (
      !Array.isArray(claimRows)
      || claimRows.length !== 1
      || !isBreakEndClaim(claimRows[0])
    ) {
      console.error("Break-end notification claim returned an invalid result");
      return json({ error: "Could not prepare break-end notification" }, 500);
    }
    const claim = claimRows[0];
    const claimedEventId = normalizeBreakEventId(claim.break_event_id);
    if (claimedEventId !== breakEventId || claim.user_id !== userId) {
      console.error("Break-end notification claim ownership check failed");
      return json({ error: "Could not verify break-event ownership" }, 500);
    }

    if (!claim.claimed) {
      if (claim.notification_status === "sent") {
        return json({ success: true, status: "sent", already_sent: true });
      }
      if (claim.notification_status === "sending") {
        return json(
          { success: true, status: "sending", already_in_progress: true },
          202,
        );
      }
      if (claim.notification_status === "failed") {
        return json(
          {
            error: "Notification could not be claimed. Verify the employee email and retry.",
            status: "failed",
          },
          409,
        );
      }
      return json(
        { error: "Notification is not currently eligible to send", status: claim.notification_status },
        409,
      );
    }

    const claimToken = claim.claim_token;
    if (!claimToken) {
      console.error("Claimed break-end notification has no claim token");
      return json({ error: "Could not prepare break-end notification" }, 500);
    }

    const recordFailure = async (reason: string): Promise<boolean> => {
      const { data: failed, error } = await supabase.rpc(
        "mark_break_end_notification_failed",
        {
          p_break_event_id: breakEventId,
          p_user_id: userId,
          p_claim_token: claimToken,
          p_error: reason,
        },
      );
      if (error || failed !== true) {
        console.error("Could not record break-end notification failure");
        return false;
      }
      return true;
    };

    const recipient = claim.recipient_email?.trim() ?? "";
    const startedAt = new Date(claim.started_at);
    const endedAt = claim.ended_at ? new Date(claim.ended_at) : null;
    if (
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)
      || (claim.break_type !== "Lunch" && claim.break_type !== "Tea")
      || !Number.isInteger(claim.planned_minutes)
      || claim.planned_minutes <= 0
      || !Number.isFinite(startedAt.getTime())
      || !endedAt
      || !Number.isFinite(endedAt.getTime())
    ) {
      await recordFailure("Claimed notification data is incomplete or invalid.");
      return json({ error: "Break notification data is incomplete or invalid" }, 500);
    }

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: true,
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
    });

    let deliveryStatus: "accepted" | "rejected" | "uncertain" = "uncertain";
    try {
      const info = await transporter.sendMail({
        from: smtpFrom,
        to: recipient,
        subject: `Your ${claim.break_type} break has ended`,
        text: [
          `Your ${claim.break_type} break has ended.`,
          "",
          `Started: ${startedAt.toISOString()}`,
          `Ended: ${endedAt.toISOString()}`,
          `Planned duration: ${claim.planned_minutes} minutes`,
        ].join("\n"),
      });
      const accepted = Array.isArray(info.accepted)
        && info.accepted.some((address: unknown) => recipientMatches(address, recipient));
      const rejected = Array.isArray(info.rejected)
        && info.rejected.some((address: unknown) => recipientMatches(address, recipient));
      if (accepted) {
        deliveryStatus = "accepted";
      } else if (rejected) {
        deliveryStatus = "rejected";
      }
    } catch (error) {
      const responseCode = getSmtpResponseCode(error);
      if (responseCode !== null && responseCode >= 400 && responseCode < 600) {
        deliveryStatus = "rejected";
      } else {
        console.error("SMTP delivery outcome is uncertain");
      }
    } finally {
      try {
        transporter.close();
      } catch {
        console.error("Could not close SMTP transport");
      }
    }

    if (deliveryStatus === "uncertain") {
      return json(
        {
          error: "Email delivery outcome is uncertain; notification remains in sending state for manual recovery",
          status: "sending",
        },
        502,
      );
    }

    if (deliveryStatus === "rejected") {
      const failureRecorded = await recordFailure("SMTP server rejected email delivery.");
      if (!failureRecorded) {
        return json(
          {
            error: "SMTP rejected the email, but notification status could not be updated",
            status: "sending",
          },
          502,
        );
      }
      return json(
        { error: "SMTP server rejected email delivery; the notification may be retried", status: "failed" },
        502,
      );
    }

    const { data: markedSent, error: markSentError } = await supabase.rpc(
      "mark_break_end_notification_sent",
      {
        p_break_event_id: breakEventId,
        p_user_id: userId,
        p_claim_token: claimToken,
      },
    );
    if (markSentError || markedSent !== true) {
      console.error("Email was accepted, but its sent status could not be recorded");
      return json(
        { error: "Email was accepted, but notification status could not be recorded" },
        502,
      );
    }

    return json({ success: true, status: "sent" });
  } catch {
    console.error("Unexpected send-break-ended failure");
    return json({ error: "Internal server error" }, 500);
  }
});
