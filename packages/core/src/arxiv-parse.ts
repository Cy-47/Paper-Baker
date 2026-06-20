// Single source of truth for turning an arXiv Atom feed into PaperMetadata,
// shared by the on-device provider (@paper-baker/providers) and the backend
// (functions/src/lib/arxiv.ts). Like arxiv-query.ts, this lives in core because
// the two had separate regex parsers that could (and did) drift: same feed, same
// PaperMetadata shape, two implementations to keep in sync by hand.
//
// Kept deliberately dependency-light and isomorphic — only regex + string ops,
// no XML library and no node-only APIs — so it runs unchanged in the browser
// (web app) and in node (CLI + Cloud Functions). The arXiv Atom feed is stable
// enough that a full XML parser is overkill.

import type { PaperMetadata } from "./types.js";

// ---------------------------------------------------------------------------
// Lightweight XML helpers (no external deps)
// ---------------------------------------------------------------------------

/** Extract the text content of the first occurrence of <tag>...</tag>. */
function getTagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

/** Extract all occurrences of <tag>...</tag>. */
function getAllTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "g");
  return xml.match(re) ?? [];
}

/** Extract the value of an attribute from a tag string. */
function getAttr(tag: string, attr: string): string | null {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`);
  const m = tag.match(re);
  return m ? m[1] : null;
}

/** Extract all <link> tags and return their href + rel/title/type pairs. */
function getLinks(
  xml: string,
): { href: string; rel: string | null; title: string | null; type: string | null }[] {
  const linkRe = /<link\s[^>]*?\/?>/g;
  const results: { href: string; rel: string | null; title: string | null; type: string | null }[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(xml)) !== null) {
    const tag = m[0];
    const href = getAttr(tag, "href");
    if (href) {
      results.push({
        href,
        rel: getAttr(tag, "rel"),
        title: getAttr(tag, "title"),
        type: getAttr(tag, "type"),
      });
    }
  }
  return results;
}

/** Extract the arxiv ID from an entry's <id> tag URL. */
function extractArxivId(idUrl: string): string {
  // <id>http://arxiv.org/abs/2301.12345v1</id>
  const m = idUrl.match(/abs\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  if (m) return m[1];
  // Fallback: old-style IDs like hep-ph/0001234
  const old = idUrl.match(/abs\/([a-z-]+\/\d+(?:v\d+)?)/);
  if (old) return old[1];
  return idUrl;
}

/** Strip the version suffix (e.g. v2) from an arxiv ID for consistent keying. */
function stripVersion(id: string): string {
  return id.replace(/v\d+$/, "");
}

// ---------------------------------------------------------------------------
// Parse a single <entry> into PaperMetadata
// ---------------------------------------------------------------------------

/**
 * Parse one arXiv `<entry>` block into PaperMetadata, or null if it carries no
 * `<id>` (e.g. arXiv's error entry). The arxiv ID is normalized version-free so
 * `paperId`/`source.id` key consistently across search and single-id fetch.
 */
export function parseArxivEntry(entry: string): PaperMetadata | null {
  const idUrl = getTagText(entry, "id");
  if (!idUrl) return null;

  const rawId = extractArxivId(idUrl);
  const id = stripVersion(rawId);

  const title = (getTagText(entry, "title") ?? "").replace(/\s+/g, " ").trim();
  const abstract = (getTagText(entry, "summary") ?? "").replace(/\s+/g, " ").trim();

  // Authors — omit affiliation entirely when absent (never emit `undefined`,
  // which Firestore rejects).
  const authorBlocks = getAllTags(entry, "author");
  const authors = authorBlocks.map((block) => {
    const name = getTagText(block, "name") ?? "Unknown";
    const affiliation = getTagText(block, "arxiv:affiliation") ?? undefined;
    return affiliation ? { name, affiliation } : { name };
  });

  const publishedAt = getTagText(entry, "published") ?? "";
  const updatedAt = getTagText(entry, "updated") ?? undefined;

  // Categories
  const categories: string[] = [];

  // Primary category: <arxiv:primary_category term="cs.AI" .../>
  const primaryCatRe = /<arxiv:primary_category\s[^>]*?term\s*=\s*"([^"]*)"/;
  const primaryCatMatch = entry.match(primaryCatRe);
  if (primaryCatMatch) {
    categories.push(primaryCatMatch[1]);
  }

  // Additional categories: <category term="cs.LG" .../>
  const catRe = /<category\s[^>]*?term\s*=\s*"([^"]*)"/g;
  let catMatch: RegExpExecArray | null;
  while ((catMatch = catRe.exec(entry)) !== null) {
    if (!categories.includes(catMatch[1])) {
      categories.push(catMatch[1]);
    }
  }

  // Links
  const entryLinks = getLinks(entry);
  const pdfLink = entryLinks.find((l) => l.title === "pdf")?.href ?? undefined;
  const absLink = entryLinks.find((l) => l.rel === "alternate")?.href ?? idUrl ?? undefined;

  // DOI
  const doi = getTagText(entry, "arxiv:doi") ?? undefined;

  return {
    paperId: `arxiv:${id}`,
    source: { type: "arxiv", id },
    title,
    abstract,
    authors,
    publishedAt,
    updatedAt,
    categories,
    doi,
    links: {
      pdf: pdfLink,
      abs: absLink,
      source: `https://arxiv.org/e-print/${id}`,
    },
    sourceStatus: "available",
  };
}

/** Parse a full arxiv Atom feed into PaperMetadata[]. Pure + testable. */
export function parseArxivFeed(xml: string): PaperMetadata[] {
  const results: PaperMetadata[] = [];
  for (const entry of getAllTags(xml, "entry")) {
    const parsed = parseArxivEntry(entry);
    if (parsed) results.push(parsed);
  }
  return results;
}
