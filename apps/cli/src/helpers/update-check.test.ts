import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { VERSION } from "../version.js";
import {
  UPDATE_INTERVAL_MS,
  SELF_UPDATE_ARGV,
  autoUpdateEnabled,
  dueForCheck,
  isAutoUpdateWorker,
  loadUpdateState,
  saveUpdateState,
  announceAutoUpdate,
} from "./update-check.js";

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
