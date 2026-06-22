import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { saveProjectConfig, loadProjectConfig } from "../config.js";
import {
  ROOT_BRIEF_BEGIN,
  ROOT_BRIEF_END,
  generateRootBrief,
  resolveRootAgentFile,
  writeRootBrief,
  refreshRootBrief,
  applyRootBrief,
} from "./root-brief.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pb-brief-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const countBlocks = (s: string) => s.split(ROOT_BRIEF_BEGIN).length - 1;

describe("generateRootBrief", () => {
  it("is a single delimited block pointing at the project files", () => {
    const block = generateRootBrief();
    expect(block).toContain(ROOT_BRIEF_BEGIN);
    expect(block).toContain(ROOT_BRIEF_END);
    expect(block).toContain("paperbaker/README.md");
    expect(block).toContain("paperbaker/sources/");
  });
});

describe("resolveRootAgentFile", () => {
  it("creates AGENTS.md when no root agent file exists", () => {
    const r = resolveRootAgentFile(dir);
    expect(r.name).toBe("AGENTS.md");
    expect(r.existed).toBe(false);
  });

  it("prefers an existing AGENTS.md over CLAUDE.md", () => {
    writeFileSync(join(dir, "AGENTS.md"), "# a\n");
    writeFileSync(join(dir, "CLAUDE.md"), "# c\n");
    const r = resolveRootAgentFile(dir);
    expect(r.name).toBe("AGENTS.md");
    expect(r.existed).toBe(true);
  });

  it("falls back to CLAUDE.md when only it exists", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# c\n");
    const r = resolveRootAgentFile(dir);
    expect(r.name).toBe("CLAUDE.md");
    expect(r.existed).toBe(true);
  });
});

describe("writeRootBrief", () => {
  it("creates AGENTS.md with the block when none exists", () => {
    const res = writeRootBrief(dir);
    expect(res.status).toBe("added");
    expect(res.name).toBe("AGENTS.md");
    const out = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(out).toContain(ROOT_BRIEF_BEGIN);
    expect(countBlocks(out)).toBe(1);
  });

  it("appends to an existing file, preserving its content", () => {
    writeFileSync(join(dir, "AGENTS.md"), "# My project\n\nDo the thing.\n");
    writeRootBrief(dir);
    const out = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(out).toContain("# My project");
    expect(out).toContain("Do the thing.");
    expect(out).toContain(ROOT_BRIEF_BEGIN);
    // original content comes before the block
    expect(out.indexOf("Do the thing.")).toBeLessThan(out.indexOf(ROOT_BRIEF_BEGIN));
  });

  it("writes to CLAUDE.md when that's the only root file", () => {
    writeFileSync(join(dir, "CLAUDE.md"), "# Claude rules\n");
    const res = writeRootBrief(dir);
    expect(res.name).toBe("CLAUDE.md");
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf-8")).toContain(ROOT_BRIEF_BEGIN);
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });

  it("is idempotent — a second call adds no duplicate block", () => {
    writeRootBrief(dir);
    const res2 = writeRootBrief(dir);
    expect(res2.status).toBe("present");
    expect(countBlocks(readFileSync(join(dir, "AGENTS.md"), "utf-8"))).toBe(1);
  });
});

describe("refreshRootBrief", () => {
  it("replaces a stale managed block in place, leaving surrounding text intact", () => {
    const stale = `# My project\n\nDo the thing.\n\n${ROOT_BRIEF_BEGIN}\nOLD STALE TEXT\n${ROOT_BRIEF_END}\n\n## Footer notes\n`;
    writeFileSync(join(dir, "AGENTS.md"), stale);

    const res = refreshRootBrief(dir);
    expect(res.status).toBe("refreshed");

    const out = readFileSync(join(dir, "AGENTS.md"), "utf-8");
    expect(out).not.toContain("OLD STALE TEXT");
    expect(out).toContain("paperbaker/README.md"); // fresh template content
    expect(countBlocks(out)).toBe(1);
    // Text outside the markers survives.
    expect(out).toContain("Do the thing.");
    expect(out).toContain("## Footer notes");
  });

  it("is a no-op when the block already matches the current template", () => {
    writeRootBrief(dir);
    const res = refreshRootBrief(dir);
    expect(res.status).toBe("unchanged");
  });

  it("does nothing when no managed block is present", () => {
    writeFileSync(join(dir, "AGENTS.md"), "# Just my notes\n");
    const res = refreshRootBrief(dir);
    expect(res.status).toBe("absent");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toBe("# Just my notes\n");
  });

  it("never injects into a project that declined the brief", () => {
    saveProjectConfig({ name: "Test", rootBrief: "declined" }, dir);
    writeFileSync(join(dir, "AGENTS.md"), `${ROOT_BRIEF_BEGIN}\nx\n${ROOT_BRIEF_END}\n`);
    const res = refreshRootBrief(dir);
    expect(res.status).toBe("absent");
    // Untouched — we bail before reading/rewriting.
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain("\nx\n");
  });
});

describe("applyRootBrief", () => {
  beforeEach(() => {
    saveProjectConfig({ name: "Test" }, dir);
  });

  it("injects silently (non-TTY) and records the decision", async () => {
    const res = await applyRootBrief({ cwd: dir });
    expect(res.decision).toBe("added");
    expect(readFileSync(join(dir, "AGENTS.md"), "utf-8")).toContain(ROOT_BRIEF_BEGIN);
    expect(loadProjectConfig(dir)?.rootBrief).toBe("added");
  });

  it("writes nothing when disabled, but records the opt-out", async () => {
    const res = await applyRootBrief({ cwd: dir, disabled: true });
    expect(res.decision).toBe("declined");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
    expect(loadProjectConfig(dir)?.rootBrief).toBe("declined");
  });

  it("does nothing once a decision is already recorded", async () => {
    saveProjectConfig({ name: "Test", rootBrief: "declined" }, dir);
    const res = await applyRootBrief({ cwd: dir });
    expect(res.decision).toBe("already-decided");
    expect(existsSync(join(dir, "AGENTS.md"))).toBe(false);
  });
});
