import { createClient } from "jsr:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@^9";

interface ClaimedBreak {
  claimed_break_event_id: number | string;
  claim_token: string;
  recipient_email: string | null;
  break_type: string;
  started_at: string;
  planned_minutes: number;
}

interface EligibilityResult {
  eligible: boolean;
  recipient_email: string | null;
}

interface Counts {
  stale_recovered: number;
  claimed: number;
  sent: number;
  failed: number;
  uncertain: number;
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

  return normalizeBreakEventId(value.claimed_break_event_id) !== null
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

function isEligibilityResult(value: unknown): value is EligibilityResult {
  if (!isRecord(value)) return false;

  return typeof value.eligible === "boolean"
    && (value.recipient_email === null
      || typeof value.recipient_email === "string");
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

function emptyCounts(): Counts {
  return {
    stale_recovered: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    uncertain: 0,
    skipped: 0,
  };
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

  const counts = emptyCounts();

  let supabase;
  try {
    supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
  } catch {
    console.error("Could not create the send-break-overdue database client");
    return json({ error: "Internal server error" }, 500);
  }

  let transporter: ReturnType<typeof nodemailer.createTransport>;
  try {
    transporter = nodemailer.createTransport({
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
  } catch {
    console.error("Could not create the send-break-overdue SMTP transport");
    return json({ error: "Server configuration error" }, 500);
  }

  try {
    const { data: recoveredCount, error: recoveryError } = await supabase.rpc(
      "mark_stale_break_overdue_notifications_uncertain",
    );

    if (
      recoveryError
      || typeof recoveredCount !== "number"
      || !Number.isInteger(recoveredCount)
      || recoveredCount < 0
    ) {
      console.error("Could not recover stale overdue-notification claims");
      return json({ error: "Could not prepare overdue notifications" }, 500);
    }

    counts.stale_recovered = recoveredCount;

    const { data: claimedData, error: claimError } = await supabase.rpc(
      "claim_due_break_overdue_notifications",
      { p_limit: 1 },
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
      const breakEventId = normalizeBreakEventId(
        claimedBreak.claimed_break_event_id,
      );

      if (!breakEventId) {
        console.error("Overdue-notification claim returned an invalid event ID");
        counts.skipped++;
        continue;
      }

      let eligibilityData: unknown;
      let eligibilityError: unknown;

      try {
        const result = await supabase.rpc(
          "authorize_break_overdue_notification_send",
          {
            p_break_event_id: breakEventId,
            p_claim_token: claimedBreak.claim_token,
          },
        );
        eligibilityData = result.data;
        eligibilityError = result.error;
      } catch {
        console.error("Could not verify overdue-notification eligibility");
        counts.skipped++;
        continue;
      }

      if (eligibilityError || !Array.isArray(eligibilityData)) {
        console.error("Could not verify overdue-notification eligibility");
        counts.skipped++;
        continue;
      }

      if (
        eligibilityData.length !== 1
        || !isEligibilityResult(eligibilityData[0])
      ) {
        console.error("Eligibility check returned invalid data");
        counts.skipped++;
        continue;
      }

      const eligibility = eligibilityData[0];
      if (!eligibility.eligible) {
        counts.skipped++;
        continue;
      }

      const recipient = eligibility.recipient_email?.trim() ?? "";
      if (!isValidEmail(recipient)) {
        console.error("Eligibility check returned an invalid recipient");
        counts.skipped++;
        continue;
      }

      let delivery: "accepted" | "rejected" | "uncertain" = "uncertain";

      try {
        const info = await transporter.sendMail({
          from: smtpFrom,
          to: recipient,
          subject: `Your ${claimedBreak.break_type} break is overdue`,
          text:
            `Your ${claimedBreak.break_type} break has exceeded its planned duration. `
            + "Please update your break status in ZYGAL Team Operations.",
        });

        const accepted = Array.isArray(info.accepted)
          && info.accepted.some((address: unknown) =>
            recipientMatches(address, recipient)
          );
        const rejected = Array.isArray(info.rejected)
          && info.rejected.some((address: unknown) =>
            recipientMatches(address, recipient)
          );

        if (accepted) {
          delivery = "accepted";
        } else if (rejected) {
          delivery = "rejected";
        } else {
          console.error("SMTP returned no confirmed delivery outcome");
        }
      } catch {
        delivery = "uncertain";
        console.error("SMTP delivery outcome is uncertain");
      }

      if (delivery === "accepted") {
        let markedSent = false;

        try {
          const result = await supabase.rpc(
            "mark_break_overdue_notification_sent",
            {
              p_break_event_id: breakEventId,
              p_claim_token: claimedBreak.claim_token,
            },
          );
          markedSent = !result.error && result.data === true;
        } catch {
          console.error("Could not record accepted overdue email");
        }

        if (markedSent) {
          counts.sent++;
        } else {
          console.error("Accepted overdue email status could not be recorded");
          counts.uncertain++;

          try {
            await supabase.rpc(
              "mark_break_overdue_notification_uncertain",
              {
                p_break_event_id: breakEventId,
                p_claim_token: claimedBreak.claim_token,
              },
            );
          } catch {
            console.error("Could not record uncertain overdue email status");
          }
        }

        continue;
      }

      if (delivery === "rejected") {
        let markedFailed = false;

        try {
          const result = await supabase.rpc(
            "mark_break_overdue_notification_failed",
            {
              p_break_event_id: breakEventId,
              p_claim_token: claimedBreak.claim_token,
            },
          );
          markedFailed = !result.error && result.data === true;
        } catch {
          console.error("Could not record rejected overdue email");
        }

        if (markedFailed) {
          counts.failed++;
        } else {
          console.error("Rejected overdue email status could not be recorded");
          counts.uncertain++;

          try {
            await supabase.rpc(
              "mark_break_overdue_notification_uncertain",
              {
                p_break_event_id: breakEventId,
                p_claim_token: claimedBreak.claim_token,
              },
            );
          } catch {
            console.error("Could not record uncertain overdue email status");
          }
        }

        continue;
      }

      counts.uncertain++;

      try {
        const result = await supabase.rpc(
          "mark_break_overdue_notification_uncertain",
          {
            p_break_event_id: breakEventId,
            p_claim_token: claimedBreak.claim_token,
          },
        );

        if (result.error || result.data !== true) {
          console.error("Could not record uncertain overdue email status");
        }
      } catch {
        console.error("Could not record uncertain overdue email status");
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
