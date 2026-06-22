import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { getGlobalConfigDir, loadGlobalConfig } from "../config.js";
import { VERSION } from "../version.js";
import { downloadAndSwap, fetchLatestTag, isNewer, normalizeVersion, isPackaged } from "./release.js";
import { signingConfigured } from "./signature.js";

// ---------------------------------------------------------------------------
// Background auto-update.
//
// `pb` is agent-facing — no human is reading stdout to act on an "update
// available" nudge — so being out of date should fix itself. After a command,
// at most once every UPDATE_INTERVAL_MS, a detached worker checks GitHub and, if
// a newer release exists, downloads + atomically swaps the binary. The current
// command never waits on it (the running process keeps its old inode anyway); the
// NEXT invocation runs the new binary and announces the swap once.
//
// Mirrors the best-effort auto-sync hook in index.ts: silent, errors swallowed,
// never changes a command's outcome. Opt out with `pb update --auto off`
// (persisted) or PAPERBAKER_NO_UPDATE=1 (per-invocation).
// ---------------------------------------------------------------------------

/** How long to wait between background update checks. */
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours

/**
 * Hidden argv that re-enters the binary as the background update worker. Using a
 * sentinel ARGUMENT (not an env var) means an ambient/poisoned environment can't
 * silently turn every `pb <command>` into a no-op worker run — the worker is only
 * entered when WE spawn the child with this exact arg.
 */
export const SELF_UPDATE_ARGV = "__self-update";

interface UpdateState {
  /** Epoch ms of the last background check; throttles the next one. */
  lastCheckedMs?: number;
  /** Version a worker just installed, awaiting a one-time notice on next run. */
  pendingNoticeVersion?: string;
}

function statePath(): string {
  return path.join(getGlobalConfigDir(), "update.json");
}

export function loadUpdateState(): UpdateState {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf-8")) as UpdateState;
  } catch {
    return {};
  }
}

export function saveUpdateState(state: UpdateState): void {
  const dir = getGlobalConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2) + "\n");
}

/** Env vars that redirect where releases are fetched from (test/dev hooks). */
export const ENDPOINT_OVERRIDES = [
  "PAPERBAKER_RELEASE_REPO",
  "PAPERBAKER_GITHUB_API",
  "PAPERBAKER_GITHUB_DOWNLOAD",
] as const;

/**
 * Whether auto-update is permitted on this host. Pure so the gating is testable
 * without a packaged binary. It is off when:
 *  - not packaged (dev/npm installs can't self-swap)
 *  - the build has no embedded signing key (we'd only ever fail closed at verify)
 *  - a release endpoint/repo env override is set (don't let a poisoned env
 *    silently redirect a SILENT background update to an attacker's server —
 *    overrides remain usable for the explicit, human-run `pb update`)
 *  - disabled via env (PAPERBAKER_NO_UPDATE) or config (autoUpdate: false)
 *
 * Windows IS included: the swap works there (swapBinary renames the live .exe
 * aside), and a background update faces the same OS checks as the install path
 * (same bytes, same source, no Mark-of-the-Web), so if install works, update
 * works. validate-before-swap prevents a bricked state if AV ever interferes.
 */
export function autoUpdateEnabled(opts: {
  packaged: boolean;
  signingConfigured: boolean;
  endpointsOverridden: boolean;
  envDisabled: boolean;
  configDisabled: boolean;
}): boolean {
  if (!opts.packaged) return false;
  if (!opts.signingConfigured) return false;
  if (opts.endpointsOverridden) return false;
  if (opts.envDisabled) return false;
  if (opts.configDisabled) return false;
  return true;
}

/** Has enough time passed since the last check to run another one? */
export function dueForCheck(
  state: UpdateState,
  nowMs: number,
  intervalMs: number = UPDATE_INTERVAL_MS,
): boolean {
  if (state.lastCheckedMs === undefined) return true;
  return nowMs - state.lastCheckedMs >= intervalMs;
}

/** Compose the pure predicate from the real host/env/config. */
function autoUpdateEnabledHere(): boolean {
  return autoUpdateEnabled({
    packaged: isPackaged(),
    signingConfigured: signingConfigured(),
    endpointsOverridden: ENDPOINT_OVERRIDES.some((k) => Boolean(process.env[k])),
    envDisabled: Boolean(process.env["PAPERBAKER_NO_UPDATE"]),
    configDisabled: loadGlobalConfig().autoUpdate === false,
  });
}

export function isAutoUpdateWorker(argv: string[] = process.argv): boolean {
  return argv[2] === SELF_UPDATE_ARGV;
}

/**
 * Foreground: if a background worker recently installed a new version (and we're
 * now running it), print a single notice to stderr — never stdout, so `--json`
 * stays clean — and clear the flag so it shows only once.
 */
export function announceAutoUpdate(): void {
  if (process.env["PAPERBAKER_QUIET"]) return;
  const state = loadUpdateState();
  if (!state.pendingNoticeVersion) return;
  // Only announce once we're actually executing the new binary; an older process
  // that started before the swap will leave the notice for the next run.
  if (state.pendingNoticeVersion !== VERSION) return;
  console.error(`pb auto-updated to v${VERSION}.`);
  const { pendingNoticeVersion: _done, ...rest } = state;
  saveUpdateState(rest);
}

/** How long the foreground availability check waits before giving up. Kept short
 *  so a slow network can't noticeably delay the command that triggered it. */
export const FOREGROUND_CHECK_TIMEOUT_MS = 3000;

/**
 * Foreground: if eligible and due, stamp the check time, tell the user an update
 * is starting, and spawn a detached, unref'd worker that does the actual
 * download/swap so the current command exits immediately. Best-effort — any
 * failure is swallowed.
 *
 * To say "vX is available" we must actually know it is, so this does one
 * lightweight, short-timeout tag lookup (skipped under PAPERBAKER_QUIET). The
 * heavy download/swap still happens in the detached worker; we never wait on it.
 */
export async function launchAutoUpdate(): Promise<void> {
  try {
    if (!autoUpdateEnabledHere()) return;
    const state = loadUpdateState();
    if (!dueForCheck(state, Date.now())) return;
    // Stamp BEFORE the check/spawn so rapid back-to-back commands don't each fire
    // a worker (and don't hammer GitHub's unauthenticated rate limit).
    saveUpdateState({ ...state, lastCheckedMs: Date.now() });

    // Announce an available update before kicking off the background swap. The
    // notice needs the version, so we look up the latest tag here — short-
    // timeout'd so a stalled network can't hold up the command. If we learn we're
    // already current, there's nothing to do and we skip the worker entirely; if
    // the check fails we stay silent and let the worker try on its own (below).
    if (!process.env["PAPERBAKER_QUIET"]) {
      try {
        const tag = await fetchLatestTag({ timeoutMs: FOREGROUND_CHECK_TIMEOUT_MS });
        if (!isNewer(tag, VERSION)) return;
        console.error(
          `pb ${normalizeVersion(tag)} is available — auto-updating in the background ` +
            `(applies on your next command).`,
        );
      } catch {
        // Couldn't determine availability (offline/slow/rate-limited): no notice,
        // but still give the worker its shot.
      }
    }
    // Spawn a detached worker that outlives this command. Re-spawning a pkg
    // binary as a child of itself needs care. While running, this process has
    // PKG_EXECPATH set to the executable path, which puts pkg's bootstrap in
    // "app" mode: it treats argv[1] as a script path to run. A child that
    // inherits that env therefore tries to load our SELF_UPDATE_ARGV sentinel as
    // a module (MODULE_NOT_FOUND) and crashes before running a single line.
    // Clearing PKG_EXECPATH switches the child to the default mode, where pkg
    // INSERTS the real entrypoint (the in-VFS /snapshot path) at argv[1] itself —
    // so we pass ONLY the sentinel and let it land at argv[2], where
    // isAutoUpdateWorker() looks for it. (Cross-platform; detached + unref lets
    // the worker outlive us.)
    const child = spawn(process.execPath, [SELF_UPDATE_ARGV], {
      detached: true,
      stdio: "ignore",
      // Don't flash a console window for the background worker on Windows.
      windowsHide: true,
      env: { ...process.env, PKG_EXECPATH: "" },
    });
    child.unref();
  } catch {
    // Auto-update is a convenience; never let it disturb the command.
  }
}

/**
 * The detached worker body: fetch the latest tag and, if it's newer than what's
 * running, download + swap it in, then record a pending notice for the next
 * foreground run. Fully silent; all failures are swallowed.
 */
export async function runAutoUpdateWorker(): Promise<void> {
  try {
    if (!isPackaged()) return;
    const tag = await fetchLatestTag();
    // Only move forward to a strictly-newer signed release (downloadAndSwap
    // verifies the signature before swapping).
    if (!isNewer(tag, VERSION)) return;
    await downloadAndSwap(tag);
    saveUpdateState({ ...loadUpdateState(), pendingNoticeVersion: normalizeVersion(tag) });
  } catch {
    // Silent: a failed background update just means we try again next interval.
  }
}
