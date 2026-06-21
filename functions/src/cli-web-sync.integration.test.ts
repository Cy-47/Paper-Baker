import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

// Cross-surface (web ↔ CLI) test of data sync. Both surfaces now WRITE through
// the same backend handlers (the web mutates via the Functions API too), so we
// drive the real handlers with auth mocked to x-test-uid → uid. The distinctly
// cross-surface check is that the web's READ path — rules-gated Firestore
// snapshots (@firebase/rules-unit-testing), the exact queries in
// apps/web/src/lib/library.ts — sees what was written via the API. The shared
// contract is the top-level projects/{stableId} + its projectPapers subcollection
// (membership-gated by memberUids), with the global papers/{id} cache as the
// manifest's metadata source.
vi.mock("./middleware/auth.js", () => ({
  requireAuth: vi.fn(async (req: Request) => {
    const uid = req.headers["x-test-uid"] as string | undefined;
    if (!uid) throw { status: 401, message: "Unauthorized" };
    return uid;
  }),
}));

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  initializeTestEnvironment,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  collection,
  collectionGroup,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { handleProjectsRequest } from "./routes/projects.js";
import { handleLibraryRequest } from "./routes/library.js";

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";

const here = dirname(fileURLToPath(import.meta.url));
const rulesPath = join(here, "..", "..", "firebase", "firestore.rules");

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync(rulesPath, "utf8") },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

// --- CLI surface: the real projects handler with a fake req/res. -------------

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

type Handler = (req: Request, res: Response) => Promise<void>;

async function callHandler(
  handler: Handler,
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

  await handler(req, res);
  return { status, body: (json ?? {}) as Record<string, unknown> };
}

// Both surfaces use the same backend handlers; the names mark intent in tests.
const cli = (method: string, path: string, uid: string | null, body?: unknown) =>
  callHandler(handleProjectsRequest, method, path, uid, body);
const projectsApiCall = cli;
const libraryApiCall = (method: string, path: string, uid: string | null, body?: unknown) =>
  callHandler(handleLibraryRequest, method, path, uid, body);

/** Seed the global papers cache, as the papers API resolve step does. */
async function seedPaper(paperId: string, title = paperId): Promise<void> {
  await getFirestore()
    .collection("papers")
    .doc(paperId)
    .set({ paperId, title, sourceStatus: "available" });
}

// --- Web WRITES: through the backend API (library.ts → api-client). ----------

/** library.ts → createProject (POST /projects, backend mints stableId + id). */
async function webCreateProject(
  uid: string,
  name: string,
): Promise<{ stableId: string; id: string }> {
  const res = await projectsApiCall("POST", "/", uid, { name });
  return { stableId: res.body.stableId as string, id: res.body.id as string };
}

/**
 * library.ts → addPaperToProject: save to library (POST /library {source} →
 * resolve + thin savedPapers) then file (POST /projects/:stableId/papers). The
 * paper's metadata must already be cached in papers/ (seeded by the caller).
 */
async function webFilePaper(
  uid: string,
  stableId: string,
  paperId: string,
): Promise<void> {
  const arxivId = paperId.split(":")[1];
  await libraryApiCall("POST", "/", uid, { source: { type: "arxiv", id: arxivId } });
  await projectsApiCall("POST", `/${stableId}/papers`, uid, { paperId });
}

// --- Web READS: rules-gated client, the exact queries in library.ts. ---------

function webDb(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

/** library.ts → subscribeSavedPapers (one-shot read of the owner's saved set). */
async function webSavedPapers(uid: string): Promise<string[]> {
  const snap = await assertSucceeds(getDocs(collection(webDb(uid), "users", uid, "savedPapers")));
  return snap.docs.map((d) => d.id);
}

/** library.ts → subscribeProjects (one-shot read of the caller's projects). */
async function webProjects(uid: string): Promise<{ stableId: string; name: string }[]> {
  const q = query(collection(webDb(uid), "projects"), where("memberUids", "array-contains", uid));
  const snap = await assertSucceeds(getDocs(q));
  return snap.docs.map((d) => ({
    stableId: d.id,
    name: (d.data().name as string) ?? "",
  }));
}

/** library.ts → subscribeMemberships (collectionGroup, membership-scoped). */
async function webMemberships(uid: string): Promise<{ paperId: string; projectStableId: string }[]> {
  const q = query(collectionGroup(webDb(uid), "projectPapers"), where("memberUids", "array-contains", uid));
  const snap = await assertSucceeds(getDocs(q));
  return snap.docs.map((d) => ({
    paperId: d.data().paperId as string,
    projectStableId: d.data().projectStableId as string,
  }));
}

describe("web ↔ CLI data sync — shared projects + memberships", () => {
  it("a project + paper filed on the CLI is visible to the web", async () => {
    const paperId = "arxiv:1706.03762";
    const created = await cli("POST", "/", ALICE, { name: "From The CLI" });
    expect(created.status).toBe(201);
    const stableId = created.body.stableId as string;

    await seedPaper(paperId);
    const add = await cli("POST", `/${stableId}/papers`, ALICE, { paperId });
    expect(add.status).toBe(201);

    // The web app (rules-gated) sees the project …
    const projects = await webProjects(ALICE);
    expect(projects.map((p) => p.stableId)).toContain(stableId);
    expect(projects.find((p) => p.stableId === stableId)?.name).toBe("From The CLI");

    // … the membership via its collectionGroup query …
    const memberships = await webMemberships(ALICE);
    expect(memberships).toContainEqual({ paperId, projectStableId: stableId });

    // … and the paper saved to the library (projectPaper ⊆ savedPapers), so it
    // shows up in the web Library, not just as a project membership.
    expect(await webSavedPapers(ALICE)).toContain(paperId);
  });

  it("a project + paper filed on the web is visible to the CLI (manifest joins the global cache)", async () => {
    const paperId = "arxiv:1810.04805";
    await seedPaper(paperId, "BERT"); // resolved earlier, as the web save path assumes

    const { stableId, id } = await webCreateProject(ALICE, "From The Web");
    await webFilePaper(ALICE, stableId, paperId);

    // The CLI resolves the web-created project by its stable key and by id …
    const byId = await cli("GET", `/${stableId}`, ALICE);
    expect(byId.status).toBe(200);
    expect(byId.body.id).toBe("from-the-web");
    expect((await cli("GET", `/lookup/${id}`, ALICE)).status).toBe(200);

    // … and the manifest surfaces the web-filed paper, joined to its metadata.
    const manifest = await cli("GET", `/${stableId}/manifest`, ALICE);
    expect(manifest.status).toBe(200);
    const papers = manifest.body.papers as { paperId: string; title: string }[];
    expect(papers.map((p) => p.paperId)).toEqual([paperId]);
    expect(papers[0].title).toBe("BERT");
  });

  it("memberships stay per-user — one user's filing never leaks into another's view", async () => {
    const paperId = "arxiv:1706.03762";
    const created = await cli("POST", "/", ALICE, { name: "Alice Only" });
    const stableId = created.body.stableId as string;
    await seedPaper(paperId);
    await cli("POST", `/${stableId}/papers`, ALICE, { paperId });

    // Bob, reading via the same owner-scoped collectionGroup query, sees nothing.
    expect(await webMemberships("bob-uid")).toEqual([]);
  });
});
