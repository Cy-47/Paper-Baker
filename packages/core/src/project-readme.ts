import type { PaperMetadata } from "./types.js";

// The `paperbaker/README.md` guide the CLI generates and keeps up to date — the
// full, human/agent-readable index of a project's papers (the root brief in
// agent-brief.ts is the short pointer that links here). It lives in core so the
// CLI (which WRITES it) and the web docs page (which PREVIEWS it) render the
// exact same thing.

// Layout of the visible project dir. Private to this module — the CLI has its
// own copies in config.ts / helpers/sources.ts for filesystem work; these exist
// only so the generated text is correct.
const PROJECT_DIR = "paperbaker";
const SOURCES_REL = `${PROJECT_DIR}/sources`;

/** Filename of the full per-project guide, inside the visible paperbaker/ dir. */
export const PROJECT_README = "README.md";

/** Directory name a paper's tex source is extracted into, under sources/. */
export function sourceDirName(paper: PaperMetadata): string {
  return paper.source.type === "arxiv"
    ? `arxiv-${paper.source.id}`
    : paper.paperId.replace(":", "-");
}

/** The `paperbaker/README.md` guide rendered from a project's papers. */
export function generateProjectReadme(papers: PaperMetadata[]): string {
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
