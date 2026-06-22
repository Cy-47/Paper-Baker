import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { VERSION } from "../version.js";
import { fetchLatestTag } from "./release.js";
import {
  UPDATE_INTERVAL_MS,
  SELF_UPDATE_ARGV,
  autoUpdateEnabled,
  dueForCheck,
  isAutoUpdateWorker,
  launchAutoUpdate,
  loadUpdateState,
  saveUpdateState,
  announceAutoUpdate,
} from "./update-check.js";

// launchAutoUpdate re-spawns this binary as a detached worker. Stub the spawn so
// we can assert HOW it launches without starting a process, and force the host
// gates (packaged + signing) on so the spawn path is reached.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));
vi.mock("./release.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./release.js")>()),
  isPackaged: () => true,
  // The foreground launcher now does one lightweight tag lookup to decide
  // whether to announce an available update; default it to a clearly-newer tag
  // so the spawn path is reached, and override per-test for the other cases.
  fetchLatestTag: vi.fn(async () => "v9.9.9"),
}));
vi.mock("./signature.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./signature.js")>()),
  signingConfigured: () => true,
}));

// Hermetic: redirect the global config dir at a tmp dir so the update-state file
// (update.json) never touches the real ~/ config. The env override is read at
// call time, so setting/clearing it per-test is enough.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-update-"));
  process.env["PAPERBAKER_CONFIG_DIR"] = dir;
  delete process.env["PAPERBAKER_QUIET"];
});

afterEach(() => {
  delete process.env["PAPERBAKER_CONFIG_DIR"];
  delete process.env["PAPERBAKER_QUIET"];
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("dueForCheck", () => {
  it("is due when never checked before", () => {
    expect(dueForCheck({}, 1_000_000)).toBe(true);
  });

  it("is not due before the interval elapses", () => {
    const now = 10 * UPDATE_INTERVAL_MS;
    expect(dueForCheck({ lastCheckedMs: now - 1 }, now)).toBe(false);
  });

  it("is due once the interval has elapsed (inclusive boundary)", () => {
    const now = 10 * UPDATE_INTERVAL_MS;
    expect(dueForCheck({ lastCheckedMs: now - UPDATE_INTERVAL_MS }, now)).toBe(true);
  });
});

describe("autoUpdateEnabled", () => {
  const ok = {
    packaged: true,
    signingConfigured: true,
    endpointsOverridden: false,
    envDisabled: false,
    configDisabled: false,
  };

  it("is enabled for a packaged, signed install with no opt-out (all platforms)", () => {
    expect(autoUpdateEnabled(ok)).toBe(true);
  });

  it("is disabled for dev/npm installs (not packaged)", () => {
    expect(autoUpdateEnabled({ ...ok, packaged: false })).toBe(false);
  });

  it("is disabled when the build has no embedded signing key (fail closed)", () => {
    expect(autoUpdateEnabled({ ...ok, signingConfigured: false })).toBe(false);
  });

  it("is disabled when a release endpoint is overridden (no silent redirect)", () => {
    expect(autoUpdateEnabled({ ...ok, endpointsOverridden: true })).toBe(false);
  });

  it("honors the env opt-out and the config opt-out", () => {
    expect(autoUpdateEnabled({ ...ok, envDisabled: true })).toBe(false);
    expect(autoUpdateEnabled({ ...ok, configDisabled: true })).toBe(false);
  });
});

describe("isAutoUpdateWorker", () => {
  it("is true only for the exact hidden argv we spawn with", () => {
    expect(isAutoUpdateWorker(["node", "pb", SELF_UPDATE_ARGV])).toBe(true);
  });

  it("is false for normal commands (env can't trigger it)", () => {
    expect(isAutoUpdateWorker(["node", "pb", "list"])).toBe(false);
    expect(isAutoUpdateWorker(["node", "pb"])).toBe(false);
    expect(isAutoUpdateWorker(["node", "pb", "add", SELF_UPDATE_ARGV])).toBe(false);
  });
});

describe("update-state storage", () => {
  it("returns empty state when nothing is saved", () => {
    expect(loadUpdateState()).toEqual({});
  });

  it("round-trips a saved state to update.json", () => {
    saveUpdateState({ lastCheckedMs: 123, pendingNoticeVersion: "9.9.9" });
    expect(existsSync(join(dir, "update.json"))).toBe(true);
    expect(loadUpdateState()).toEqual({ lastCheckedMs: 123, pendingNoticeVersion: "9.9.9" });
  });

  it("treats a corrupt state file as empty", () => {
    saveUpdateState({ lastCheckedMs: 1 });
    writeFileSync(join(dir, "update.json"), "{ not json");
    expect(loadUpdateState()).toEqual({});
  });
});

describe("announceAutoUpdate", () => {
  it("announces once when the running version matches the pending notice, then clears it", () => {
    saveUpdateState({ pendingNoticeVersion: VERSION });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    announceAutoUpdate();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0][0]).toContain(`v${VERSION}`);
    expect(loadUpdateState().pendingNoticeVersion).toBeUndefined();

    // Idempotent: a second call says nothing.
    announceAutoUpdate();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("stays silent (and keeps the notice) until the new binary is actually running", () => {
    saveUpdateState({ pendingNoticeVersion: "999.0.0" });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    announceAutoUpdate();
    expect(err).not.toHaveBeenCalled();
    // Notice is preserved for the run that actually executes 999.0.0.
    expect(loadUpdateState().pendingNoticeVersion).toBe("999.0.0");
  });

  it("respects PAPERBAKER_QUIET", () => {
    process.env["PAPERBAKER_QUIET"] = "1";
    saveUpdateState({ pendingNoticeVersion: VERSION });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    announceAutoUpdate();
    expect(err).not.toHaveBeenCalled();
  });

  it("leaves an unrelated state field intact when clearing the notice", () => {
    saveUpdateState({ lastCheckedMs: 42, pendingNoticeVersion: VERSION });
    vi.spyOn(console, "error").mockImplementation(() => {});
    announceAutoUpdate();
    const after = JSON.parse(readFileSync(join(dir, "update.json"), "utf8"));
    expect(after).toEqual({ lastCheckedMs: 42 });
  });
});

describe("launchAutoUpdate", () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.mocked(spawn).mockClear();
    // Default: a clearly-newer tag so the announce+spawn path runs. Clear call
    // history too so per-test "was it fetched?" assertions aren't polluted.
    vi.mocked(fetchLatestTag).mockReset().mockResolvedValue("v9.9.9");
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("clears PKG_EXECPATH and passes only the sentinel so the pkg child boots the app", async () => {
    // Fresh tmp config dir => due; mocked gates => packaged + signed + enabled.
    await launchAutoUpdate();

    expect(spawn).toHaveBeenCalledTimes(1);
    const [, args, opts] = vi.mocked(spawn).mock.calls[0];
    // Regression guard: the worker crashed with MODULE_NOT_FOUND when the child
    // inherited PKG_EXECPATH (pkg "app" mode treats argv[1] as a script path) or
    // when we also passed the entrypoint ourselves (sentinel pushed off argv[2]).
    expect(args).toEqual([SELF_UPDATE_ARGV]);
    expect(opts?.detached).toBe(true);
    expect((opts?.env as NodeJS.ProcessEnv).PKG_EXECPATH).toBe("");
  });

  it("announces the available update to stderr, then spawns the worker", async () => {
    await launchAutoUpdate();
    expect(err).toHaveBeenCalledTimes(1);
    const msg = String(err.mock.calls[0][0]);
    expect(msg).toContain("9.9.9"); // the available version
    expect(msg).toMatch(/background/i); // ...and that it's updating in the background
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("stays silent and does NOT spawn when already on the latest version", async () => {
    vi.mocked(fetchLatestTag).mockResolvedValue(`v${VERSION}`); // not newer than VERSION
    await launchAutoUpdate();
    expect(err).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    // Still stamped, so we don't re-check until the next interval.
    expect(typeof loadUpdateState().lastCheckedMs).toBe("number");
  });

  it("does not fetch or announce under PAPERBAKER_QUIET, but still spawns the worker", async () => {
    process.env["PAPERBAKER_QUIET"] = "1";
    try {
      await launchAutoUpdate();
      expect(fetchLatestTag).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
      expect(spawn).toHaveBeenCalledTimes(1);
    } finally {
      delete process.env["PAPERBAKER_QUIET"];
    }
  });

  it("falls back to a silent spawn when the availability check fails", async () => {
    vi.mocked(fetchLatestTag).mockRejectedValue(new Error("network down"));
    await launchAutoUpdate();
    expect(err).not.toHaveBeenCalled(); // no notice when we couldn't determine availability
    expect(spawn).toHaveBeenCalledTimes(1); // ...but the worker still gets its shot
  });

  it("stamps the check time before spawning (throttles back-to-back commands)", async () => {
    await launchAutoUpdate();
    expect(typeof loadUpdateState().lastCheckedMs).toBe("number");
  });

  it("does not spawn when a check is not yet due", async () => {
    saveUpdateState({ lastCheckedMs: Date.now() });
    await launchAutoUpdate();
    expect(spawn).not.toHaveBeenCalled();
  });

  it("does not spawn when auto-update is disabled via env", async () => {
    process.env["PAPERBAKER_NO_UPDATE"] = "1";
    try {
      await launchAutoUpdate();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      delete process.env["PAPERBAKER_NO_UPDATE"];
    }
  });
});
