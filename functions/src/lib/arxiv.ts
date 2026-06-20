import type { PaperMetadata } from "@paper-baker/core";
import { createThrottledFetch, arxivSearchParams, parseArxivFeed } from "@paper-baker/core";
import { acquireArxivSlot } from "./arxivRateLimit.js";

// Per-instance fetch: keeps the User-Agent, 429/503 backoff, and single-in-flight
// behavior, but with NO spacing of its own (minIntervalMs: 0). Global 3s spacing
// is enforced across ALL Cloud Function instances by acquireArxivSlot() below — a
// per-process throttle can't bound a shared, many-instance egress on its own.
const arxivFetch = createThrottledFetch({ minIntervalMs: 0 });

/**
 * Fetch paper metadata from the arxiv Atom API for a single paper ID.
 *
 * @param arxivId - The bare arxiv ID, e.g. "2301.12345" or "2301.12345v2"
 * @returns Parsed PaperMetadata, or null if the paper was not found.
 */
export async function fetchArxivMetadata(
  arxivId: string,
): Promise<PaperMetadata | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  await acquireArxivSlot();
  const res = await arxivFetch(url);
  if (!res.ok) {
    throw new Error(`arxiv API returned ${res.status}`);
  }

  const xml = await res.text();
  return parseArxivEntry(xml, arxivId);
}

/**
 * Search arxiv via the Atom API.
 *
 * @param query - Free-text search query.
 * @param maxResults - Maximum number of results (default 10, capped at 50).
 * @returns Array of PaperMetadata for each result.
 */
export async function searchArxiv(
  query: string,
  maxResults = 10,
): Promise<PaperMetadata[]> {
  // Shared builder: quote as a phrase under all: + sort by relevance. A bare
  // query here made arXiv OR every term and sort by date, hiding the real result.
  const url = `https://export.arxiv.org/api/query?${arxivSearchParams(query, maxResults)}`;

  await acquireArxivSlot();
  const res = await arxivFetch(url);
  if (!res.ok) {
    throw new Error(`arxiv API returned ${res.status}`);
  }

  const xml = await res.text();
  return parseArxivFeed(xml);
}

// ---------------------------------------------------------------------------
// Single-id parse wrapper. The XML→PaperMetadata parsing itself lives in
// @paper-baker/core (arxiv-parse.ts), shared with the on-device provider so the
// two can't drift. This wrapper keeps the backend-specific validation a single
// fetch needs but a search does not: reject arXiv's error feed, and verify the
// entry arXiv returned is the paper we asked for.
// ---------------------------------------------------------------------------

function parseArxivEntry(
  xml: string,
  expectedId: string,
): PaperMetadata | null {
  // The arxiv API returns an error entry (HTTP 200) for a malformed id.
  if (xml.includes("<title>Error</title>")) return null;

  const [paper] = parseArxivFeed(xml);
  if (!paper) return null;

  // Sanity check: the returned ID should match what we asked for (ignoring
  // version). parseArxivFeed already normalizes source.id version-free.
  const baseExpected = expectedId.replace(/v\d+$/, "");
  if (paper.source.id.replace(/v\d+$/, "") !== baseExpected) return null;

  return paper;
}
