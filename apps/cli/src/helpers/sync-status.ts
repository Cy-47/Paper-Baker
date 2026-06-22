import { ApiError } from "@paper-baker/api-client";

// ---------------------------------------------------------------------------
// Classify a failure from a project-scoped server call (add/remove a paper, read
// the manifest) into the guidance the user sees.
//
// The backend returns the SAME 404 "Project not found" whether the bound project
// doesn't exist or the caller simply isn't a member — that existence-hiding is
// enforced in firestore.rules (a non-member can't tell absent from forbidden), so
// the CLI inherits the ambiguity rather than trying to resolve it. We therefore
// never probe (getProject/listProjects would 404 the same way); we classify from
// the single failed call and word the message to cover both cases.
// ---------------------------------------------------------------------------

export type SyncFailure = "no-access" | "auth" | "transient";

export function classifyProjectSyncError(err: unknown): SyncFailure {
  if (err instanceof ApiError) {
    if (err.status === 401) return "auth";
    // 404 "Project not found" = not a member, or it no longer exists. In `add`,
    // resolvePaper runs first, so a 404 from addPaperToProject is never an
    // uncached paper ("Paper not found"); the message guard keeps the two apart.
    if (err.status === 404 && /Project not found/i.test(err.message)) {
      return "no-access";
    }
  }
  return "transient";
}

/**
 * Actionable, multi-line guidance for a deferred sync, routed to stderr by
 * callers. `lead` is the command-specific opener ("Added locally, but not
 * synced", "Couldn't sync", …); the rest is shared across add/remove/sync.
 */
export function syncFailureMessage(failure: SyncFailure, lead: string): string {
  switch (failure) {
    case "no-access":
      return [
        `${lead} — the project this directory is bound to doesn't exist, or you`,
        "don't have access to it. To sync your changes, do one of the following:",
        "  • If you should have access, ask the owner to invite you, then run `pb sync`.",
        "  • pb unbind && pb sync   — start your own copy on your account.",
        "  • pb bind <handle/id>    — switch to one of your projects (see `pb project list`).",
      ].join("\n");
    case "auth":
      return `${lead} — you're not signed in or this CLI connection was revoked. Run \`pb login\`, then \`pb sync\`.`;
    case "transient":
      return `${lead} — couldn't reach the server. Run \`pb sync\` to retry.`;
  }
}
