import { toast } from "@heroui/react";

// One chokepoint for user-facing notifications, so the rest of the app never
// touches the toast library directly (swap it here, not in 20 call sites) and so
// failures stop being silent — every caught error should pass through here.

/**
 * Extract a human-readable detail line from any thrown value. Pure (no toast
 * runtime) so it can be unit-tested. The API client throws Errors whose message
 * already reads well, e.g. "This CLI connection has been revoked (HTTP 401)".
 */
export function errorDetail(err: unknown): string | undefined {
  if (err instanceof Error) return err.message || undefined;
  if (typeof err === "string") return err || undefined;
  return undefined;
}

/**
 * Show a non-blocking error toast. `summary` says what failed in plain terms
 * (e.g. "Couldn't save the paper"); the underlying error message, if any, goes
 * in the description. The raw error is also logged for debugging.
 */
export function notifyError(summary: string, err?: unknown): void {
  if (err !== undefined) console.error(summary, err);
  const description = errorDetail(err);
  toast.danger(summary, description ? { description } : undefined);
}

/** Show a brief success toast. */
export function notifySuccess(summary: string): void {
  toast.success(summary);
}
