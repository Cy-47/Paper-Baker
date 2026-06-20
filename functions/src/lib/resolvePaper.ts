import { getFirestore } from "firebase-admin/firestore";
import type { PaperMetadata, Source } from "@paper-baker/core";
import { makePaperId } from "@paper-baker/core";
import { fetchArxivMetadata } from "./arxiv.js";

/**
 * Resolve a paper's metadata into the global papers/{id} cache, idempotently.
 * This is the SINGLE implementation of "ensure metadata is cached" — shared by
 * the papers route (POST /papers) and the library route (POST /library) so the
 * two can't drift. Returns the cached metadata and whether it was just created,
 * or null if arxiv has no such paper. Only arxiv is supported in v1.
 */
export async function resolveAndCachePaper(
  source: Source,
): Promise<{ paper: PaperMetadata; created: boolean } | null> {
  const paperId = makePaperId(source);
  const ref = getFirestore().collection("papers").doc(paperId);

  const existing = await ref.get();
  if (existing.exists) return { paper: existing.data() as PaperMetadata, created: false };

  const metadata = await fetchArxivMetadata(source.id);
  if (!metadata) return null;
  // The Admin SDK rejects `undefined` field values (e.g. a paper with no doi or
  // venue), unlike the web client which sets ignoreUndefinedProperties. Drop
  // undefined keys before caching so any paper resolves cleanly.
  await ref.set(stripUndefined(metadata));
  return { paper: metadata, created: true };
}

/**
 * Warm the global papers/{id} cache with metadata that arrived via search. arXiv
 * returns the SAME complete entry for a search hit as for a single-id fetch, so a
 * paper cached here from search is indistinguishable from one resolved on save —
 * and a later resolve/add of it becomes a pure cache hit (no arxiv refetch).
 *
 * Absent-only: never overwrite an existing record, and skip the writes for papers
 * already cached so a popular query doesn't burn writes re-storing the same docs.
 * Returns the number of papers newly written.
 */
export async function cacheSearchResults(
  papers: PaperMetadata[],
): Promise<number> {
  if (papers.length === 0) return 0;
  const db = getFirestore();
  const col = db.collection("papers");

  // One batched read to find which ids are missing (reads are cheap; writes,
  // and arXiv's rate limit, are what we're protecting).
  const refs = papers.map((p) => col.doc(p.paperId));
  const snaps = await db.getAll(...refs);
  const cached = new Set(snaps.filter((s) => s.exists).map((s) => s.id));

  const toWrite = papers.filter((p) => !cached.has(p.paperId));
  if (toWrite.length === 0) return 0;

  const batch = db.batch();
  for (const paper of toWrite) {
    batch.set(col.doc(paper.paperId), stripUndefined(paper));
  }
  await batch.commit();
  return toWrite.length;
}

/** Recursively remove keys whose value is `undefined` (Firestore can't store it). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as unknown as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    ) as T;
  }
  return value;
}
