import { getFirestore } from "firebase-admin/firestore";

// Centralized, cross-instance rate limiter for the backend's arXiv egress.
//
// The per-process throttle in @paper-baker/core (createThrottledFetch) spaces
// requests within ONE process. That's right for the CLI and the browser (one
// client each), but Cloud Functions scale to many instances that all egress from
// the same place — so N instances would each fire 1 req/3s, blowing past arXiv's
// "one request every 3 seconds, single connection" limit collectively.
//
// This module serializes a single global request stream through a Firestore doc:
// every backend arXiv call claims the next 3-second slot in a transaction, so the
// spacing holds no matter how many instances are live. If the wait to the next
// free slot is too long (a burst of cache MISSES), we fail fast with
// RateLimitedError rather than hold a function instance open.

const LIMIT_DOC = "rateLimits/arxiv";
const DEFAULT_MIN_INTERVAL_MS = 3000;
// Cap how long a single request will block waiting for its slot. Past this we
// shed load (429) instead of pinning the instance until it times out.
const DEFAULT_MAX_WAIT_MS = 20_000;

/** Thrown when the next arXiv slot is further out than maxWaitMs. */
export class RateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("arXiv request rate limit reached; try again shortly");
    this.name = "RateLimitedError";
  }
}

export interface AcquireSlotOptions {
  minIntervalMs?: number;
  maxWaitMs?: number;
  // Seams for deterministic tests; default to the real clock.
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Block until it's this caller's turn to hit arXiv, enforcing >= minIntervalMs
 * between requests globally (across all Cloud Function instances). Throws
 * RateLimitedError if the next slot is more than maxWaitMs away — the caller
 * should surface that as an HTTP 429.
 */
export async function acquireArxivSlot(
  opts: AcquireSlotOptions = {},
): Promise<void> {
  const minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  const maxWaitMs = opts.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const now = opts.now ?? (() => Date.now());
  const sleep =
    opts.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const db = getFirestore();
  const ref = db.doc(LIMIT_DOC);

  // The transaction is the serialization point: concurrent callers contend on
  // this one doc and Firestore retries the losers, so each ends up claiming a
  // distinct, monotonically increasing slot. Never sleep inside it.
  const waitMs = await db.runTransaction(async (tx) => {
    const nowMs = now();
    const snap = await tx.get(ref);
    const lastMs = (snap.data()?.lastRequestAtMs as number | undefined) ?? 0;
    const slotMs = Math.max(nowMs, lastMs + minIntervalMs);
    const wait = slotMs - nowMs;
    if (wait > maxWaitMs) {
      // Don't claim the slot — leave it for a caller that can wait.
      throw new RateLimitedError(wait);
    }
    tx.set(ref, { lastRequestAtMs: slotMs }, { merge: true });
    return wait;
  });

  if (waitMs > 0) await sleep(waitMs);
}
