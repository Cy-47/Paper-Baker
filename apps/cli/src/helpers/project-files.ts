import * as fs from "node:fs";
import * as path from "node:path";
import type { PaperMetadata } from "@paper-baker/core";
import { renderBibtexFile } from "@paper-baker/core";
import { getProjectDir } from "../config.js";
import { writeProjectReadme } from "./project-readme.js";
import { ensureSourcesRepo } from "./sources.js";

// ---------------------------------------------------------------------------
// Shared paperbaker/ directory operations, used by init, project, and sync.
// ---------------------------------------------------------------------------

/** True if the current directory is already a Paper Baker project. */
export function projectConfigExists(cwd?: string): boolean {
  return fs.existsSync(path.join(getProjectDir(cwd), "config.json"));
}

/** Path to the project's papers.json lockfile. */
function papersPath(cwd?: string): string {
  return path.join(getProjectDir(cwd), "papers.json");
}

export function loadPapers(cwd?: string): PaperMetadata[] {
  const p = papersPath(cwd);
  if (!fs.existsSync(p)) return [];
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PaperMetadata[];
  } catch {
    return [];
  }
}

export function savePapers(papers: PaperMetadata[], cwd?: string): void {
  fs.writeFileSync(papersPath(cwd), JSON.stringify(papers, null, 2) + "\n");
}

/**
 * Create the visible `paperbaker/` scaffold: the dir, the sealed `sources/`
 * nested git repo, and empty papers.json / refs.bib / README.md. Does NOT touch
 * config.json — the caller writes that with the right project id.
 */
export function scaffoldProjectFiles(cwd?: string): string {
  const projectDir = getProjectDir(cwd);
  fs.mkdirSync(projectDir, { recursive: true });
  ensureSourcesRepo(cwd);
  savePapers([], cwd);
  fs.writeFileSync(path.join(projectDir, "refs.bib"), "");
  writeProjectReadme([], cwd);
  return projectDir;
}

/** Regenerate the derived files (refs.bib, README.md) from the paper list. */
export function rebuildArtifacts(papers: PaperMetadata[], cwd?: string): void {
  fs.writeFileSync(
    path.join(getProjectDir(cwd), "refs.bib"),
    renderBibtexFile(papers),
  );
  writeProjectReadme(papers, cwd);
}
