// Turns a raw Postgres/PostgREST error into the sentence we told the DB to send,
// or a safe fallback when something else goes wrong.
export function friendlyJobError(err: unknown): string {
  const e = err as { code?: string; message?: string } | null;
  const msg = e?.message ?? "";

  // Our own trigger messages (raised with specific SQLSTATE codes) come through as-is.
  if (e?.code === "23514" && msg) return msg;
  if (e?.code === "42501" && msg) return msg;

  if (e?.code === "23505")
    return "This already exists. Check for a duplicate entry.";
  if (e?.code === "23503")
    return "One of the values picked is no longer valid. Reload the page and try again.";
  if (e?.code === "42501") return "You do not have permission to do this.";
  return "Could not save. Please try again.";
}
