import type { PaperMetadata } from "@paper-baker/core";

// ---------------------------------------------------------------------------
// Pure reconciliation between a local papers.json and a remote project manifest,
// used by `pb project bind`. Kept free of I/O so it's exhaustively unit-tested;
// the command layer handles the actual API calls and file writes.
// ---------------------------------------------------------------------------

export type BindMode = "merge" | "replace-local";

export interface Reconciliation {
  /** What papers.json should hold after binding. */
  local: PaperMetadata[];
  /** Local-only papers to push up to the remote (merge mode only). */
  toPushToRemote: PaperMetadata[];
}

/**
 * Reconcile local papers against the remote set.
 * - `replace-local`: remote wins entirely; nothing is pushed up.
 * - `merge`: union by paperId with the server winning on a shared id; local-only
 *   papers are reported for pushing back to the remote.
 */
export function reconcilePapers(
  local: PaperMetadata[],
  remote: PaperMetadata[],
  mode: BindMode,
): Reconciliation {
  if (mode === "replace-local") {
    return { local: remote, toPushToRemote: [] };
  }

  const remoteIds = new Set(remote.map((p) => p.paperId));
  const localOnly = local.filter((p) => !remoteIds.has(p.paperId));
  return {
    local: [...remote, ...localOnly],
    toPushToRemote: localOnly,
  };
}

/**
 * The reconciliation mode that can be chosen without asking the user, or `null`
 * when local and remote genuinely diverge and the caller must prompt (TTY) or
 * hard-error (CI).
 *
 * An empty local folder — a fresh checkout, or a re-bind after `rm -rf
 * paperbaker/` — has nothing to merge or lose, so it adopts the remote outright
 * rather than presenting a no-op merge/replace choice.
 */
export function autoBindMode(
  local: PaperMetadata[],
  remote: PaperMetadata[],
): BindMode | null {
  if (local.length === 0 || papersInSync(local, remote)) return "replace-local";
  return null;
}

/** True when local and remote hold the same set of paperIds (metadata aside). */
export function papersInSync(
  local: PaperMetadata[],
  remote: PaperMetadata[],
): boolean {
  if (local.length !== remote.length) return false;
  const remoteIds = new Set(remote.map((p) => p.paperId));
  return local.every((p) => remoteIds.has(p.paperId));
}
