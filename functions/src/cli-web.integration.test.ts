import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { createServer, type Server } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { handleProjectsRequest } from "./routes/projects.js";
import { handlePapersRequest } from "./routes/papers.js";
import { handleLibraryRequest } from "./routes/library.js";
import { handleDeviceRequest } from "./routes/device.js";
import { mintAccessToken } from "./lib/cliSessions.js";

// ---------------------------------------------------------------------------
// Comprehensive CLI <-> web integration suite.
//
// Every aspect of the two surfaces talking to one shared backend is exercised
// end-to-end with NOTHING mocked:
//   - CLI  = the REAL built `pb` binary, authed with a REAL opaque pbk token,
//            making REAL HTTP calls.
//   - web  = REAL HTTP calls carrying a REAL Firebase ID token (the credential
//            the web app uses), hitting the SAME backend handlers.
//   - both land on the REAL route handlers behind the REAL `requireAuth` gate,
//            backed by the Firestore + Auth emulators.
//
// The only stand-ins are local fixture servers: one adapts the handlers behind
// a bare http server (URL routing identical to the hosting rewrites), and one
// stubs arxiv (metadata + e-print) so the `add`/`sync` paths stay hermetic —
// no live network, no flakiness. The global papers/ cache is pre-seeded so the
// backend's own resolve step is a cache hit.
// ---------------------------------------------------------------------------

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";
const BOB = "bob-uid";
const FAKE_API_KEY = "fake-api-key"; // the auth emulator accepts any non-empty key

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cliEntry = join(repoRoot, "apps", "cli", "dist", "index.js");

const ARXIV_ID = "1706.03762";
const PAPER_ID = `arxiv:${ARXIV_ID}`;
const PAPER_TITLE = "Attention Is All You Need";

// The metadata as it lives in the global papers/ cache (a prior resolve). The
// CLI re-derives an equivalent record from the arxiv fixture feed below.
const PAPER = {
  paperId: PAPER_ID,
  source: { type: "arxiv", id: ARXIV_ID },
  title: PAPER_TITLE,
  abstract: "We propose the Transformer, based solely on attention mechanisms.",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  publishedAt: "2017-06-12T00:00:00Z",
  categories: ["cs.CL"],
  links: {
    abs: "https://arxiv.org/abs/1706.03762",
    pdf: "https://arxiv.org/pdf/1706.03762",
    source: "https://arxiv.org/e-print/1706.03762",
  },
  sourceStatus: "available",
};

// A minimal but valid arxiv Atom feed for the fixture /query endpoint. parseEntry
// only needs <id> (for the id), <title> (non-empty => "found"), and a category.
const ARXIV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/${ARXIV_ID}v5</id>
    <updated>2017-12-06T00:00:00Z</updated>
    <published>2017-06-12T00:00:00Z</published>
    <title>${PAPER_TITLE}</title>
    <summary>We propose the Transformer, based solely on attention mechanisms.</summary>
    <author><name>Ashish Vaswani</name></author>
    <link href="http://arxiv.org/abs/${ARXIV_ID}v5" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/${ARXIV_ID}v5" rel="related" type="application/pdf"/>
    <arxiv:primary_category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

// A gzipped single .tex "e-print". The download helper tries tar first (fails),
// then `gunzip -c > main.tex` (succeeds) — exactly arxiv's single-file case.
const EPRINT_GZ = gzipSync(
  Buffer.from(
    "\\documentclass{article}\\begin{document}Attention.\\end{document}\n",
  ),
);

let backend: Server;
let arxiv: Server;
let apiBase: string; // http://127.0.0.1:PORT/api
let arxivQueryUrl: string; // http://127.0.0.1:PORT/query
let arxivEprintUrl: string; // http://127.0.0.1:PORT/e-print

// ---------------------------------------------------------------------------
// Backend: adapt the real handlers behind a bare http server.
// ---------------------------------------------------------------------------

function startBackend(): Promise<Server> {
  const server = createServer((httpReq, httpRes) => {
    const chunks: Buffer[] = [];
    httpReq.on("data", (c) => chunks.push(c as Buffer));
    httpReq.on("end", () => {
      void (async () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const url = new URL(httpReq.url ?? "/", "http://localhost");
        const req = {
          method: httpReq.method,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams),
          body: raw ? JSON.parse(raw) : {},
          headers: httpReq.headers,
        } as unknown as Request;

        let status = 200;
        const res = {
          status(code: number) {
            status = code;
            return this;
          },
          json(payload: unknown) {
            httpRes.writeHead(status, { "content-type": "application/json" });
            httpRes.end(JSON.stringify(payload));
            return this;
          },
        } as unknown as Response;

        const p = url.pathname;
        if (p.startsWith("/api/projects")) await handleProjectsRequest(req, res);
        else if (p.startsWith("/api/papers")) await handlePapersRequest(req, res);
        else if (p.startsWith("/api/library")) await handleLibraryRequest(req, res);
        else if (p.startsWith("/api/device")) await handleDeviceRequest(req, res);
        else {
          httpRes.writeHead(404);
          httpRes.end();
        }
      })().catch((e) => {
        httpRes.writeHead(500);
        httpRes.end(String(e));
      });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

// ---------------------------------------------------------------------------
// arxiv fixture: metadata feed + gzipped e-print.
// ---------------------------------------------------------------------------

function startArxiv(): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/query")) {
      res.writeHead(200, { "content-type": "application/atom+xml" });
      res.end(ARXIV_FEED);
    } else if (url.pathname.startsWith("/e-print/")) {
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(EPRINT_GZ);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server)),
  );
}

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });

  execFileSync("pnpm", ["--filter", "@paper-baker/cli", "build"], {
    cwd: repoRoot,
    stdio: "ignore",
    timeout: 180_000,
  });

  backend = await startBackend();
  arxiv = await startArxiv();
  const backendPort = (backend.address() as { port: number }).port;
  const arxivPort = (arxiv.address() as { port: number }).port;
  apiBase = `http://127.0.0.1:${backendPort}/api`;
  arxivQueryUrl = `http://127.0.0.1:${arxivPort}/query`;
  arxivEprintUrl = `http://127.0.0.1:${arxivPort}/e-print`;
}, 200_000);

afterAll(() => {
  backend?.close();
  arxiv?.close();
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

// ---------------------------------------------------------------------------
// Auth + seeding helpers.
// ---------------------------------------------------------------------------

/** Seed an active CLI session (as device-link consume does); return its token. */
async function seedSession(
  connectionId: string,
  uid: string = ALICE,
): Promise<string> {
  const { token, tokenHash } = mintAccessToken(connectionId);
  const db = getFirestore();
  await db
    .collection("cliSessions")
    .doc(connectionId)
    .set({ connectionId, uid, tokenHash, createdAt: "" });
  await db
    .collection("users")
    .doc(uid)
    .collection("clis")
    .doc(connectionId)
    .set({
      connectionId,
      uid,
      status: "active",
      device: {},
      createdAt: "",
      lastSeenAt: "",
    });
  return token;
}

/** Pre-seed the global papers/ cache so the backend resolve step is a cache hit. */
async function seedPaperCache(): Promise<void> {
  await getFirestore().collection("papers").doc(PAPER_ID).set(PAPER);
}

/** Seed a user's public profile + handle registry so `handle/id` lookups resolve
 * and `create` can denormalize the owner's handle. */
async function seedHandle(uid: string, handle: string): Promise<void> {
  const db = getFirestore();
  await db
    .collection("users")
    .doc(uid)
    .set({ uid, handle, displayName: handle, createdAt: "2026-01-01T00:00:00Z" });
  await db.collection("handles").doc(handle).set({ uid });
}

/** Add a member to a project's memberUids — stands in for the (deferred) sharing
 * flow, which is purely additive: dropping a uid into the array is the whole grant. */
async function shareWith(stableId: string, uid: string): Promise<void> {
  await getFirestore()
    .collection("projects")
    .doc(stableId)
    .update({ memberUids: FieldValue.arrayUnion(uid) });
}

/** A real Firebase ID token for `uid` (the web app's credential). */
async function firebaseIdToken(uid: string): Promise<string> {
  const custom = await getAuth().createCustomToken(uid);
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(
    `http://${host}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${FAKE_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  );
  const json = (await res.json()) as { idToken?: string };
  if (!json.idToken) throw new Error("emulator did not return an idToken");
  return json.idToken;
}

interface ApiResult {
  status: number;
  body: Record<string, unknown>;
}

/** Drive the backend HTTP API as the WEB does: a Firebase ID token over fetch. */
async function web(
  uid: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResult> {
  const idToken = await firebaseIdToken(uid);
  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, body: json };
}

/** Web files a (cache-seeded) paper into a project: save to library, then file. */
async function webFile(uid: string, projectId: string): Promise<void> {
  await web(uid, "POST", "/library", { source: PAPER.source });
  await web(uid, "POST", `/projects/${projectId}/papers`, { paperId: PAPER_ID });
}

// ---------------------------------------------------------------------------
// CLI runner. ASYNC on purpose — a sync spawn deadlocks against this process's
// firebase-admin gRPC client (see cli-sync.integration.test.ts). A clean env
// keeps vitest's loader out of the child.
// ---------------------------------------------------------------------------

const execFileAsync = promisify(execFile);

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function pbEnv(token: string, configDir: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    PAPERBAKER_API_URL: apiBase,
    PAPERBAKER_TOKEN: token,
    PAPERBAKER_CONFIG_DIR: configDir,
    PAPERBAKER_ARXIV_API_URL: arxivQueryUrl,
    PAPERBAKER_ARXIV_EPRINT_URL: arxivEprintUrl,
    PAPERBAKER_QUIET: "1",
  };
}

/** Run pb; throw on non-zero exit. Returns stdout. */
async function pb(
  args: string[],
  cwd: string,
  token: string,
  configDir: string,
): Promise<string> {
  const { stdout } = await execFileAsync("node", [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: pbEnv(token, configDir),
  });
  return stdout;
}

/** Run pb with NO credential (offline): no token env. Models creating a project
 * before logging in. Throws on non-zero exit. */
async function pbNoAuth(
  args: string[],
  cwd: string,
  configDir: string,
): Promise<string> {
  const env = pbEnv("", configDir);
  delete env.PAPERBAKER_TOKEN;
  const { stdout } = await execFileAsync("node", [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env,
  });
  return stdout;
}

/** Run pb; never throw. Returns exit status + streams (for failure paths). */
async function pbTry(
  args: string[],
  cwd: string,
  token: string,
  configDir: string,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [cliEntry, ...args], {
      cwd,
      encoding: "utf8",
      timeout: 30_000,
      env: pbEnv(token, configDir),
    });
    return { status: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      status: err.code ?? 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

// ---------------------------------------------------------------------------
// Per-test scratch dirs + small readers.
// ---------------------------------------------------------------------------

interface Workspace {
  work: string;
  cfg: string;
  cleanup: () => void;
}

function makeWorkspace(): Workspace {
  const work = mkdtempSync(join(tmpdir(), "pb-cliweb-"));
  const cfg = mkdtempSync(join(tmpdir(), "pb-cliweb-cfg-"));
  return {
    work,
    cfg,
    cleanup: () => {
      rmSync(work, { recursive: true, force: true });
      rmSync(cfg, { recursive: true, force: true });
    },
  };
}

interface ProjectConfig {
  name?: string;
  stableId?: string;
  id?: string;
  ownerHandle?: string;
}

function readConfig(work: string): ProjectConfig {
  return JSON.parse(
    readFileSync(join(work, "paperbaker", "config.json"), "utf8"),
  ) as ProjectConfig;
}

function boundProjectId(work: string): string {
  const cfg = readConfig(work);
  if (!cfg.stableId) throw new Error("project is not synced (no stableId)");
  return cfg.stableId;
}

/** Create a project while logged in — `create` publishes it immediately (mints
 * the id + creates the server doc), so it's synced from birth. */
async function createSynced(
  name: string,
  work: string,
  token: string,
  cfg: string,
): Promise<string> {
  await pb(["project", "create", name], work, token, cfg);
  return boundProjectId(work);
}

function localPapers(work: string): Array<{ paperId: string }> {
  const p = join(work, "paperbaker", "papers.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf8")) as Array<{ paperId: string }>;
}

function refsBib(work: string): string {
  const p = join(work, "paperbaker", "refs.bib");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

// Server-state readers (the "what landed on the backend" assertions).
// Projects are top-level now (projects/{stableId}) — keyed by stableId, not uid.
function membershipDoc(stableId: string, paperId = PAPER_ID) {
  return getFirestore()
    .collection("projects")
    .doc(stableId)
    .collection("projectPapers")
    .doc(paperId)
    .get();
}

function savedDoc(uid: string, paperId = PAPER_ID) {
  return getFirestore()
    .collection("users")
    .doc(uid)
    .collection("savedPapers")
    .doc(paperId)
    .get();
}

// ===========================================================================
// A. CLI mutations write to the server directly once the project is synced.
// ===========================================================================

describe("CLI mutations land on the server immediately", () => {
  it("`pb add` files the paper to the server with no separate publish step", async () => {
    const token = await seedSession("conn-add", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await createSynced("Alpha", work, token, cfg);
      const out = await pb(["add", ARXIV_ID], work, token, cfg);
      expect(out).toContain("Added:");
      expect(out).not.toMatch(/could not update the server/i);

      const projectId = boundProjectId(work);
      // Membership AND the implied library save both exist on the backend —
      // immediately, from `add` alone.
      expect((await membershipDoc(projectId)).exists).toBe(true);
      expect((await savedDoc(ALICE)).exists).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("`pb remove` deletes the membership on the server", async () => {
    const token = await seedSession("conn-rm", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Beta", work, token, cfg);
      await webFile(ALICE, projectId); // server now holds the membership
      // Mirror it into local state so `remove` can find + drop it.
      writeFileSync(
        join(work, "paperbaker", "papers.json"),
        JSON.stringify([PAPER], null, 2),
      );

      const out = await pb(["remove", PAPER_ID], work, token, cfg);
      expect(out).toContain("Removed:");
      expect((await membershipDoc(projectId)).exists).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("`pb add` surfaces a warning (but still writes locally) when the remote is gone", async () => {
    const token = await seedSession("conn-warn", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Gamma", work, token, cfg);
      // The web deletes the project out from under the bound CLI directory.
      expect((await web(ALICE, "DELETE", `/projects/${projectId}`)).status).toBe(200);

      const res = await pbTry(["add", ARXIV_ID], work, token, cfg);
      expect(res.status).toBe(0); // local add still succeeds
      expect(res.stdout).toContain("Added:");
      // The mirror failure is surfaced, not swallowed.
      expect(`${res.stdout}${res.stderr}`).toMatch(/could not update the server/i);
      // Local state reflects the add even though the server rejected it.
      expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// B. Project lifecycle (create / sync / rename / delete) across surfaces.
// ===========================================================================

describe("project lifecycle is shared between CLI and web", () => {
  it("`pb project create` publishes immediately; the web sees it", async () => {
    const token = await seedSession("conn-create", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const out = await pb(["project", "create", "Shared"], work, token, cfg);
      expect(out).toMatch(/Created "Shared"/);
      expect(out).toMatch(/id: shared/);

      const list = await web(ALICE, "GET", "/projects");
      const projects = list.body as unknown as Array<{ id: string; name: string }>;
      expect(projects.map((p) => p.id)).toContain("shared");
    } finally {
      cleanup();
    }
  });

  it("`pb project rename` updates the project on the server", async () => {
    const token = await seedSession("conn-rename", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Old Name", work, token, cfg);
      const out = await pb(["project", "rename", "New Name"], work, token, cfg);
      expect(out).toMatch(/id: new-name/);

      const got = await web(ALICE, "GET", `/projects/${projectId}`);
      expect(got.body.name).toBe("New Name");
      expect(got.body.id).toBe("new-name");
    } finally {
      cleanup();
    }
  });

  it("`pb project delete` removes the project from the server", async () => {
    const token = await seedSession("conn-del", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Doomed", work, token, cfg);
      await pb(["project", "delete", "--yes"], work, token, cfg);

      expect((await web(ALICE, "GET", `/projects/${projectId}`)).status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it("an offline `create` then `pb sync` publishes the project and files its papers", async () => {
    const token = await seedSession("conn-push", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      // Created before logging in: local-only, so the first sync does the publish.
      await pbNoAuth(["project", "create", "Offline"], work, cfg);
      expect(() => boundProjectId(work)).toThrow(); // no stableId yet
      writeFileSync(
        join(work, "paperbaker", "papers.json"),
        JSON.stringify([PAPER], null, 2),
      );
      const out = await pb(["sync"], work, token, cfg);
      expect(out).toMatch(/Published as "Offline"/);
      expect(out).toMatch(/pushed 1 paper/);

      const projectId = boundProjectId(work);
      expect((await membershipDoc(projectId)).exists).toBe(true);
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// C. Web mutations, CLI reads them back (the pull direction).
// ===========================================================================

describe("CLI reads back what the web wrote", () => {
  it("`pb sync` pulls a paper the web filed into a CLI-created project", async () => {
    const token = await seedSession("conn-sync", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Pullable", work, token, cfg);
      await webFile(ALICE, projectId); // web adds the paper

      // Before the next sync the CLI hasn't heard about it.
      expect(localPapers(work)).toHaveLength(0);

      const out = await pb(["sync"], work, token, cfg);
      expect(out).toMatch(/1 paper\(s\) total/);
      expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
      expect(refsBib(work)).toContain(PAPER_TITLE);
    } finally {
      cleanup();
    }
  });

  it("`pb project bind --replace-local` adopts a wholly web-created project", async () => {
    const token = await seedSession("conn-bind", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const created = await web(ALICE, "POST", "/projects", { name: "Web Made" });
      const projectId = created.body.stableId as string;
      await webFile(ALICE, projectId);

      const out = await pb(
        ["project", "bind", "web-made", "--replace-local"],
        work,
        token,
        cfg,
      );
      expect(out).toMatch(/Bound to "Web Made"/);
      expect(boundProjectId(work)).toBe(projectId);
      expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
    } finally {
      cleanup();
    }
  });

  it("a web rename is visible to the CLI's `project list`", async () => {
    const token = await seedSession("conn-relist", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Before", work, token, cfg);
      await web(ALICE, "PATCH", `/projects/${projectId}`, { name: "After" });

      const list = await pb(["project", "list"], work, token, cfg);
      expect(list).toContain("after"); // new slug
      expect(list).toContain("After"); // new name
    } finally {
      cleanup();
    }
  });

  it("sync is never-drop: a web unsave doesn't delete a paper the CLI still holds", async () => {
    const token = await seedSession("conn-unsave", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const projectId = await createSynced("Churn", work, token, cfg);
      await webFile(ALICE, projectId);
      await pb(["sync"], work, token, cfg);
      expect(localPapers(work)).toHaveLength(1);

      // The web unsaves it (also unfiles it from every project)…
      expect((await web(ALICE, "DELETE", `/library/${encodeURIComponent(PAPER_ID)}`)).status).toBe(200);

      // …but sync unions local up rather than letting the server delete it — this
      // is exactly what makes syncing onto a fresh/empty account non-destructive.
      // The locally-held paper is re-filed, not dropped.
      await pb(["sync"], work, token, cfg);
      expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
      expect((await membershipDoc(projectId)).exists).toBe(true);

      // The way to drop a paper is `pb remove`, which also deletes it server-side.
      await pb(["remove", PAPER_ID], work, token, cfg);
      expect(localPapers(work)).toHaveLength(0);
      expect((await membershipDoc(projectId)).exists).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// D. Cross-cutting: per-user isolation and per-CLI revocation.
// ===========================================================================

describe("isolation and revocation across the seam", () => {
  it("one user's projects never appear to another", async () => {
    const aliceToken = await seedSession("conn-alice", ALICE);
    const bobToken = await seedSession("conn-bob", BOB);
    const alice = makeWorkspace();
    const bob = makeWorkspace();
    try {
      await createSynced("Alice Secret", alice.work, aliceToken, alice.cfg);

      // Bob lists nothing, and cannot bind to Alice's slug.
      const bobList = await pb(["project", "list"], bob.work, bobToken, bob.cfg);
      expect(bobList).not.toContain("alice-secret");
      expect(bobList).toMatch(/No projects yet/);

      const bind = await pbTry(
        ["project", "bind", "alice-secret"],
        bob.work,
        bobToken,
        bob.cfg,
      );
      expect(bind.status).not.toBe(0);
      expect(bind.stderr).toMatch(/no project 'alice-secret' found/i);
    } finally {
      alice.cleanup();
      bob.cleanup();
    }
  });

  it("a web 'Delete CLI' revokes the live token's very next call", async () => {
    const token = await seedSession("conn-revoke", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      // The token works…
      await pb(["project", "list"], work, token, cfg);

      // …until the web tab deletes the connection.
      expect((await web(ALICE, "DELETE", "/device/connections/conn-revoke")).status).toBe(200);

      const res = await pbTry(["project", "list"], work, token, cfg);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/revok|401/i);
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// E. Changing the remote: bind, unbind, and re-point a directory.
//
// The binding lives entirely in config.json (keyed by the immutable stableId);
// changing it is unbind + bind. These drive that surface through the real binary
// — including the membership gate on another owner's project (the sharing seam).
// ===========================================================================

describe("changing the remote binding", () => {
  it("refuses to bind a directory that's already bound (no silent clobber)", async () => {
    const token = await seedSession("conn-bound", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const alpha = await createSynced("Alpha", work, token, cfg);
      // A second, valid project exists — but the bind is refused before we even
      // resolve it, because this directory already points at Alpha.
      await web(ALICE, "POST", "/projects", { name: "Beta" });

      const res = await pbTry(["project", "bind", "beta"], work, token, cfg);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/already bound to a remote project/i);
      expect(res.stderr).toMatch(/unbind/i);
      expect(boundProjectId(work)).toBe(alpha); // still Alpha, untouched
    } finally {
      cleanup();
    }
  });

  it("`unbind` detaches a synced project locally but leaves the remote intact", async () => {
    const token = await seedSession("conn-unbind", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await createSynced("Solo", work, token, cfg);

      const out = await pb(["project", "unbind"], work, token, cfg);
      expect(out).toMatch(/Unbound/i);
      expect(out).toMatch(/remote was left intact/i);

      // The directory is now local-only (no stableId in config)…
      expect(readConfig(work).stableId).toBeUndefined();
      // …yet the server project is untouched: `project list` (a server read)
      // still shows it.
      const list = await pb(["project", "list"], work, token, cfg);
      expect(list).toContain("solo");
    } finally {
      cleanup();
    }
  });

  it("unbind then bind re-points the directory to a different project", async () => {
    const token = await seedSession("conn-repoint", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      const first = await createSynced("First", work, token, cfg);
      const second = await web(ALICE, "POST", "/projects", { name: "Second" });
      const secondId = second.body.stableId as string;

      await pb(["project", "unbind"], work, token, cfg);
      const out = await pb(["project", "bind", "second"], work, token, cfg);

      expect(out).toMatch(/Bound to "Second"/);
      expect(boundProjectId(work)).toBe(secondId);
      expect(boundProjectId(work)).not.toBe(first);
    } finally {
      cleanup();
    }
  });

  it("binds another owner's project by handle/id when it's shared with you", async () => {
    const aliceToken = await seedSession("conn-share-ok", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await seedHandle(BOB, "bob");
      const created = await web(BOB, "POST", "/projects", { name: "Bob Shared" });
      const bobStableId = created.body.stableId as string;

      await shareWith(bobStableId, ALICE);

      const out = await pb(
        ["project", "bind", "bob/bob-shared"],
        work,
        aliceToken,
        cfg,
      );
      expect(out).toMatch(/Bound to "Bob Shared"/);
      expect(boundProjectId(work)).toBe(bobStableId);

      // The binding caches the owner's handle + id so the remote coordinate
      // (bob/bob-shared) round-trips in `list`/`rename` output.
      const conf = readConfig(work);
      expect(conf.ownerHandle).toBe("bob");
      expect(conf.id).toBe("bob-shared");
    } finally {
      cleanup();
    }
  });

  it("refuses to bind another owner's project that isn't shared with you", async () => {
    const aliceToken = await seedSession("conn-share-no", ALICE);
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await seedHandle(BOB, "bob");
      await web(BOB, "POST", "/projects", { name: "Bob Private" });
      // No shareWith — ALICE is not a member, so the lookup 404s (no leak).

      const res = await pbTry(
        ["project", "bind", "bob/bob-private"],
        work,
        aliceToken,
        cfg,
      );
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/no project 'bob\/bob-private' found|isn't shared with you/i);
      expect(existsSync(join(work, "paperbaker", "config.json"))).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ===========================================================================
// F. bind reconciles content drift between a local-only project and the remote.
//
// When the bound directory's papers differ from the remote's, bind needs a mode:
// --merge (union, push local-only up) or --replace-local (remote wins). Without
// one, a non-interactive shell refuses rather than guessing. Set-up: a local-only
// project (created + `add`ed offline) carrying the fixture paper, bound onto a
// freshly-created empty remote.
// ===========================================================================

describe("bind reconciles content drift", () => {
  async function localProjectWithPaper(
    name: string,
    work: string,
    cfg: string,
  ): Promise<void> {
    await pbNoAuth(["project", "create", name], work, cfg);
    await pbNoAuth(["add", ARXIV_ID], work, cfg);
    expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
    expect(readConfig(work).stableId).toBeUndefined(); // still offline
  }

  it("`--merge` unions the local-only paper up onto the remote", async () => {
    const token = await seedSession("conn-merge", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await localProjectWithPaper("Local Lib", work, cfg);
      const remote = await web(ALICE, "POST", "/projects", { name: "Remote Empty" });
      const remoteId = remote.body.stableId as string;

      const out = await pb(
        ["project", "bind", "remote-empty", "--merge"],
        work,
        token,
        cfg,
      );
      expect(out).toMatch(/Bound to "Remote Empty"/);
      expect(out).toMatch(/Pushed 1 local paper/i);

      // Union: the paper stays local AND is now filed on the remote.
      expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
      expect((await membershipDoc(remoteId)).exists).toBe(true);
      expect(boundProjectId(work)).toBe(remoteId);
    } finally {
      cleanup();
    }
  });

  it("`--replace-local` adopts the remote and drops the local-only paper", async () => {
    const token = await seedSession("conn-replace", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await localProjectWithPaper("Throwaway", work, cfg);
      const remote = await web(ALICE, "POST", "/projects", { name: "Authoritative" });
      const remoteId = remote.body.stableId as string;

      const out = await pb(
        ["project", "bind", "authoritative", "--replace-local"],
        work,
        token,
        cfg,
      );
      expect(out).toMatch(/Bound to "Authoritative"/);

      // replace-local: the remote (empty) wins, the local-only paper is dropped,
      // and nothing is pushed up.
      expect(localPapers(work)).toHaveLength(0);
      expect((await membershipDoc(remoteId)).exists).toBe(false);
      expect(boundProjectId(work)).toBe(remoteId);
    } finally {
      cleanup();
    }
  });

  it("refuses on drift without a mode flag in a non-interactive shell", async () => {
    const token = await seedSession("conn-drift", ALICE);
    await seedPaperCache();
    const { work, cfg, cleanup } = makeWorkspace();
    try {
      await localProjectWithPaper("Has Paper", work, cfg);
      await web(ALICE, "POST", "/projects", { name: "Diverged" });

      const res = await pbTry(["project", "bind", "diverged"], work, token, cfg);
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/differs from the remote project|Re-run with --merge/i);

      // The bind aborted before persisting — the directory is still local-only,
      // and the local paper is intact.
      expect(readConfig(work).stableId).toBeUndefined();
      expect(localPapers(work).map((p) => p.paperId)).toContain(PAPER_ID);
    } finally {
      cleanup();
    }
  });
});
