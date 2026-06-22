import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { isValidStableId, paperDocId } from "@paper-baker/core";

// High-level integration tests for the projects API, driven directly against the
// Firestore emulator. Only token verification is mocked — every Firestore read,
// write, transaction, and the full id/rename/membership logic runs for real. Auth
// maps an `x-test-uid` header straight to a uid so we can exercise isolation.
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(async (req: Request) => {
    const uid = req.headers["x-test-uid"] as string | undefined;
    if (!uid) throw { status: 401, message: "Unauthorized" };
    return uid;
  }),
}));

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { handleProjectsRequest } from "./projects.js";

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";
const BOB = "bob-uid";

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

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface ApiResult {
  status: number;
  body: unknown;
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

  await handleProjectsRequest(req, res);
  return { status, body: json };
}

interface ProjectShape {
  stableId: string;
  id: string;
  name: string;
  description: string;
  ownerUid: string;
  ownerHandle: string;
  memberUids: string[];
  visibility: string;
  paperCount: number;
}

async function createProject(
  uid: string,
  name: string,
  description?: string,
): Promise<ProjectShape> {
  const res = await call("POST", "/", uid, { name, description });
  expect(res.status).toBe(201);
  return res.body as ProjectShape;
}

/** Seed a paper into the global papers collection (addPaper verifies it exists). */
async function seedPaper(paperId: string): Promise<void> {
  await getFirestore()
    .collection("papers")
    .doc(paperId)
    .set({ paperId, title: paperId, sourceStatus: "available" });
}

/** Seed a user's profile + handle registry entry so handle/id lookups resolve. */
async function seedHandle(uid: string, handle: string): Promise<void> {
  const db = getFirestore();
  await db.collection("users").doc(uid).set({ uid, handle, displayName: handle, createdAt: "2026-01-01T00:00:00Z" });
  await db.collection("handles").doc(handle).set({ uid });
}

/** Add a member to a project's memberUids (simulates a future share). */
async function shareWith(stableId: string, uid: string): Promise<void> {
  const db = getFirestore();
  const ref = db.collection("projects").doc(stableId);
  const snap = await ref.get();
  const members = (snap.data()?.memberUids as string[]) ?? [];
  if (!members.includes(uid)) await ref.update({ memberUids: [...members, uid] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /projects — create", () => {
  it("mints a global stableId + owner-unique id and persists top-level", async () => {
    const p = await createProject(ALICE, "My Research");
    expect(isValidStableId(p.stableId)).toBe(true);
    expect(p.id).toBe("my-research");
    expect(p.ownerUid).toBe(ALICE);
    expect(p.memberUids).toEqual([ALICE]);
    expect(p.visibility).toBe("private");
    expect(p.paperCount).toBe(0);

    // Stored top-level at projects/{stableId}.
    const doc = await getFirestore().collection("projects").doc(p.stableId).get();
    expect(doc.exists).toBe(true);
    expect((doc.data() as ProjectShape).id).toBe("my-research");
  });

  it("denormalizes the owner's handle when the profile has one", async () => {
    await seedHandle(ALICE, "alice");
    const p = await createProject(ALICE, "Has Handle");
    expect(p.ownerHandle).toBe("alice");
  });

  it("keeps a CJK name as the id rather than transliterating or dropping it", async () => {
    const p = await createProject(ALICE, "机器学习");
    expect(p.id).toBe("机器学习");
  });

  it("falls back to the stableId when a name has nothing slug-able", async () => {
    const p = await createProject(ALICE, "🎉🎉🎉");
    expect(p.id).toBe(p.stableId);
    expect(isValidStableId(p.stableId)).toBe(true);
  });

  it("requires a name", async () => {
    const res = await call("POST", "/", ALICE, {});
    expect(res.status).toBe(400);
  });

  it("suffixes ids for duplicate names within an owner, with distinct stableIds", async () => {
    const a = await createProject(ALICE, "Survey");
    const b = await createProject(ALICE, "Survey");
    const c = await createProject(ALICE, "Survey");
    expect([a.id, b.id, c.id]).toEqual(["survey", "survey-2", "survey-3"]);
    expect(new Set([a.stableId, b.stableId, c.stableId]).size).toBe(3);
  });

  it("scopes ids per owner — two users can both have 'survey'", async () => {
    const a = await createProject(ALICE, "Survey");
    const b = await createProject(BOB, "Survey");
    expect(a.id).toBe("survey");
    expect(b.id).toBe("survey");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await call("POST", "/", null, { name: "x" });
    expect(res.status).toBe(401);
  });
});

describe("routing behind the /api/projects hosting rewrite", () => {
  it("strips the mount prefix so prefixed paths route identically", async () => {
    const created = await call("POST", "/api/projects", ALICE, { name: "Via Rewrite" });
    expect(created.status).toBe(201);
    const stableId = (created.body as ProjectShape).stableId;

    const got = await call("GET", `/api/projects/${stableId}`, ALICE);
    expect(got.status).toBe(200);
    expect((got.body as ProjectShape).id).toBe("via-rewrite");

    const list = await call("GET", "/api/projects", ALICE);
    expect(list.status).toBe(200);
    expect((list.body as ProjectShape[]).map((p) => p.name)).toContain("Via Rewrite");
  });
});

describe("GET /projects — list", () => {
  it("returns only projects the caller is a member of", async () => {
    await createProject(ALICE, "A1");
    await createProject(ALICE, "A2");
    await createProject(BOB, "B1");

    const res = await call("GET", "/", ALICE);
    expect(res.status).toBe(200);
    expect((res.body as ProjectShape[]).map((p) => p.name).sort()).toEqual(["A1", "A2"]);
  });

  it("includes a project shared with the caller (membership, not ownership)", async () => {
    const shared = await createProject(BOB, "Shared");
    await shareWith(shared.stableId, ALICE);
    const res = await call("GET", "/", ALICE);
    expect((res.body as ProjectShape[]).map((p) => p.name)).toContain("Shared");
  });
});

describe("GET /projects/:stableId — get by stable key", () => {
  it("returns the caller's project", async () => {
    const p = await createProject(ALICE, "Deep Learning");
    const got = await call("GET", `/${p.stableId}`, ALICE);
    expect(got.status).toBe(200);
    expect((got.body as ProjectShape).id).toBe("deep-learning");
  });

  it("404s for an unknown stableId", async () => {
    expect((await call("GET", "/zzzzzzzz", ALICE)).status).toBe(404);
  });

  it("does not leak a project the caller isn't a member of", async () => {
    const p = await createProject(BOB, "Secret");
    expect((await call("GET", `/${p.stableId}`, ALICE)).status).toBe(404);
  });
});

describe("GET /projects/lookup — resolve by id / handle/id", () => {
  it("resolves the caller's own project by id", async () => {
    const p = await createProject(ALICE, "My Notes");
    const got = await call("GET", "/lookup/my-notes", ALICE);
    expect(got.status).toBe(200);
    expect((got.body as ProjectShape).stableId).toBe(p.stableId);
  });

  it("resolves another owner's project by handle/id only for a member", async () => {
    await seedHandle(BOB, "bob");
    const p = await createProject(BOB, "Bob Project");

    // ALICE is not a member yet → not found (no leak).
    expect((await call("GET", "/lookup/bob/bob-project", ALICE)).status).toBe(404);

    // Share it, then ALICE can resolve it (the sharing seam).
    await shareWith(p.stableId, ALICE);
    const got = await call("GET", "/lookup/bob/bob-project", ALICE);
    expect(got.status).toBe(200);
    expect((got.body as ProjectShape).stableId).toBe(p.stableId);
  });

  it("404s for an unknown handle", async () => {
    expect((await call("GET", "/lookup/nobody/x", ALICE)).status).toBe(404);
  });
});

describe("PATCH /projects/:stableId — rename re-derives id, stableId stays", () => {
  it("renames, re-derives the id, keeps stableId; old id stops resolving", async () => {
    const p = await createProject(ALICE, "Old Name");
    const patched = await call("PATCH", `/${p.stableId}`, ALICE, { name: "New Name" });
    expect(patched.status).toBe(200);
    const updated = patched.body as ProjectShape;
    expect(updated.stableId).toBe(p.stableId);
    expect(updated.id).toBe("new-name");

    expect((await call("GET", "/lookup/new-name", ALICE)).status).toBe(200);
    expect((await call("GET", "/lookup/old-name", ALICE)).status).toBe(404);
  });

  it("renaming avoids colliding with a sibling id", async () => {
    await createProject(ALICE, "Taken");
    const movable = await createProject(ALICE, "Movable");
    const patched = await call("PATCH", `/${movable.stableId}`, ALICE, { name: "Taken" });
    expect(patched.status).toBe(200);
    expect((patched.body as ProjectShape).id).toBe("taken-2");
  });

  it("updates description without changing the id", async () => {
    const p = await createProject(ALICE, "Keep Id");
    const patched = await call("PATCH", `/${p.stableId}`, ALICE, { description: "detail" });
    expect(patched.status).toBe(200);
    expect((patched.body as ProjectShape).id).toBe("keep-id");
    expect((patched.body as ProjectShape).description).toBe("detail");
  });

  it("won't update a project the caller isn't a member of", async () => {
    const p = await createProject(BOB, "Bobs");
    expect((await call("PATCH", `/${p.stableId}`, ALICE, { name: "Hax" })).status).toBe(404);
  });
});

describe("DELETE /projects/:stableId", () => {
  it("deletes by stableId", async () => {
    const p = await createProject(ALICE, "Doomed");
    expect((await call("DELETE", `/${p.stableId}`, ALICE)).status).toBe(200);
    expect((await call("GET", `/${p.stableId}`, ALICE)).status).toBe(404);
  });

  it("won't delete a project the caller isn't a member of", async () => {
    const p = await createProject(BOB, "Bobs");
    expect((await call("DELETE", `/${p.stableId}`, ALICE)).status).toBe(404);
  });
});

describe("papers: add / remove / manifest", () => {
  it("adds a paper, bumps paperCount, saves to library, dedupes, and removes", async () => {
    const p = await createProject(ALICE, "With Papers");
    await seedPaper("arxiv:1706.03762");

    const add = await call("POST", `/${p.stableId}/papers`, ALICE, { paperId: "arxiv:1706.03762" });
    expect(add.status).toBe(201);
    expect((add.body as { memberUids: string[] }).memberUids).toEqual([ALICE]);

    let got = await call("GET", `/${p.stableId}`, ALICE);
    expect((got.body as ProjectShape).paperCount).toBe(1);

    // Filing also saves it to the caller's library (projectPaper ⊆ savedPapers).
    const saved = await getFirestore()
      .collection("users").doc(ALICE).collection("savedPapers").doc("arxiv:1706.03762").get();
    expect(saved.exists).toBe(true);
    expect(saved.data()).toEqual({ paperId: "arxiv:1706.03762", savedAt: expect.any(String) });

    // Duplicate add → conflict.
    const dup = await call("POST", `/${p.stableId}/papers`, ALICE, { paperId: "arxiv:1706.03762" });
    expect(dup.status).toBe(409);

    // Manifest joins the membership with global metadata.
    const manifest = await call("GET", `/${p.stableId}/manifest`, ALICE);
    expect(manifest.status).toBe(200);
    const m = manifest.body as { id: string; papers: { paperId: string }[] };
    expect(m.id).toBe("with-papers");
    expect(m.papers.map((x) => x.paperId)).toEqual(["arxiv:1706.03762"]);

    // Remove drops it and decrements the count.
    const rm = await call("DELETE", `/${p.stableId}/papers/arxiv:1706.03762`, ALICE);
    expect(rm.status).toBe(200);
    got = await call("GET", `/${p.stableId}`, ALICE);
    expect((got.body as ProjectShape).paperCount).toBe(0);
  });

  it("refuses to add a paper that isn't resolved in the global collection", async () => {
    const p = await createProject(ALICE, "No Such Paper");
    const res = await call("POST", `/${p.stableId}/papers`, ALICE, { paperId: "arxiv:0000.00000" });
    expect(res.status).toBe(404);
  });

  it("won't let a non-member file into a project", async () => {
    const p = await createProject(BOB, "Bobs");
    await seedPaper("arxiv:1");
    expect((await call("POST", `/${p.stableId}/papers`, ALICE, { paperId: "arxiv:1" })).status).toBe(404);
  });

  // The CLI classifies a deferred sync by these exact 404 bodies (see
  // apps/cli/src/helpers/sync-status.ts): "Project not found" → no-access (offer
  // invite / unbind / bind), "Paper not found" → uncached (transient retry), and
  // remove's "Paper not in project" → already-gone (no warning). The two 404s for
  // add MUST stay distinguishable by message — status alone can't separate them,
  // and a non-member must not be able to tell "absent" from "forbidden". Lock the
  // strings here so a backend reword can't silently degrade the CLI guidance.
  it("distinguishes no-access from uncached-paper by the 404 message (CLI contract)", async () => {
    // Non-member filing into a real project → "Project not found" (existence-hidden).
    const bobs = await createProject(BOB, "Bobs");
    await seedPaper("arxiv:1");
    const noAccess = await call("POST", `/${bobs.stableId}/papers`, ALICE, { paperId: "arxiv:1" });
    expect(noAccess.status).toBe(404);
    expect((noAccess.body as { error: string }).error).toBe("Project not found");

    // A nonexistent project is byte-identical to a forbidden one (no leak).
    const ghost = await call("POST", `/zzzzzzzz/papers`, ALICE, { paperId: "arxiv:1" });
    expect(ghost.status).toBe(404);
    expect((ghost.body as { error: string }).error).toBe("Project not found");

    // Member filing an uncached paper → a DIFFERENT 404 ("Paper not found …").
    const mine = await createProject(ALICE, "Mine");
    const uncached = await call("POST", `/${mine.stableId}/papers`, ALICE, { paperId: "arxiv:0000.00000" });
    expect(uncached.status).toBe(404);
    expect((uncached.body as { error: string }).error).toMatch(/^Paper not found/);

    // Removing a paper that was never filed → "Paper not in project" (benign).
    const absent = await call("DELETE", `/${mine.stableId}/papers/arxiv:1`, ALICE);
    expect(absent.status).toBe(404);
    expect((absent.body as { error: string }).error).toBe("Paper not in project");
  });

  // Classic arXiv ids carry a `/` (arxiv:hep-ph/0607008). The paperId is used
  // directly as a Firestore doc key in many places; without paperDocId the `/`
  // is read as a path separator and the add/manifest/remove flow 500s. Drive the
  // whole flow end to end to prove the slash is handled at every doc() site.
  it("files, manifests, and removes a classic (slashed) arXiv id end to end", async () => {
    const CLASSIC = "arxiv:hep-ph/0607008";
    const p = await createProject(ALICE, "Classic Papers");

    // Seed the global papers cache at the sanitized doc key, with the canonical
    // slashed paperId in the document body (the form resolve writes).
    await getFirestore()
      .collection("papers")
      .doc(paperDocId(CLASSIC))
      .set({ paperId: CLASSIC, title: "A Classic Paper", sourceStatus: "available" });

    // Add — would throw "documentPath ... even number of components" pre-fix.
    const add = await call("POST", `/${p.stableId}/papers`, ALICE, { paperId: CLASSIC });
    expect(add.status).toBe(201);
    expect((add.body as { paperId: string }).paperId).toBe(CLASSIC);

    // The membership doc is keyed by the sanitized id, but stores the canonical one.
    const memberDoc = await getFirestore()
      .collection("projects").doc(p.stableId)
      .collection("projectPapers").doc(paperDocId(CLASSIC)).get();
    expect(memberDoc.exists).toBe(true);
    expect(memberDoc.data()?.paperId).toBe(CLASSIC);

    // Filing also saved it to the library, again keyed sanitized.
    const saved = await getFirestore()
      .collection("users").doc(ALICE)
      .collection("savedPapers").doc(paperDocId(CLASSIC)).get();
    expect(saved.exists).toBe(true);
    expect(saved.data()?.paperId).toBe(CLASSIC);

    // Manifest joins membership to metadata and surfaces the canonical paperId.
    const manifest = await call("GET", `/${p.stableId}/manifest`, ALICE);
    expect(manifest.status).toBe(200);
    const m = manifest.body as { papers: { paperId: string; title: string }[] };
    expect(m.papers.map((x) => x.paperId)).toEqual([CLASSIC]);
    expect(m.papers[0].title).toBe("A Classic Paper");

    // Remove — the slashed id round-trips through the URL segments and decrements.
    const rm = await call("DELETE", `/${p.stableId}/papers/${CLASSIC}`, ALICE);
    expect(rm.status).toBe(200);
    expect((await call("GET", `/${p.stableId}`, ALICE)).status).toBe(200);
    const got = await call("GET", `/${p.stableId}`, ALICE);
    expect((got.body as ProjectShape).paperCount).toBe(0);
  });
});
