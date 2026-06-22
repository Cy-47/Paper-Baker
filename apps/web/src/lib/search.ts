import { ApiError } from "@paper-baker/api-client";
import { parseArxivId, type PaperMetadata } from "@paper-baker/core";
import { getApiClient } from "./api";

/**
 * Find papers via the backend. A free-text query runs an arXiv search; an
 * id/URL/DOI paste resolves that single paper. Both go through /api/papers — the
 * browser can't call arXiv directly (no CORS) and there is no prod proxy, so the
 * backend (with arXiv's User-Agent, rate limiter, and cache) is the only path.
 *
 * A 404 on an id means arXiv has no such paper: that's an empty result, not a
 * failure, so it returns []. Every other error (offline, 429, 500, …) throws so
 * the caller can surface it. Used by FindPage and the add-paper modals so the
 * search behaviour can't drift between them.
 */
export async function findPapers(
  query: string,
  maxResults: number,
): Promise<PaperMetadata[]> {
  const client = await getApiClient();
  const id = parseArxivId(query);
  if (!id) return client.searchPapers(query, maxResults);
  try {
    return [await client.resolvePaper({ type: "arxiv", id })];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  }
}
