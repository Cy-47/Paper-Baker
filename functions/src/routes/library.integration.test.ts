import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

// Integration tests for the library API (a user's saved papers), driven against
// the Firestore emulator. Auth is mocked (x-test-uid → uid); every Firestore
// read/write runs for real. arxiv is avoided by pre-seeding papers/ so the
// resolve step finds a cached entry (the live-fetch path is covered elsewhere).
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(async (req: Request) => {
    const uid = req.headers["x-test-uid"] as string | undefined;
    if (!uid) throw { status: 401, message: "Unauthorized" };
    return uid;
  }),
}));

// A paper with NO doi/venue (undefined optional fields) — like most of arxiv.
// The resolve step must cache it despite the Admin SDK rejecting `undefined`.
const NO_DOI_META = {
  paperId: "arxiv:2103.00020",
  source: { type: "arxiv", id: "2103.00020" },
  title: "A Paper Without A DOI",
  abstract: "x",
  authors: [{ name: "A", affiliation: undefined }],
  publishedAt: "2021-01-01T00:00:00Z",
  updatedAt: undefined,
  categories: ["cs.LG"],
  venue: undefined,
  doi: undefined,
  links: { pdf: "https://arxiv.org/pdf/2103.00020", abs: undefined, source: undefined },
  sourceStatus: "available",
};
vi.mock("../lib/arxiv.js", () => ({
  fetchArxivMetadata: vi.fn(async () => NO_DOI_META),
  searchArxiv: vi.fn(async () => []),
}));

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { handleLibraryRequest } from "./library.js";

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";
const PAPER_ID = "arxiv:1706.03762";

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
  body: Record<string, unknown>;
}

async function call(
  method: string,
  path: string,
  uid: string | null,
  body?: unknown,
): Promise<ApiResult> {
  const req = {
    method,
    path,
    body: body ?? {},
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

  await handleLibraryRequest(req, res);
  return { status, body: (json ?? {}) as Record<string, unknown> };
}

async function seedCachedPaper(): Promise<void> {
  await getFirestore()
    .collection("papers")
    .doc(PAPER_ID)
    .set({ paperId: PAPER_ID, title: "Attention Is All You Need", sourceStatus: "available" });
}

describe("POST /library — save", () => {
  it("writes a thin savedPapers record once the paper is cached", async () => {
    await seedCachedPaper();
    const res = await call("POST", "/", ALICE, { source: { type: "arxiv", id: "1706.03762" } });
    expect(res.status).toBe(201);
    expect(res.body.paperId).toBe(PAPER_ID);

    const saved = await getFirestore()
      .collection("users").doc(ALICE)
      .collection("savedPapers").doc(PAPER_ID)
      .get();
    expect(saved.exists).toBe(true);
    expect(saved.data()).toEqual({ paperId: PAPER_ID, savedAt: expect.any(String) });
    // No metadata duplicated onto the thin record.
    expect(saved.data()?.title).toBeUndefined();
  });

  it("is idempotent and preserves the original savedAt", async () => {
    await seedCachedPaper();
    const first = await call("POST", "/", ALICE, { source: { type: "arxiv", id: "1706.03762" } });
    const again = await call("POST", "/", ALICE, { source: { type: "arxiv", id: "1706.03762" } });
    expect(again.status).toBe(200);
    expect(again.body.savedAt).toBe(first.body.savedAt);
  });

  it("caches a paper with undefined optional fields (no doi) — Admin SDK can't store undefined", async () => {
    // papers/ NOT pre-seeded, so resolve fetches (mocked) and writes the metadata.
    const res = await call("POST", "/", ALICE, { source: { type: "arxiv", id: "2103.00020" } });
    expect(res.status).toBe(201);

    const cached = await getFirestore().collection("papers").doc("arxiv:2103.00020").get();
    expect(cached.exists).toBe(true);
    // undefined keys were stripped, not stored as null or rejected.
    expect("doi" in (cached.data() as object)).toBe(false);
    expect(cached.data()?.title).toBe("A Paper Without A DOI");
  });

  it("rejects an unsupported source type", async () => {
    const res = await call("POST", "/", ALICE, { source: { type: "doi", id: "10.1/x" } });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await call("POST", "/", null, { source: { type: "arxiv", id: "1" } });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /library/:paperId — unsave", () => {
  it("removes the saved record AND unfiles the paper from every project", async () => {
    const db = getFirestore();
    await seedCachedPaper();

    // A saved paper filed into one project (paperCount = 1).
    await db.collection("users").doc(ALICE).collection("savedPapers").doc(PAPER_ID)
      .set({ paperId: PAPER_ID, savedAt: "2026-01-01T00:00:00Z" });
    const projectRef = db.collection("users").doc(ALICE).collection("projects").doc("proj1");
    await projectRef.set({ projectId: "proj1", slug: "p", paperCount: 1 });
    await projectRef.collection("projectPapers").doc(PAPER_ID)
      .set({ paperId: PAPER_ID, projectId: "proj1", ownerUid: ALICE, addedAt: "x" });

    const res = await call("DELETE", `/${encodeURIComponent(PAPER_ID)}`, ALICE);
    expect(res.status).toBe(200);

    expect((await db.collection("users").doc(ALICE).collection("savedPapers").doc(PAPER_ID).get()).exists).toBe(false);
    expect((await projectRef.collection("projectPapers").doc(PAPER_ID).get()).exists).toBe(false);
    expect((await projectRef.get()).data()?.paperCount).toBe(0);
  });
});
