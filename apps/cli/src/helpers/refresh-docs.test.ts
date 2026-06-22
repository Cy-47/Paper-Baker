import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { saveProjectConfig, loadProjectConfig, getProjectDir } from "../config.js";
import { VERSION } from "../version.js";
import { ROOT_BRIEF_BEGIN, ROOT_BRIEF_END } from "./root-brief.js";
import { refreshDocsIfStale } from "./refresh-docs.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-refresh-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("refreshDocsIfStale", () => {
  it("does nothing when there is no project here", () => {
    expect(refreshDocsIfStale(dir)).toBe(false);
  });

  it("is a no-op when the stamp already matches the running binary", () => {
    saveProjectConfig({ name: "Test", docsVersion: VERSION }, dir);
    expect(refreshDocsIfStale(dir)).toBe(false);
    // README isn't (re)created on a no-op pass.
    expect(existsSync(join(getProjectDir(dir), "README.md"))).toBe(false);
  });

  it("regenerates derived docs and stamps the version when stale", () => {
    saveProjectConfig({ name: "Test", docsVersion: "0.0.1-old" }, dir);

    expect(refreshDocsIfStale(dir)).toBe(true);
    expect(existsSync(join(getProjectDir(dir), "README.md"))).toBe(true);
    expect(existsSync(join(getProjectDir(dir), "refs.bib"))).toBe(true);
    expect(loadProjectConfig(dir)?.docsVersion).toBe(VERSION);
  });

  it("treats a project with no stamp as stale (first run after upgrade)", () => {
    saveProjectConfig({ name: "Test" }, dir);
    expect(refreshDocsIfStale(dir)).toBe(true);
    expect(loadProjectConfig(dir)?.docsVersion).toBe(VERSION);
  });

  it("refreshes an existing root brief block as part of the pass", () => {
    saveProjectConfig({ name: "Test", rootBrief: "added", docsVersion: "0.0.1-old" }, dir);
    writeFileSync(
      join(dir, "AGENTS.md"),
      `# Repo\n\n${ROOT_BRIEF_BEGIN}\nOLD STALE TEXT\n${ROOT_BRIEF_END}\n`,
    );

    refreshDocsIfStale(dir);
    const out = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(out).not.toContain("OLD STALE TEXT");
    expect(out).toContain("paperbaker/README.md");
    expect(out).toContain("# Repo");
  });

  it("preserves an existing binding (name/id) when re-stamping", () => {
    saveProjectConfig(
      { name: "Test", stableId: "abc", id: "proj", ownerHandle: "me", docsVersion: "0.0.1-old" },
      dir,
    );
    refreshDocsIfStale(dir);
    const cfg = loadProjectConfig(dir)!;
    expect(cfg.stableId).toBe("abc");
    expect(cfg.id).toBe("proj");
    expect(cfg.ownerHandle).toBe("me");
    expect(cfg.docsVersion).toBe(VERSION);
  });
});
