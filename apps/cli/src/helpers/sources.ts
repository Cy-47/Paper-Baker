import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { type PaperMetadata, sourceDirName } from "@paper-baker/core";
import { PROJECT_DIR, getProjectDir } from "../config.js";

// `sourceDirName` is defined in core (shared with the generated README); re-export
// it so existing `./sources.js` importers keep working.
export { sourceDirName };

// ---------------------------------------------------------------------------
// Tex sources live in `paperbaker/sources/` — inside the VISIBLE project dir
// (not a hidden dot-dir) and not gitignored — so coding-agent search tools
// (ripgrep, and everything built on it) can grep the paper text directly.
//
// To keep that bulky, re-downloadable content out of the host repo's history,
// `paperbaker/sources/` is its own nested git repo. The nested `.git` "seals"
// the directory: a `git add -A` in the host repo can stage at most a gitlink,
// never the tex files themselves, so the host history stays clean (the rest of
// `paperbaker/` — config, manifest, bib — is still parent-trackable). The
// initial commit gives the nested repo a checked-out HEAD, so `git add -A`
// doesn't error on an uncommitted submodule. The tex is never committed into
// the nested repo — it's a boundary only, and the content is reproducible via
// `sync`.
// ---------------------------------------------------------------------------

const SOURCES_SUBDIR = "sources";

/** Project-root-relative path to the sources dir, for display ("paperbaker/sources"). */
export const SOURCES_REL = `${PROJECT_DIR}/${SOURCES_SUBDIR}`;

export function getSourcesRoot(cwd?: string): string {
  return path.join(getProjectDir(cwd), SOURCES_SUBDIR);
}

export function getSourceDir(paper: PaperMetadata, cwd?: string): string {
  return path.join(getSourcesRoot(cwd), sourceDirName(paper));
}

function git(args: string[], cwd: string): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

/**
 * Ensure `paperbaker/sources/` exists and is its own git repo. Idempotent. If
 * git isn't available the directory is still created (so sources stay
 * searchable); it just won't have the sealing boundary against `git add`.
 */
export function ensureSourcesRepo(cwd?: string): void {
  const root = getSourcesRoot(cwd);
  fs.mkdirSync(root, { recursive: true });

  if (fs.existsSync(path.join(root, ".git"))) return;

  try {
    git(["init", "-q"], root);
    // Explicit identity + disabled gpg signing so this never depends on, or
    // writes to, the user's global git config.
    git(
      [
        "-c", "user.email=paperbaker@localhost",
        "-c", "user.name=Paper Baker",
        "-c", "commit.gpgsign=false",
        "commit", "-q", "--allow-empty", "-m", "Initialize Paper Baker sources",
      ],
      root,
    );
  } catch {
    // git unavailable — the plain directory is left in place. Sources remain
    // searchable; they just aren't sealed from the host repo's `git add`.
  }
}
