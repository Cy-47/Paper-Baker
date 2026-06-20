// Single source of truth for building an arXiv search query, shared by the
// on-device provider (@paper-baker/providers) and the backend
// (functions/src/lib/arxiv.ts). Keeping it in one place is deliberate: when these
// drifted, the server sent a bare unquoted query and arXiv returned ~667k loosely
// OR'd matches sorted by date instead of the intended paper.

/**
 * Build the query-string params for an arXiv search.
 *
 * The query is quoted as a single phrase under the `all:` field. Without the
 * quotes arXiv splits on whitespace and ORs every term (`all:attention OR all:is
 * OR …`), so the intended paper drowns under hundreds of thousands of matches.
 * Embedded quotes are stripped so the phrase stays syntactically valid, and
 * `max_results` is clamped to arXiv's sane range (1–50).
 */
export function arxivSearchParams(
  query: string,
  maxResults: number,
): URLSearchParams {
  const cap = Math.min(Math.max(Math.trunc(maxResults) || 1, 1), 50);
  const phrase = query.replace(/"/g, " ").trim();
  return new URLSearchParams({
    search_query: `all:"${phrase}"`,
    start: "0",
    max_results: String(cap),
    sortBy: "relevance",
    sortOrder: "descending",
  });
}
