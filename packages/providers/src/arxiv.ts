import type { PaperMetadata } from "@paper-baker/core";
import {
  createThrottledFetch,
  type ThrottledFetch,
  arxivSearchParams,
  parseArxivEntry,
  parseArxivFeed,
} from "@paper-baker/core";
import type { PaperProvider } from "./provider.js";

// The XML→PaperMetadata parser lives in @paper-baker/core (arxiv-parse.ts) so the
// provider and the Cloud Functions backend share one implementation. Re-exported
// here as parseEntry/parseArxivFeed for back-compat with existing importers.
export { parseArxivEntry as parseEntry, parseArxivFeed };

const ARXIV_API = "https://export.arxiv.org/api/query";

// One throttle shared by every ArxivProvider in the process, so arXiv's "one
// request every 3s, single connection" rule holds across all callers (e.g. the
// CLI doing search + metadata back to back).
const arxivFetch: ThrottledFetch = createThrottledFetch();

// ---------------------------------------------------------------------------
// ArxivProvider
// ---------------------------------------------------------------------------

export class ArxivProvider implements PaperProvider {
  readonly name = "arxiv";

  /**
   * @param apiUrl arxiv query endpoint. Defaults to the public API; the web app
   *   passes a same-origin proxy path (e.g. "/arxiv-api/query") to dodge CORS.
   * @param fetchImpl throttled fetch; defaults to the shared, rate-limited one.
   *   Override only in tests.
   */
  constructor(
    private readonly apiUrl: string = ARXIV_API,
    private readonly fetchImpl: ThrottledFetch = arxivFetch,
  ) {}

  async search(query: string, maxResults: number = 10): Promise<PaperMetadata[]> {
    const params = arxivSearchParams(query, maxResults);
    const res = await this.fetchImpl(`${this.apiUrl}?${params}`);
    if (!res.ok) {
      throw new Error(`arXiv API error: ${res.status} ${res.statusText}`);
    }

    return parseArxivFeed(await res.text());
  }

  async fetchMetadata(id: string): Promise<PaperMetadata | null> {
    const params = new URLSearchParams({
      id_list: id,
    });

    const res = await this.fetchImpl(`${this.apiUrl}?${params}`);
    if (!res.ok) {
      throw new Error(`arXiv API error: ${res.status} ${res.statusText}`);
    }

    // The API returns an entry even for invalid IDs, but with no title.
    const [parsed] = parseArxivFeed(await res.text());
    if (!parsed || !parsed.title) return null;

    return parsed;
  }
}
