import * as fs from "node:fs";
import * as path from "node:path";
import {
  ROOT_BRIEF_BEGIN,
  ROOT_BRIEF_END,
  generateRootBrief,
} from "@paper-baker/core";
import { loadProjectConfig, saveProjectConfig } from "../config.js";
import { isInteractive, promptLine } from "./prompt.js";

// The brief's text lives in @paper-baker/core so the CLI (which writes it) and
// the web docs page (which previews it) share one source of truth. Re-export the
// pieces other CLI modules import from here.
export { ROOT_BRIEF_BEGIN, ROOT_BRIEF_END, generateRootBrief };

// ---------------------------------------------------------------------------
// Root agent brief.
//
// The full per-project guide lives in `paperbaker/README.md`, but a guide buried
// in a subdirectory isn't auto-loaded by coding agents: the AGENTS.md/CLAUDE.md
// convention prioritizes the file at the REPO ROOT. So on `pb project create` /
// `pb project bind` we drop a short, clearly-delimited block into the root agent
// file pointing at the papers — once, idempotently, and only with the user's
// (implicit) consent.
//
// "Once" is enforced two ways: a `rootBrief` flag in the project config records
// that we've already decided (so deleting the block by hand doesn't make us
// re-add it on the next command), and the BEGIN/END markers stop a second copy
// from ever being appended. See DESIGN.md §5.2.
// ---------------------------------------------------------------------------

// Candidate root agent-instruction files, in priority order. AGENTS.md is the
// cross-tool standard (Codex, Cursor, Zed, …) and the root-prioritized
// convention; CLAUDE.md is Claude Code's native auto-loaded file. We append to
// whichever already exists, else create AGENTS.md.
const ROOT_AGENT_FILES = ["AGENTS.md", "CLAUDE.md"] as const;

/** Absolute path to the root agent file we'd write: first existing, else AGENTS.md. */
export function resolveRootAgentFile(cwd?: string): { file: string; name: string; existed: boolean } {
  const root = cwd ?? process.cwd();
  for (const name of ROOT_AGENT_FILES) {
    const file = path.join(root, name);
    if (fs.existsSync(file)) return { file, name, existed: true };
  }
  const name = ROOT_AGENT_FILES[0];
  return { file: path.join(root, name), name, existed: false };
}

/**
 * Write the brief into the resolved root agent file. Idempotent: if the block is
 * already present, leaves the file untouched. Appends (with a separating blank
 * line) to an existing file, or creates a fresh one.
 */
export function writeRootBrief(cwd?: string): { file: string; name: string; status: "added" | "present" } {
  const { file, name, existed } = resolveRootAgentFile(cwd);
  const existing = existed ? fs.readFileSync(file, "utf-8") : "";
  if (existing.includes(ROOT_BRIEF_BEGIN)) {
    return { file, name, status: "present" };
  }

  const block = generateRootBrief();
  const next = existing
    ? existing.replace(/\n*$/, "") + "\n\n" + block
    : block;
  fs.writeFileSync(file, next);
  return { file, name, status: "added" };
}

/**
 * Refresh an already-injected brief in place: swap the content between the
 * BEGIN/END markers for the running binary's `generateRootBrief()` output. Used
 * by the post-upgrade docs refresh so an existing brief tracks template changes.
 *
 * Deliberately conservative — it only ever touches a block that's already there:
 *   - `declined` projects, or any project with no marked block, are left alone
 *     (we never inject a brief the user didn't ask for during a refresh).
 *   - text outside the markers is untouched; only the managed block is replaced.
 */
export function refreshRootBrief(cwd?: string): { status: "refreshed" | "unchanged" | "absent" } {
  const cfg = loadProjectConfig(cwd);
  if (cfg?.rootBrief === "declined") return { status: "absent" };

  const { file, existed } = resolveRootAgentFile(cwd);
  if (!existed) return { status: "absent" };

  const existing = fs.readFileSync(file, "utf-8");
  const begin = existing.indexOf(ROOT_BRIEF_BEGIN);
  const endMarker = existing.indexOf(ROOT_BRIEF_END);
  if (begin === -1 || endMarker === -1 || endMarker < begin) return { status: "absent" };

  // Replace BEGIN..END inclusive; keep whatever precedes/follows verbatim. The
  // generator's block carries a trailing newline we drop here, since `after`
  // already retains the original spacing after the END marker.
  const before = existing.slice(0, begin);
  const after = existing.slice(endMarker + ROOT_BRIEF_END.length);
  const next = before + generateRootBrief().trimEnd() + after;
  if (next === existing) return { status: "unchanged" };

  fs.writeFileSync(file, next);
  return { status: "refreshed" };
}

export type RootBriefDecision = "added" | "declined" | "already-decided";

/**
 * Decide-and-apply, run once per project from create/bind. Honors a prior
 * decision recorded in the config, the `disabled` opt (the `--no-brief` flag),
 * and — in a TTY — a yes/no prompt. Outside a TTY it injects silently (the block
 * is clearly marked and removable), so agent/CI runs still get the pointer.
 */
export async function applyRootBrief(opts: {
  cwd?: string;
  disabled?: boolean;
}): Promise<{ decision: RootBriefDecision; file?: string; name?: string }> {
  const cfg = loadProjectConfig(opts.cwd);
  if (!cfg) return { decision: "already-decided" };
  if (cfg.rootBrief) return { decision: "already-decided" };

  if (opts.disabled) {
    saveProjectConfig({ ...cfg, rootBrief: "declined" }, opts.cwd);
    return { decision: "declined" };
  }

  const { name } = resolveRootAgentFile(opts.cwd);
  if (isInteractive()) {
    const ans = (await promptLine(`Add a Paper Baker brief to ${name}? [Y/n]: `)).toLowerCase();
    if (ans === "n" || ans === "no") {
      saveProjectConfig({ ...cfg, rootBrief: "declined" }, opts.cwd);
      return { decision: "declined" };
    }
  }

  const { file, name: written } = writeRootBrief(opts.cwd);
  saveProjectConfig({ ...cfg, rootBrief: "added" }, opts.cwd);
  return { decision: "added", file, name: written };
}
