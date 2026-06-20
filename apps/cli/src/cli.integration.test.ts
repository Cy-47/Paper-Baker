import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, afterAll, describe, it, expect } from "vitest";

// End-to-end test of the agent-facing CLI: drives the real built binary through
// init -> add -> list -> read -> bib in a throwaway directory, hitting the live
// arxiv API + e-print download + tar extraction. This is the flagship path, so
// it's exercised as a black box exactly as an agent would.

const here = dirname(fileURLToPath(import.meta.url));
const cliDir = join(here, ".."); // apps/cli
const repoRoot = join(cliDir, "..", ".."); // repo root
const distEntry = join(cliDir, "dist", "index.js");

const PAPER = "1706.03762"; // "Attention Is All You Need" — stable, source available
const PAPER_ID = `arxiv:${PAPER}`;

let workDir: string;
let configDir: string;

function run(args: string[], cwd: string = workDir): string {
  return execFileSync("node", [distEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
  });
}

/** Run a command expected to fail; returns its exit code + stderr. */
function runFail(
  args: string[],
  cwd: string = workDir
): { status: number | null; stderr: string } {
  try {
    execFileSync("node", [distEntry, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 60_000,
      stdio: "pipe",
    });
    return { status: 0, stderr: "" };
  } catch (e) {
    const err = e as { status?: number | null; stderr?: string | Buffer };
    return {
      status: err.status ?? null,
      stderr: String(err.stderr ?? ""),
    };
  }
}

beforeAll(() => {
  // Build the bundled CLI so we test the real published artifact.
  execFileSync("pnpm", ["--filter", "@paper-baker/cli", "build"], {
    cwd: repoRoot,
    stdio: "ignore",
    timeout: 120_000,
  });
  workDir = mkdtempSync(join(tmpdir(), "pb-cli-e2e-"));
  // Make the workdir a git repo so we can assert the host repo stays clean and
  // the tex sources are not gitignored (i.e. remain searchable by rg-based tools).
  execFileSync("git", ["init", "-q"], { cwd: workDir });
  // Isolate from any real global config on the machine: child CLI processes
  // inherit process.env, so redirect the config dir at a throwaway location.
  configDir = mkdtempSync(join(tmpdir(), "pb-cli-cfg-"));
  process.env["PAPERBAKER_CONFIG_DIR"] = configDir;
  delete process.env["PAPERBAKER_TOKEN"];
  delete process.env["PAPERBAKER_API_URL"];
}, 130_000);

/** True if the host repo's git would ignore `relPath` (rg honors this too). */
function gitIgnores(relPath: string): boolean {
  try {
    execFileSync("git", ["check-ignore", relPath], { cwd: workDir, stdio: "pipe" });
    return true; // exit 0 => path is ignored
  } catch {
    return false; // exit 1 => not ignored
  }
}

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
  if (configDir) rmSync(configDir, { recursive: true, force: true });
  delete process.env["PAPERBAKER_CONFIG_DIR"];
});

describe("CLI end-to-end", () => {
  it("project create scaffolds the paperbaker project", () => {
    run(["project", "create", "E2E Test"]);
    // Everything lives in a single visible paperbaker/ dir.
    const pb = join(workDir, "paperbaker");
    expect(existsSync(join(pb, "config.json"))).toBe(true);
    expect(existsSync(join(pb, "papers.json"))).toBe(true);
    expect(existsSync(join(pb, "refs.bib"))).toBe(true);
    expect(existsSync(join(pb, "AGENTS.md"))).toBe(true);
    // Tex sources go in paperbaker/sources/ — its own nested git repo so the
    // bulky content never pollutes the host repo's history.
    const srcRoot = join(pb, "sources");
    expect(existsSync(srcRoot)).toBe(true);
    expect(existsSync(join(srcRoot, ".git"))).toBe(true);
  });

  it("add downloads + extracts the tex source and records metadata", () => {
    run(["add", PAPER]);

    // tex source extracted to paperbaker/sources/arxiv-<id>/
    const srcDir = join(workDir, "paperbaker", "sources", `arxiv-${PAPER}`);
    expect(existsSync(srcDir)).toBe(true);
    const texFiles = readdirSync(srcDir).filter((f) => f.endsWith(".tex"));
    expect(texFiles.length).toBeGreaterThan(0);

    // metadata recorded in papers.json
    const papers = JSON.parse(
      readFileSync(join(workDir, "paperbaker", "papers.json"), "utf8")
    );
    const paper = papers.find((p: { paperId: string }) => p.paperId === PAPER_ID);
    expect(paper).toBeDefined();
    expect(paper.title).toMatch(/Attention Is All You Need/i);
    expect(paper.authors[0].name).toMatch(/Vaswani/);
  }, 90_000);

  it("keeps tex sources searchable by coding agents", () => {
    const dir = join("paperbaker", "sources", `arxiv-${PAPER}`);
    const fallbackTex = readdirSync(join(workDir, dir)).find((f) => f.endsWith(".tex"));
    const rel = existsSync(join(workDir, dir, "main.tex"))
      ? join(dir, "main.tex")
      : join(dir, fallbackTex!);

    // (1) No path segment is hidden (dot-prefixed) — rg-based tools skip hidden dirs.
    expect(rel.split(sep).some((s) => s.startsWith("."))).toBe(false);
    // (2) Not gitignored — rg honors .gitignore, so "not ignored" == "searchable".
    expect(gitIgnores(rel)).toBe(false);

    // (3) The host repo stays clean: `git add -A` can stage at most a gitlink for
    //     paperbaker/sources, never the tex files themselves.
    execFileSync("git", ["add", "-A"], { cwd: workDir, stdio: "pipe" });
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], {
      cwd: workDir,
      encoding: "utf8",
    });
    execFileSync("git", ["reset", "-q"], { cwd: workDir });
    expect(staged).not.toMatch(/paperbaker\/sources\/.*\.tex/);
  });

  it("list --json returns the added paper", () => {
    const out = run(["list", "--json"]);
    const papers = JSON.parse(out);
    expect(papers.map((p: { paperId: string }) => p.paperId)).toContain(PAPER_ID);
  });

  it("read prints the tex source to stdout", () => {
    const out = run(["read", PAPER_ID]);
    expect(out).toMatch(/\\(documentclass|section|begin)/);
  });

  it("bib generates a BibTeX entry for the paper", () => {
    const out = run(["bib"]);
    expect(out).toMatch(/@\w+\{vaswani2017/);
    expect(out).toContain("Attention Is All You Need");
  });

  it("show --json returns the paper's metadata", () => {
    const paper = JSON.parse(run(["show", PAPER_ID, "--json"]));
    expect(paper.paperId).toBe(PAPER_ID);
    expect(paper.title).toMatch(/Attention Is All You Need/i);
    expect(paper.categories.length).toBeGreaterThan(0);
  });

  it("context concatenates tex bodies for agent consumption", () => {
    const out = run(["context"]);
    expect(out).toContain("Attention Is All You Need");
    expect(out.length).toBeGreaterThan(500);
  });

  it("search --json returns ranked arxiv results", () => {
    const results = JSON.parse(run(["search", "attention is all you need", "-n", "5", "--json"]));
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].paperId).toMatch(/^arxiv:/);
  }, 30_000);

  it("remove deletes the paper from the lockfile and its source dir", () => {
    const srcDir = join(workDir, "paperbaker", "sources", `arxiv-${PAPER}`);
    expect(existsSync(srcDir)).toBe(true);

    run(["remove", PAPER_ID]);

    const papers = JSON.parse(
      readFileSync(join(workDir, "paperbaker", "papers.json"), "utf8")
    );
    expect(papers.find((p: { paperId: string }) => p.paperId === PAPER_ID)).toBeUndefined();
    expect(existsSync(srcDir)).toBe(false);
  });
});

describe("CLI error handling", () => {
  it("exits non-zero with guidance when no project is initialized", () => {
    const empty = mkdtempSync(join(tmpdir(), "pb-cli-noinit-"));
    try {
      const { status, stderr } = runFail(["list"], empty);
      expect(status).not.toBe(0);
      expect(stderr.toLowerCase()).toMatch(/project create/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("exits non-zero on an unparseable arxiv id", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-cli-badid-"));
    try {
      run(["project", "create", "x"], dir);
      const { status } = runFail(["add", "definitely-not-an-arxiv-id"], dir);
      expect(status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits non-zero when reading a paper that isn't in the project", () => {
    const dir = mkdtempSync(join(tmpdir(), "pb-cli-noread-"));
    try {
      run(["project", "create", "x"], dir);
      const { status } = runFail(["read", "arxiv:0000.00000"], dir);
      expect(status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The `pb project` subcommand's local paths need no network, so they run as a
// black box through the built binary just like the flagship flow. (The networked
// paths — list/bind/rename and `pb sync`'s publish — are not covered here; they'd
// need the functions emulator over HTTP.)
describe("pb project (offline, no network)", () => {
  function freshDir(): string {
    return mkdtempSync(join(tmpdir(), "pb-cli-proj-"));
  }

  function readConfig(dir: string): {
    name: string;
    stableId?: string;
    slug?: string;
  } {
    return JSON.parse(
      readFileSync(join(dir, "paperbaker", "config.json"), "utf8"),
    );
  }

  it("create scaffolds the dir and writes a local (unsynced) binding", () => {
    const dir = freshDir();
    try {
      // No token, no TTY: create is always local and never blocks on auth.
      run(["project", "create", "My Research"], dir);
      const pb = join(dir, "paperbaker");
      for (const f of ["config.json", "papers.json", "refs.bib", "AGENTS.md"]) {
        expect(existsSync(join(pb, f))).toBe(true);
      }
      // Tex sources still get their sealed nested git repo.
      expect(existsSync(join(pb, "sources", ".git"))).toBe(true);

      const cfg = readConfig(dir);
      expect(cfg.name).toBe("My Research");
      expect(cfg.stableId).toBeUndefined(); // no stable id until first `pb sync`
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to create a second project in the same directory", () => {
    const dir = freshDir();
    try {
      run(["project", "create", "First"], dir);
      const { status, stderr } = runFail(
        ["project", "create", "Second"],
        dir,
      );
      expect(status).not.toBe(0);
      expect(stderr.toLowerCase()).toMatch(/already/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rename updates an offline project's name and stays unsynced", () => {
    const dir = freshDir();
    try {
      run(["project", "create", "Old Name"], dir);
      run(["project", "rename", "New Name"], dir);
      const after = readConfig(dir);
      expect(after.name).toBe("New Name");
      expect(after.stableId).toBeUndefined(); // still local-only
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("unbind on an offline project is a no-op with guidance", () => {
    const dir = freshDir();
    try {
      run(["project", "create", "X"], dir);
      const out = run(["project", "unbind"], dir);
      expect(out.toLowerCase()).toMatch(/local-only/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("list without a token errors with login guidance", () => {
    const dir = freshDir();
    try {
      const { status, stderr } = runFail(["project", "list"], dir);
      expect(status).not.toBe(0);
      expect(stderr.toLowerCase()).toMatch(/login|token/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rename with no project bound exits non-zero", () => {
    const dir = freshDir();
    try {
      const { status } = runFail(["project", "rename", "whatever"], dir);
      expect(status).not.toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// update/uninstall only act on the standalone pkg binary. Run through `node`
// (not packaged), so the guard must fire: print guidance and touch NOTHING.
// The safety-critical assertion is that `pb uninstall` never deletes the Node
// binary it's running under (process.execPath would be Node here).
describe("pb update / uninstall (non-packaged guards)", () => {
  function capture(args: string[]): { status: number | null; out: string } {
    const r = spawnSync("node", [distEntry, ...args], {
      cwd: workDir,
      encoding: "utf8",
      timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  }

  it("update on a non-binary install exits 0 with guidance, changes nothing", () => {
    const { status, out } = capture(["update"]);
    expect(status).toBe(0);
    expect(out).toMatch(/npm install -g @paper-baker\/cli/);
    // It must not have tried to reach GitHub or report a version swap.
    expect(out).not.toMatch(/Updating|Updated to/);
  });

  it("uninstall on a non-binary install refuses and never deletes node", () => {
    expect(existsSync(process.execPath)).toBe(true); // the node running this test
    const { status, out } = capture(["uninstall", "--purge"]);
    expect(status).toBe(0);
    expect(out).toMatch(/npm uninstall -g @paper-baker\/cli/);
    expect(out).not.toMatch(/Uninstalled pb|Removed/);
    // The guard's whole point: Node is untouched even with --purge.
    expect(existsSync(process.execPath)).toBe(true);
  });

  it("--version reports the package.json version, not a dev sentinel", () => {
    const { status, out } = capture(["--version"]);
    expect(status).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
