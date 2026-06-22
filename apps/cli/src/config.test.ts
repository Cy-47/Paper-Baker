import { mkdtempSync, rmSync, statSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import { loadGlobalConfig, saveGlobalConfig, getApiUrl, getProjectDir } from "./config.js";

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

describe("getProjectDir — walk-up resolution", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "pb-proj-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  // realpath both sides via the resolver: macOS tmpdir is a /var → /private/var
  // symlink, and the walk-up returns paths under whatever `start` was passed, so
  // we compare resolver output to resolver output rather than to a raw join.
  it("finds the project from a nested subdirectory (and from inside paperbaker/)", () => {
    const pbDir = join(root, "paperbaker");
    mkdirSync(pbDir, { recursive: true });
    writeFileSync(join(pbDir, "config.json"), "{}");

    const deep = join(root, "src", "deep", "nested");
    mkdirSync(deep, { recursive: true });

    expect(getProjectDir(deep)).toBe(pbDir);
    expect(getProjectDir(root)).toBe(pbDir);
    expect(getProjectDir(pbDir)).toBe(pbDir); // even from inside paperbaker/ itself
  });

  it("falls back to <cwd>/paperbaker when no ancestor project exists", () => {
    const fresh = join(root, "no", "project", "here");
    mkdirSync(fresh, { recursive: true });
    expect(getProjectDir(fresh)).toBe(join(fresh, "paperbaker"));
  });

  it("does not resolve to an ancestor that has paperbaker/ but no config.json (not yet a project)", () => {
    // A scaffold-in-progress (papers.json but no config.json) must not capture a
    // child cwd — create writes config.json last, so resolution stays at <cwd>.
    const half = join(root, "paperbaker");
    mkdirSync(half, { recursive: true });
    writeFileSync(join(half, "papers.json"), "[]");

    const child = join(root, "child");
    mkdirSync(child, { recursive: true });
    expect(getProjectDir(child)).toBe(join(child, "paperbaker"));
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

  it("rejects a non-https PAPERBAKER_API_URL (token would leak in plaintext)", () => {
    process.env["PAPERBAKER_API_URL"] = "http://evil.test";
    expect(() => getApiUrl()).toThrow(/must use https/i);
  });

  it("allows http only for loopback hosts (local dev)", () => {
    process.env["PAPERBAKER_API_URL"] = "http://127.0.0.1:5050/api";
    expect(getApiUrl()).toBe("http://127.0.0.1:5050/api");
    process.env["PAPERBAKER_API_URL"] = "http://localhost:5050/api";
    expect(getApiUrl()).toBe("http://localhost:5050/api");
  });
});
