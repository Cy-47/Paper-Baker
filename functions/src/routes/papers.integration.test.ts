import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

// Integration tests for the papers API search handler, driven against the
// Firestore emulator. Auth is mocked (x-test-uid → uid) and arxiv is mocked so
// searchArxiv returns a fixed feed — the assertion is the SIDE EFFECT: search
// results warm the global papers/ cache.
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(async (req: Request) => {
    const uid = req.headers["x-test-uid"] as string | undefined;
    if (!uid) throw { status: 401, message: "Unauthorized" };
    return uid;
  }),
}));

// Two results: one with a doi, one with undefined optionals (no doi/venue) — the
// latter exercises the stripUndefined path the Admin SDK requires.
const RESULTS = [
  {
    paperId: "arxiv:1706.03762",
    source: { type: "arxiv", id: "1706.03762" },
    title: "Attention Is All You Need",
    abstract: "x",
    authors: [{ name: "Vaswani" }],
    publishedAt: "2017-06-12T00:00:00Z",
    updatedAt: undefined,
    categories: ["cs.CL"],
    doi: "10.1/abc",
    links: { pdf: "p", abs: "a", source: "s" },
    sourceStatus: "available",
  },
  {
    paperId: "arxiv:2103.00020",
    source: { type: "arxiv", id: "2103.00020" },
    title: "A Paper Without A DOI",
    abstract: "y",
    authors: [{ name: "A", affiliation: undefined }],
    publishedAt: "2021-01-01T00:00:00Z",
    updatedAt: undefined,
    categories: ["cs.LG"],
    venue: undefined,
    doi: undefined,
    links: { pdf: "p", abs: undefined, source: undefined },
    sourceStatus: "available",
  },
];
vi.mock("../lib/arxiv.js", () => ({
  searchArxiv: vi.fn(async () => RESULTS),
  fetchArxivMetadata: vi.fn(async () => null),
}));

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { handlePapersRequest } from "./papers.js";

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

interface ApiResult {
  status: number;
  body: unknown;
}

async function call(
  method: string,
  path: string,
  uid: string | null,
): Promise<ApiResult> {
  const req = {
    method,
    path,
    query: { q: "attention", maxResults: "8" },
    body: {},
    headers: uid ? { "x-test-uid": uid, authorization: "Bearer test" } : {},
  } as unknown as Request;

  let status = 0;
  let json: unknown;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json(payload: unknown) {
      json = payload;
      return this;
    },
  } as unknown as Response;

  await handlePapersRequest(req, res);
  return { status, body: json };
}

describe("GET /papers/search — warms the papers/ cache", () => {
  it("returns the search results unchanged", async () => {
    const res = await call("GET", "/search", ALICE);
    expect(res.status).toBe(200);
    expect((res.body as unknown[]).length).toBe(2);
  });

  it("writes each result into papers/{id}, stripping undefined fields", async () => {
    await call("GET", "/search", ALICE);

    const withDoi = await getFirestore().collection("papers").doc("arxiv:1706.03762").get();
    expect(withDoi.exists).toBe(true);
    expect(withDoi.data()?.title).toBe("Attention Is All You Need");
    expect(withDoi.data()?.doi).toBe("10.1/abc");

    const noDoi = await getFirestore().collection("papers").doc("arxiv:2103.00020").get();
    expect(noDoi.exists).toBe(true);
    // undefined keys stripped, not stored as null nor rejected by the Admin SDK.
    expect("doi" in (noDoi.data() as object)).toBe(false);
  });

  it("does not overwrite a paper already cached (absent-only)", async () => {
    await getFirestore()
      .collection("papers")
      .doc("arxiv:1706.03762")
      .set({ paperId: "arxiv:1706.03762", title: "Curated Title", sourceStatus: "available" });

    await call("GET", "/search", ALICE);

    const doc = await getFirestore().collection("papers").doc("arxiv:1706.03762").get();
    expect(doc.data()?.title).toBe("Curated Title"); // untouched
    // The other (previously absent) result was still written.
    expect((await getFirestore().collection("papers").doc("arxiv:2103.00020").get()).exists).toBe(true);
  });

  it("requires authentication", async () => {
    const res = await call("GET", "/search", null);
    expect(res.status).toBe(401);
  });
});
