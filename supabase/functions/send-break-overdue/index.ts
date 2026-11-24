import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@^9";

interface ClaimedBreak {
  break_event_id: number | string;
  claim_token: string;
  recipient_email: string | null;
  break_type: string;
  started_at: string;
  planned_minutes: number;
}

interface Counts {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function isClaimedBreak(value: unknown): value is ClaimedBreak {
  if (!isRecord(value)) return false;

  return normalizeBreakEventId(value.break_event_id) !== null
    && isUuid(value.claim_token)
    && (value.recipient_email === null
      || typeof value.recipient_email === "string")
    && (value.break_type === "Lunch" || value.break_type === "Tea")
    && typeof value.started_at === "string"
    && Number.isFinite(new Date(value.started_at).getTime())
    && typeof value.planned_minutes === "number"
    && Number.isInteger(value.planned_minutes)
    && value.planned_minutes > 0;
}

function isValidEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

async function secretMatches(expected: string, supplied: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [expectedDigest, suppliedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
  ]);

  const expectedBytes = new Uint8Array(expectedDigest);
  const suppliedBytes = new Uint8Array(suppliedDigest);

  let difference = 0;
  for (let i = 0; i < expectedBytes.length; i++) {
    difference |= expectedBytes[i] ^ suppliedBytes[i];
  }

  return difference === 0;
}

function recipientMatches(value: unknown, recipient: string): boolean {
  if (typeof value === "string") {
    return value.toLowerCase() === recipient.toLowerCase();
  }

  if (isRecord(value) && typeof value.address === "string") {
    return value.address.toLowerCase() === recipient.toLowerCase();
  }

  return false;
}

async function parseEmptyJsonObject(req: Request): Promise<boolean> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return false;

  const bodyText = await req.text();
  if (bodyText.length > 1024) return false;

  let body: unknown;
  try {
    body = JSON.parse(bodyText);
  } catch {
    return false;
  }

  return isRecord(body) && Object.keys(body).length === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("OVERDUE_CRON_SECRET");
  if (!expectedSecret || expectedSecret.length < 32) {
    console.error("send-break-overdue scheduler secret is not configured");
    return json({ error: "Server configuration error" }, 500);
  }

  const suppliedSecret = req.headers.get("x-cron-secret");
  if (!suppliedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let isAuthorized = false;
  try {
    isAuthorized = await secretMatches(expectedSecret, suppliedSecret);
  } catch {
    console.error("send-break-overdue scheduler authentication failed");
    return json({ error: "Unauthorized" }, 401);
  }

  if (!isAuthorized) {
    return json({ error: "Unauthorized" }, 401);
  }

  let hasEmptyBody = false;
  try {
    hasEmptyBody = await parseEmptyJsonObject(req);
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  if (!hasEmptyBody) {
    return json({ error: "Request body must be an empty JSON object" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const smtpHost = Deno.env.get("SMTP_HOST")?.trim().toLowerCase();
  const smtpPort = Number(Deno.env.get("SMTP_PORT"));
  const smtpUser = Deno.env.get("SMTP_USER")?.trim();
  const smtpPass = Deno.env.get("SMTP_PASS");
  const smtpFrom = Deno.env.get("SMTP_FROM")?.trim();
  const adminEmail = Deno.env.get("ADMIN_NOTIFY_EMAIL")?.trim() ?? "";

  if (
    !supabaseUrl
    || !serviceRoleKey
    || smtpHost !== "smtp.gmail.com"
    || smtpPort !== 465
    || !smtpUser
    || !smtpPass
    || !smtpFrom
    || smtpFrom.toLowerCase() !== smtpUser.toLowerCase()
  ) {
    console.error("send-break-overdue is missing required server configuration");
    return json({ error: "Server configuration error" }, 500);
  }

  const counts: Counts = { claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: 465,
    secure: true,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 15_000,
  });

  try {
    const { data: claimedData, error: claimError } = await supabase.rpc(
      "claim_due_break_overdue_notifications",
      { p_limit: 20 },
    );

    if (claimError || !Array.isArray(claimedData)) {
      console.error("Could not claim overdue notifications");
      return json({ error: "Could not prepare overdue notifications" }, 500);
    }

    if (!claimedData.every(isClaimedBreak)) {
      console.error("Overdue-notification claim returned invalid data");
      return json({ error: "Could not prepare overdue notifications" }, 500);
    }

    const claimedBreaks = claimedData;
    counts.claimed = claimedBreaks.length;

    for (const claimedBreak of claimedBreaks) {
      const breakEventId = normalizeBreakEventId(claimedBreak.break_event_id);
      if (!breakEventId) {
        console.error("Overdue-notification claim returned an invalid event ID");
        counts.skipped++;
        continue;
      }

      const recipient = claimedBreak.recipient_email?.trim() ?? "";
      let employeeDeliverySucceeded = false;
      let employeeDeliveryError = "";
      const startedAt = new Date(claimedBreak.started_at);
      const overdueByMinutes = Math.max(
        0,
        (Date.now()
          - (startedAt.getTime() + claimedBreak.planned_minutes * 60_000))
          / 60_000,
      );

      let fullName = "Employee";
      try {
        const { data: breakEvent, error: breakError } = await supabase
          .from("break_events")
          .select("user_id")
          .eq("id", breakEventId)
          .maybeSingle();

        if (breakError || !breakEvent) {
          console.error("Could not find employee for overdue break notification");
        } else {
          const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("full_name")
            .eq("id", breakEvent.user_id)
            .maybeSingle();
          if (profileError || !profile) {
            console.error("Could not fetch employee name for overdue notification");
          } else {
            fullName = profile.full_name?.trim() || "Employee";
          }
        }
      } catch {
        console.error("Could not fetch employee name for overdue notification");
      }

      if (!isValidEmail(recipient)) {
        employeeDeliveryError = "Employee email address is missing or invalid.";
      } else {
        try {
          const info = await transporter.sendMail({
            from: smtpFrom,
            to: recipient,
            subject: `Your ${claimedBreak.break_type} break is overdue`,
            text:
              `Your ${claimedBreak.break_type} break has exceeded its planned duration. `
              + "Please update your break status in ZYGAL Team Operations.",
          });
          employeeDeliverySucceeded = Array.isArray(info.accepted)
            && info.accepted.some((address: unknown) =>
              recipientMatches(address, recipient)
            );
          if (!employeeDeliverySucceeded) {
            employeeDeliveryError = "SMTP did not accept the employee email.";
          }
        } catch {
          employeeDeliveryError = "SMTP failed to send the employee email.";
          console.error("Overdue employee email delivery failed");
        }
      }

      if (!adminEmail) {
        console.error("Overdue employee email was attempted, but ADMIN_NOTIFY_EMAIL is not configured");
      } else {
        try {
          const subjectName = fullName.replace(/[\r\n]+/g, " ");
          const info = await transporter.sendMail({
            from: smtpFrom,
            to: adminEmail,
            subject: `Overdue ${claimedBreak.break_type} Break Alert – ${subjectName}`,
            text: [
              `Employee: ${fullName}`,
              `Break Type: ${claimedBreak.break_type}`,
              `Started At: ${startedAt.toISOString()}`,
              `Planned Duration: ${claimedBreak.planned_minutes} minutes`,
              `Overdue By: ${overdueByMinutes.toFixed(1)} minutes`,
            ].join("\n"),
          });
          const adminAccepted = Array.isArray(info.accepted)
            && info.accepted.some((address: unknown) =>
              recipientMatches(address, adminEmail)
            );
          if (!adminAccepted) {
            console.error("SMTP did not accept the overdue admin email");
          }
        } catch {
          console.error("Overdue employee email was attempted, but the admin copy failed");
        }
      }

      if (employeeDeliverySucceeded) {
        const { data: markedSent, error: markSentError } = await supabase.rpc(
          "mark_break_overdue_notification_sent",
          {
            break_event_id: breakEventId,
            claim_token: claimedBreak.claim_token,
          },
        );
        if (markSentError || markedSent !== true) {
          console.error("Employee overdue email was accepted, but sent status could not be recorded");
          counts.failed++;
        } else {
          counts.sent++;
        }
      } else {
        const { data: markedFailed, error: markFailedError } = await supabase.rpc(
          "mark_break_overdue_notification_failed",
          {
            break_event_id: breakEventId,
            claim_token: claimedBreak.claim_token,
            error_text: employeeDeliveryError,
          },
        );
        if (markFailedError || markedFailed !== true) {
          console.error("Could not record failed employee overdue email");
          counts.skipped++;
        } else {
          counts.failed++;
        }
      }
    }

    return json({ counts });
  } catch {
    console.error("Unexpected send-break-overdue failure");
    return json({ error: "Internal server error", counts }, 500);
  } finally {
    try {
      transporter.close();
    } catch {
      console.error("Could not close the send-break-overdue SMTP transport");
    }
  }
});
