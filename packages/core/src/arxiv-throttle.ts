// arXiv's API Terms of Use require callers to "make no more than one request
// every three seconds, and limit requests to a single connection at a time"
// (https://info.arxiv.org/help/api/tou.html). This module wraps fetch to enforce
// both, plus a descriptive User-Agent and 429/503 backoff. Every arXiv-bound
// request in a process should go through ONE instance of this so the spacing is
// shared — see arxiv.ts in @paper-baker/providers and functions/lib/arxiv.ts.

export interface ThrottledFetchOptions {
  /** Minimum gap between request *starts*, in ms. arXiv asks for >= 3000. */
  minIntervalMs?: number;
  /** How many times to retry on a 429/503 before returning it. */
  maxRetries?: number;
  /** Identifies the client to arXiv; sent as the User-Agent header. */
  userAgent?: string;
  // --- seams for deterministic tests; default to the real clock/network ---
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export type ThrottledFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_MIN_INTERVAL_MS = 3000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_USER_AGENT = "Paper-Baker/0.1 (arXiv API client)";

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, or null. */
function parseRetryAfter(value: string | null, nowMs: number): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}

/** Return a new init with a User-Agent header, leaving any caller value intact. */
function withUserAgent(
  init: RequestInit | undefined,
  userAgent: string,
): RequestInit {
  const headers = new Headers(init?.headers);
  // Browsers treat User-Agent as a forbidden header and silently ignore this;
  // that's fine — the dev/prod proxy forwards the browser's own UA anyway. In
  // Node (CLI + Cloud Functions) it identifies us to arXiv as requested.
  if (!headers.has("User-Agent")) headers.set("User-Agent", userAgent);
  return { ...init, headers };
}

/**
 * Build a fetch wrapper that serializes arXiv requests (single connection),
 * spaces their starts >= minIntervalMs apart, tags them with a User-Agent, and
 * retries 429/503 with exponential backoff (honoring Retry-After).
 */
export function createThrottledFetch(
  options: ThrottledFetchOptions = {},
): ThrottledFetch {
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const now = options.now ?? (() => Date.now());
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const fetchImpl =
    options.fetchImpl ?? ((url, init) => fetch(url, init));

  // A single promise chain guarantees one in-flight request at a time.
  let chain: Promise<unknown> = Promise.resolve();
  let lastStartedAt = Number.NEGATIVE_INFINITY;

  async function execute(url: string, init?: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const wait = lastStartedAt + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      lastStartedAt = now();

      const res = await fetchImpl(url, withUserAgent(init, userAgent));
      if ((res.status === 429 || res.status === 503) && attempt < maxRetries) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"), now());
        const backoff = Math.max(retryAfter ?? 0, minIntervalMs * 2 ** attempt);
        await sleep(backoff);
        continue;
      }
      return res;
    }
  }

  return function throttledFetch(url, init) {
    const run = chain.then(() => execute(url, init));
    // Detach failures from the shared chain so one rejection doesn't break the
    // next caller, while still rejecting this caller's own promise.
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
