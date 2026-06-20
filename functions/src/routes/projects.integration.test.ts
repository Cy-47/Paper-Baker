import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { isValidProjectId } from "@paper-baker/core";

// High-level integration tests for the projects API, driven directly against the
// Firestore emulator. Only token verification is mocked — every Firestore read,
// write, transaction, and the full id/slug/rename logic runs for real. Auth maps
// an `x-test-uid` header straight to a uid so we can exercise per-user isolation.
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
  // Wipe the emulator between tests so each starts from a clean slate.
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

// ---------------------------------------------------------------------------
// Test harness: invoke the handler with a fake req/res and capture the response.
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
  projectId: string;
  slug: string;
  name: string;
  description: string;
  ownerUid: string;
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /projects — create", () => {
  it("mints a valid stable id + slug and persists under the owner", async () => {
    const p = await createProject(ALICE, "My Research");
    expect(isValidProjectId(p.projectId)).toBe(true);
    expect(p.slug).toBe("my-research");
    expect(p.ownerUid).toBe(ALICE);
    expect(p.paperCount).toBe(0);

    // Stored at users/{uid}/projects/{id}
    const doc = await getFirestore()
      .collection("users")
      .doc(ALICE)
      .collection("projects")
      .doc(p.projectId)
      .get();
    expect(doc.exists).toBe(true);
    expect((doc.data() as ProjectShape).slug).toBe("my-research");
  });

  it("requires a name", async () => {
    const res = await call("POST", "/", ALICE, {});
    expect(res.status).toBe(400);
  });

  it("suffixes slugs for duplicate names within a user", async () => {
    const a = await createProject(ALICE, "Survey");
    const b = await createProject(ALICE, "Survey");
    const c = await createProject(ALICE, "Survey");
    expect([a.slug, b.slug, c.slug]).toEqual(["survey", "survey-2", "survey-3"]);
    // Distinct stable ids despite identical names.
    expect(new Set([a.projectId, b.projectId, c.projectId]).size).toBe(3);
  });

  it("scopes slugs per user — two users can both have 'survey'", async () => {
    const a = await createProject(ALICE, "Survey");
    const b = await createProject(BOB, "Survey");
    expect(a.slug).toBe("survey");
    expect(b.slug).toBe("survey");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await call("POST", "/", null, { name: "x" });
    expect(res.status).toBe(401);
  });
});

describe("PUT /projects/:id — idempotent create-with-id", () => {
  it("creates a project at the client-supplied id with a fresh slug", async () => {
    const res = await call("PUT", "/ab3f", ALICE, { name: "Synced Project" });
    expect(res.status).toBe(201);
    const p = res.body as ProjectShape;
    expect(p.projectId).toBe("ab3f");
    expect(p.slug).toBe("synced-project");
    expect(p.ownerUid).toBe(ALICE);

    const doc = await getFirestore()
      .collection("users").doc(ALICE)
      .collection("projects").doc("ab3f")
      .get();
    expect(doc.exists).toBe(true);
  });

  it("is idempotent: a second PUT returns the existing project untouched (200)", async () => {
    const first = await call("PUT", "/ab3f", ALICE, { name: "Synced Project" });
    expect(first.status).toBe(201);
    const second = await call("PUT", "/ab3f", ALICE, { name: "Different Name" });
    expect(second.status).toBe(200);
    // The id existed, so the original name/slug are preserved (not clobbered).
    expect((second.body as ProjectShape).name).toBe("Synced Project");
    expect((second.body as ProjectShape).slug).toBe("synced-project");
  });

  it("lets the same id live under two accounts (per-user scoping)", async () => {
    const a = await call("PUT", "/ab3f", ALICE, { name: "Mine" });
    const b = await call("PUT", "/ab3f", BOB, { name: "Also Mine" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect((a.body as ProjectShape).name).toBe("Mine");
    expect((b.body as ProjectShape).name).toBe("Also Mine");
  });

  it("rejects a name-less body and an id that isn't a valid stable id", async () => {
    expect((await call("PUT", "/ab3f", ALICE, {})).status).toBe(400);
    // A slug-shaped id is not a valid stable id — PUT must not mint a doc for it.
    expect((await call("PUT", "/not-an-id", ALICE, { name: "x" })).status).toBe(400);
  });

  it("rejects unauthenticated requests", async () => {
    const res = await call("PUT", "/ab3f", null, { name: "x" });
    expect(res.status).toBe(401);
  });
});

describe("routing behind the /api/projects hosting rewrite", () => {
  it("strips the mount prefix so prefixed paths route identically", async () => {
    const created = await call("POST", "/api/projects", ALICE, { name: "Via Rewrite" });
    expect(created.status).toBe(201);
    const id = (created.body as ProjectShape).projectId;

    const got = await call("GET", `/api/projects/${id}`, ALICE);
    expect(got.status).toBe(200);
    expect((got.body as ProjectShape).slug).toBe("via-rewrite");

    const list = await call("GET", "/api/projects", ALICE);
    expect(list.status).toBe(200);
    expect((list.body as ProjectShape[]).map((p) => p.name)).toContain("Via Rewrite");
  });
});

describe("GET /projects — list", () => {
  it("returns only the caller's projects", async () => {
    await createProject(ALICE, "A1");
    await createProject(ALICE, "A2");
    await createProject(BOB, "B1");

    const res = await call("GET", "/", ALICE);
    expect(res.status).toBe(200);
    const projects = res.body as ProjectShape[];
    expect(projects.map((p) => p.name).sort()).toEqual(["A1", "A2"]);
  });
});

describe("GET /projects/:id — resolve by id OR slug", () => {
  it("resolves by stable id and by slug", async () => {
    const p = await createProject(ALICE, "Deep Learning");

    const byId = await call("GET", `/${p.projectId}`, ALICE);
    expect(byId.status).toBe(200);
    expect((byId.body as ProjectShape).slug).toBe("deep-learning");

    const bySlug = await call("GET", "/deep-learning", ALICE);
    expect(bySlug.status).toBe(200);
    expect((bySlug.body as ProjectShape).projectId).toBe(p.projectId);
  });

  it("404s for an unknown id/slug", async () => {
    const res = await call("GET", "/nope", ALICE);
    expect(res.status).toBe(404);
  });

  it("does not leak another user's project", async () => {
    const p = await createProject(BOB, "Secret");
    const res = await call("GET", `/${p.projectId}`, ALICE);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /projects/:id — rename re-slugs, id stays stable", () => {
  it("renames, re-slugs, and keeps the same projectId; old slug stops resolving", async () => {
    const p = await createProject(ALICE, "Old Name");

    const patched = await call("PATCH", `/${p.projectId}`, ALICE, {
      name: "New Name",
    });
    expect(patched.status).toBe(200);
    const updated = patched.body as ProjectShape;
    expect(updated.projectId).toBe(p.projectId); // stable id unchanged
    expect(updated.slug).toBe("new-name");

    // New slug resolves; old slug no longer does.
    expect((await call("GET", "/new-name", ALICE)).status).toBe(200);
    expect((await call("GET", "/old-name", ALICE)).status).toBe(404);
  });

  it("renaming by slug works and avoids colliding with a sibling slug", async () => {
    await createProject(ALICE, "Taken");
    await createProject(ALICE, "Movable");

    const patched = await call("PATCH", "/movable", ALICE, { name: "Taken" });
    expect(patched.status).toBe(200);
    // Slug must dodge the existing "taken".
    expect((patched.body as ProjectShape).slug).toBe("taken-2");
  });

  it("updates description without changing the slug", async () => {
    const p = await createProject(ALICE, "Keep Slug");
    const patched = await call("PATCH", `/${p.projectId}`, ALICE, {
      description: "now with detail",
    });
    expect(patched.status).toBe(200);
    const updated = patched.body as ProjectShape;
    expect(updated.slug).toBe("keep-slug");
    expect(updated.description).toBe("now with detail");
  });
});

describe("DELETE /projects/:id", () => {
  it("deletes by slug", async () => {
    const p = await createProject(ALICE, "Doomed");
    const del = await call("DELETE", "/doomed", ALICE);
    expect(del.status).toBe(200);
    expect((await call("GET", `/${p.projectId}`, ALICE)).status).toBe(404);
  });
});

describe("papers: add / remove / manifest", () => {
  it("adds a paper, bumps paperCount, dedupes, and removes", async () => {
    const p = await createProject(ALICE, "With Papers");
    await seedPaper("arxiv:1706.03762");

    // Add by slug
    const add = await call("POST", "/with-papers/papers", ALICE, {
      paperId: "arxiv:1706.03762",
    });
    expect(add.status).toBe(201);

    let got = await call("GET", `/${p.projectId}`, ALICE);
    expect((got.body as ProjectShape).paperCount).toBe(1);

    // Filing a paper also saves it to the library (projectPaper ⊆ savedPapers):
    // a thin record with only the id + savedAt, no metadata.
    const saved = await getFirestore()
      .collection("users")
      .doc(ALICE)
      .collection("savedPapers")
      .doc("arxiv:1706.03762")
      .get();
    expect(saved.exists).toBe(true);
    expect(saved.data()).toEqual({
      paperId: "arxiv:1706.03762",
      savedAt: expect.any(String),
    });

    // Adding the same paper again is a conflict
    const dup = await call("POST", "/with-papers/papers", ALICE, {
      paperId: "arxiv:1706.03762",
    });
    expect(dup.status).toBe(409);

    // Manifest joins the item with its global metadata
    const manifest = await call("GET", "/with-papers/manifest", ALICE);
    expect(manifest.status).toBe(200);
    const m = manifest.body as { slug: string; papers: { paperId: string }[] };
    expect(m.slug).toBe("with-papers");
    expect(m.papers.map((x) => x.paperId)).toEqual(["arxiv:1706.03762"]);

    // Remove drops it and decrements the count
    const rm = await call(
      "DELETE",
      `/${p.projectId}/papers/arxiv:1706.03762`,
      ALICE,
    );
    expect(rm.status).toBe(200);
    got = await call("GET", `/${p.projectId}`, ALICE);
    expect((got.body as ProjectShape).paperCount).toBe(0);
  });

  it("refuses to add a paper that isn't resolved in the global collection", async () => {
    await createProject(ALICE, "No Such Paper");
    const res = await call("POST", "/no-such-paper/papers", ALICE, {
      paperId: "arxiv:0000.00000",
    });
    expect(res.status).toBe(404);
  });
});
