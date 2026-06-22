import {
  loadProjectConfig,
  saveProjectConfig,
} from "../config.js";
import { VERSION } from "../version.js";
import { loadPapers, rebuildArtifacts } from "./project-files.js";
import { refreshRootBrief } from "./root-brief.js";

// ---------------------------------------------------------------------------
// Post-upgrade docs refresh.
//
// The text of every generated file — paperbaker/README.md, refs.bib, and the
// root AGENTS.md/CLAUDE.md brief — is baked into the binary (via @paper-baker/core
// templates). A `pb update` swaps the binary but never rewrites those files, so a
// project keeps showing the OLD release's docs until something regenerates them.
//
// This closes that gap: after any in-project command, if the version that last
// generated the docs lags the running binary, regenerate them all from the new
// templates and re-stamp `docsVersion`. It's gated on that stamp, so on an
// unchanged binary it's a single config read and nothing else — cheap enough to
// run after every command. It's purely local (no server, no auth), so offline and
// signed-out projects get refreshed too.
// ---------------------------------------------------------------------------

/**
 * Regenerate derived docs when the binary has changed since they were last
 * written. No-op when there's no project here, or the stamp already matches the
 * running version. Best-effort by contract — callers ignore failures.
 */
export function refreshDocsIfStale(cwd?: string): boolean {
  const cfg = loadProjectConfig(cwd);
  if (!cfg) return false;
  if (cfg.docsVersion === VERSION) return false;

  rebuildArtifacts(loadPapers(cwd), cwd);
  refreshRootBrief(cwd);
  // Re-read: a concurrent server auto-sync may have rewritten config.json with a
  // fresh name/id while we worked. Stamp onto the latest, not our stale copy.
  const latest = loadProjectConfig(cwd) ?? cfg;
  saveProjectConfig({ ...latest, docsVersion: VERSION }, cwd);
  return true;
}
