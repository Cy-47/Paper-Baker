import * as fs from "node:fs";
import * as path from "node:path";
import type { PaperMetadata } from "@paper-baker/core";
import { PROJECT_DIR, getProjectDir } from "../config.js";
import { SOURCES_REL, sourceDirName } from "./sources.js";

export function generateAgentsMd(papers: PaperMetadata[]): string {
  // Paths are written relative to the PROJECT ROOT, so they're correct no matter
  // where an agent reads from. Everything lives in the visible `paperbaker/` dir;
  // the tex sources are the searchable `paperbaker/sources/`.
  const lines: string[] = [
    "# Paper Baker — Research Papers",
    "",
    "Research papers managed by Paper Baker. Paths below are relative to the project root.",
    "",
    "## Reading Papers",
    `- \`${PROJECT_DIR}/papers.json\` — metadata for all papers in this project`,
    `- \`${PROJECT_DIR}/refs.bib\` — BibTeX bibliography for all papers`,
    `- \`${SOURCES_REL}/<paper-id>/\` — extracted tex source files per paper`,
    "  - Look for `main.tex` as the entry point",
    `  - Searchable directly with ripgrep/grep — e.g. \`rg "your query" ${SOURCES_REL}/\``,
    "",
    "## Commands",
    "- `pb list` — list all papers",
    "- `pb show <id>` — show paper metadata",
    "- `pb read <id>` — print tex source to stdout",
    "- `pb search <query>` — search for papers",
    "- `pb add <id>` — add a paper",
    "",
  ];

  if (papers.length > 0) {
    lines.push("## Papers in This Project");
    lines.push("");

    for (const paper of papers) {
      lines.push(`### ${paper.title}`);
      lines.push(`- **ID:** ${paper.paperId}`);
      lines.push(`- **Authors:** ${paper.authors.map((a) => a.name).join(", ")}`);
      lines.push(`- **Date:** ${paper.publishedAt.slice(0, 10)}`);
      lines.push(`- **Source:** \`${SOURCES_REL}/${sourceDirName(paper)}/\``);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Write AGENTS.md to the (visible) project dir. It sits alongside the metadata
 * and the tex it describes, so coding agents discover the reading guide via
 * search — no separate copy needed.
 */
export function writeAgentsMd(papers: PaperMetadata[], cwd?: string): void {
  fs.writeFileSync(path.join(getProjectDir(cwd), "AGENTS.md"), generateAgentsMd(papers));
}
