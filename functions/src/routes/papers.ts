import { onRequest, type Request } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Response } from "express";
import type { PaperMetadata } from "@paper-baker/core";
import { paperDocId } from "@paper-baker/core";
import { requireAuth } from "../middleware/auth.js";
import { routePath } from "../lib/routePath.js";
import { searchArxiv } from "../lib/arxiv.js";
import { resolveAndCachePaper, cacheSearchResults } from "../lib/resolvePaper.js";
import { RateLimitedError } from "../lib/arxivRateLimit.js";

const db = () => getFirestore();

/**
 * Papers API — single onRequest handler with URL-based routing.
 *
 * Routes:
 *   POST /           — resolve a paper by source (fetch metadata, cache in Firestore)
 *   GET  /search     — proxy search to arxiv, return results without caching
 *   GET  /:id        — get a paper from Firestore by paperId
 */
// Exported separately from the onRequest wrapper so integration tests can drive
// it against the emulator with mock req/res, no HTTP layer needed.
export async function handlePapersRequest(
  req: Request,
  res: Response,
): Promise<void> {
  try {
    await requireAuth(req);
  } catch (err: unknown) {
    const e = err as { status: number; message: string };
    res.status(e.status).json({ error: e.message });
    return;
  }

  // Works both directly (req.path = "/search") and behind the hosting rewrite
  // (req.path = "/api/papers/search").
  const path = routePath(req.path, "/api/papers");
  const segments = path.split("/").filter(Boolean);

  try {
    // POST / — resolve paper
    if (req.method === "POST" && segments.length === 0) {
      await handleResolve(req, res);
      return;
    }

    // GET /search?q=...
    if (req.method === "GET" && segments[0] === "search") {
      await handleSearch(req, res);
      return;
    }

    // GET /:id — get paper by paperId
    // The paperId is the rest of the path joined (e.g. "arxiv:2301.12345")
    if (req.method === "GET" && segments.length >= 1) {
      const paperId = decodeURIComponent(segments.join("/"));
      await handleGetPaper(paperId, res);
      return;
    }

    res.status(404).json({ error: "Not found" });
  } catch (err: unknown) {
    if (sendRateLimited(res, err)) return;
    console.error("papers API error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Map a RateLimitedError (the global arXiv slot limiter shedding load) to an HTTP
 * 429 with Retry-After. Returns true if it handled the error. Shared by the
 * library route too — any handler that resolves a paper can hit it.
 */
export function sendRateLimited(res: Response, err: unknown): boolean {
  if (err instanceof RateLimitedError) {
    res
      .status(429)
      .set("Retry-After", String(Math.ceil(err.retryAfterMs / 1000)))
      .json({ error: err.message });
    return true;
  }
  return false;
}

// invoker: "public" so Hosting can reach it unauthenticated; the handler
// enforces app-level auth via requireAuth.
export const papersApi = onRequest({ cors: true, invoker: "public" }, handlePapersRequest);

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleResolve(
  req: Request,
  res: Response,
) {
  const { source } = req.body as { source?: { type: string; id: string } };

  if (
    !source ||
    typeof source.type !== "string" ||
    typeof source.id !== "string"
  ) {
    res.status(400).json({ error: "Request body must include source: {type, id}" });
    return;
  }

  if (source.type !== "arxiv") {
    res.status(400).json({ error: `Unsupported source type: ${source.type}` });
    return;
  }

  const resolved = await resolveAndCachePaper(source as { type: "arxiv"; id: string });
  if (!resolved) {
    res.status(404).json({ error: `Paper not found on arxiv: ${source.id}` });
    return;
  }
  res.status(resolved.created ? 201 : 200).json(resolved.paper);
}

async function handleSearch(
  req: Request,
  res: Response,
) {
  const q = req.query.q as string | undefined;
  if (!q) {
    res.status(400).json({ error: "Missing query parameter: q" });
    return;
  }

  const maxResults = parseInt(req.query.maxResults as string, 10) || 10;
  const results = await searchArxiv(q, maxResults);

  // Warm the global papers/ cache with these results so a later resolve/add of
  // any of them is a pure cache hit (arXiv returns the same complete metadata for
  // a search hit as for a single-id fetch). Awaited so the write completes before
  // the function instance can freeze, but best-effort: a cache failure must never
  // fail the search itself.
  try {
    await cacheSearchResults(results);
  } catch (err) {
    console.error("failed to warm papers cache from search:", err);
  }

  res.status(200).json(results);
}

async function handleGetPaper(
  paperId: string,
  res: Response,
) {
  const doc = await db().collection("papers").doc(paperDocId(paperId)).get();
  if (!doc.exists) {
    res.status(404).json({ error: "Paper not found" });
    return;
  }
  res.status(200).json(doc.data() as PaperMetadata);
}
