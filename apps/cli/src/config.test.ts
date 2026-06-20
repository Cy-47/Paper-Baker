import { mkdtempSync, rmSync, statSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { loadGlobalConfig, saveGlobalConfig, getApiUrl } from "./config.js";

// Hermetic: PAPERBAKER_CONFIG_DIR redirects the global config at a tmp dir, so
// these never touch the real ~/ config. The env overrides are read at call
// time, so setting/clearing them per-test is enough.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-config-"));
  process.env["PAPERBAKER_CONFIG_DIR"] = dir;
  delete process.env["PAPERBAKER_TOKEN"];
  delete process.env["PAPERBAKER_API_URL"];
});

afterEach(() => {
  delete process.env["PAPERBAKER_CONFIG_DIR"];
  delete process.env["PAPERBAKER_TOKEN"];
  delete process.env["PAPERBAKER_API_URL"];
  rmSync(dir, { recursive: true, force: true });
});

describe("global config storage", () => {
  it("returns empty config when nothing is saved", () => {
    expect(loadGlobalConfig()).toEqual({});
  });

  it("round-trips a saved access token", () => {
    saveGlobalConfig({ accessToken: "pbk.conn.secret" });
    expect(loadGlobalConfig().accessToken).toBe("pbk.conn.secret");
  });

  it.skipIf(process.platform === "win32")(
    "writes the credential file owner-only (0600) in an owner-only dir (0700)",
    () => {
      saveGlobalConfig({ accessToken: "pbk.conn.secret" });
      const file = join(dir, "config.json");
      expect(existsSync(file)).toBe(true);
      // Low 9 permission bits: file rw------- , dir rwx------.
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(dir).mode & 0o777).toBe(0o700);
    },
  );

  it("re-saving keeps the file owner-only", () => {
    saveGlobalConfig({ accessToken: "first" });
    saveGlobalConfig({ accessToken: "second" });
    if (process.platform !== "win32") {
      expect(statSync(join(dir, "config.json")).mode & 0o777).toBe(0o600);
    }
    expect(loadGlobalConfig().accessToken).toBe("second");
  });
});

describe("API URL resolution", () => {
  it("defaults when nothing is configured", () => {
    expect(getApiUrl()).toBe("https://paper-baker.web.app/api");
  });

  it("uses the config file value", () => {
    saveGlobalConfig({ apiUrl: "https://example.test" });
    expect(getApiUrl()).toBe("https://example.test");
  });

  it("PAPERBAKER_API_URL overrides the file", () => {
    saveGlobalConfig({ apiUrl: "https://example.test" });
    process.env["PAPERBAKER_API_URL"] = "https://override.test";
    expect(getApiUrl()).toBe("https://override.test");
  });
});
