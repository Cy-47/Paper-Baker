import type { PaperMetadata } from "./types.js";

export function generateCitationKey(paper: PaperMetadata): string {
  const firstAuthor = paper.authors[0];
  if (!firstAuthor) return paper.paperId.replace(/[^a-zA-Z0-9]/g, "");

  const surname = firstAuthor.name.split(/\s+/).pop() ?? "unknown";
  const year = paper.publishedAt.slice(0, 4);
  const titleWord =
    paper.title
      .split(/\s+/)
      .find((w) => w.length > 3 && !STOP_WORDS.has(w.toLowerCase()))
      ?.toLowerCase()
      .replace(/[^a-z]/g, "") ?? "";

  return `${surname.toLowerCase()}${year}${titleWord}`;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "this",
  "that",
  "these",
  "those",
  "not",
  "via",
  "using",
]);

export function renderBibtex(
  paper: PaperMetadata,
  key?: string
): string {
  const citeKey = key ?? generateCitationKey(paper);
  const authors = paper.authors.map((a) => a.name).join(" and ");
  const year = paper.publishedAt.slice(0, 4);

  const fields: [string, string][] = [
    ["title", `{${paper.title}}`],
    ["author", `{${authors}}`],
    ["year", `{${year}}`],
  ];

  if (paper.abstract) {
    fields.push(["abstract", `{${paper.abstract}}`]);
  }
  if (paper.doi) {
    fields.push(["doi", `{${paper.doi}}`]);
  }
  if (paper.links.abs) {
    fields.push(["url", `{${paper.links.abs}}`]);
  }
  if (paper.venue) {
    fields.push(["booktitle", `{${paper.venue}}`]);
  }
  if (paper.source.type === "arxiv") {
    fields.push(["eprint", `{${paper.source.id}}`]);
    fields.push(["archiveprefix", `{arXiv}`]);
    if (paper.categories.length > 0) {
      fields.push(["primaryclass", `{${paper.categories[0]}}`]);
    }
  }

  const entryType = paper.venue ? "inproceedings" : "article";
  const body = fields.map(([k, v]) => `  ${k} = ${v}`).join(",\n");
  return `@${entryType}{${citeKey},\n${body}\n}`;
}

export function renderBibtexFile(
  papers: PaperMetadata[]
): string {
  const usedKeys = new Set<string>();
  const entries: string[] = [];

  for (const paper of papers) {
    let key = generateCitationKey(paper);
    if (usedKeys.has(key)) {
      let suffix = 2;
      while (usedKeys.has(`${key}${String.fromCharCode(95 + suffix)}`)) suffix++;
      key = `${key}${String.fromCharCode(95 + suffix)}`;
    }
    usedKeys.add(key);
    entries.push(renderBibtex(paper, key));
  }

  return entries.join("\n\n") + "\n";
}
