export type AvailabilityValue = "Free" | "Busy";

export interface AvailabilityRecord {
  user_id: string;
  status: AvailabilityValue;
  remark: string | null;
  since: string;
  updated_at: string;
}

export const BUSY_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function availabilityLabel(
  status: AvailabilityValue,
  since: string | null | undefined,
  now = Date.now(),
): { label: string; stale: boolean } {
  if (status === "Free") return { label: "Free", stale: false };
  const sinceMs = since ? new Date(since).getTime() : Number.NaN;
  if (!Number.isFinite(sinceMs)) return { label: "Busy", stale: false };

  const elapsedMs = Math.max(0, now - sinceMs);
  if (elapsedMs > BUSY_STALE_AFTER_MS) {
    const hours = Math.floor(elapsedMs / (60 * 60 * 1000));
    return { label: `Busy (stale, ${hours}h ago)`, stale: true };
  }

  return { label: `Busy: ${Math.floor(elapsedMs / 60_000)}m`, stale: false };
}
