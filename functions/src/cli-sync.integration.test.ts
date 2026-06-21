import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { handleProjectsRequest } from "./routes/projects.js";
import { handlePapersRequest } from "./routes/papers.js";
import { mintAccessToken } from "./lib/cliSessions.js";

// End-to-end sync test across the CLI ↔ backend seam, exercised the way it runs
// in production: the REAL built `pb` binary makes REAL HTTP calls (over a local
// server that mounts the REAL projects handler) to the REAL `requireAuth` gate,
// backed by the Firestore emulator — authenticated with a REAL opaque pbk token.
// Nothing here is mocked except that we stand the handler behind a bare http
// server instead of Cloud Functions hosting (the URL routing is identical).
//
// NOTE: `pb sync` resolves each paper into the global papers/ cache
// (api-client.resolvePaper) before filing it. We pre-seed papers/ here so that
// resolve is a cache hit and the test stays hermetic (no live arxiv fetch).

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cliEntry = join(repoRoot, "apps", "cli", "dist", "index.js");

const PAPER = {
  paperId: "arxiv:1706.03762",
  source: { type: "arxiv", id: "1706.03762" },
  title: "Attention Is All You Need",
  abstract: "We propose the Transformer, based solely on attention mechanisms.",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  publishedAt: "2017-06-12T00:00:00Z",
  categories: ["cs.CL"],
  links: {
    abs: "https://arxiv.org/abs/1706.03762",
    pdf: "https://arxiv.org/pdf/1706.03762",
  },
  sourceStatus: "available",
};

let server: Server;
let apiBase: string; // e.g. http://127.0.0.1:PORT/api

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });

  // Build the real CLI bundle so we drive the published artifact, as an agent would.
  execFileSync("pnpm", ["--filter", "@paper-baker/cli", "build"], {
    cwd: repoRoot,
    stdio: "ignore",
    timeout: 180_000,
  });

  // A bare HTTP server that adapts requests to the real projects handler. The
  // path prefix (/api/projects) matches the hosting rewrite, so routePath inside
  // the handler strips it exactly as in production.
  server = createServer((httpReq, httpRes) => {
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

        if (url.pathname.startsWith("/api/projects")) {
          await handleProjectsRequest(req, res);
        } else if (url.pathname.startsWith("/api/papers")) {
          await handlePapersRequest(req, res);
        } else {
          httpRes.writeHead(404);
          httpRes.end();
        }
      })().catch((e) => {
        httpRes.writeHead(500);
        httpRes.end(String(e));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
}, 200_000);

afterAll(() => {
  server?.close();
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

/** Seed an active CLI session (as device-link consume would) and return its token. */
async function seedSession(): Promise<string> {
  const { token, tokenHash } = mintAccessToken("conn-sync");
  const db = getFirestore();
  await db
    .collection("cliSessions")
    .doc("conn-sync")
    .set({ connectionId: "conn-sync", uid: ALICE, tokenHash, createdAt: "" });
  await db
    .collection("users")
    .doc(ALICE)
    .collection("clis")
    .doc("conn-sync")
    .set({ connectionId: "conn-sync", uid: ALICE, status: "active", device: {}, createdAt: "", lastSeenAt: "" });
  return token;
}

/** Seed the global papers/ cache (models a prior resolve). */
async function seedPaper(): Promise<void> {
  await getFirestore().collection("papers").doc(PAPER.paperId).set(PAPER);
}

const execFileAsync = promisify(execFile);

/**
 * Run the real pb binary in `cwd`, pointed at the test server + token. ASYNC on
 * purpose: a synchronous spawn (execFileSync) deadlocks here because this test
 * process holds an active firebase-admin gRPC client (from getFirestore()), and
 * blocking the event loop starves the spawn's child-exit handling. A clean env
 * (no process.env spread) keeps vitest's NODE_OPTIONS loader out of the child.
 */
async function pb(args: string[], cwd: string, token: string, configDir: string): Promise<string> {
  const { stdout } = await execFileAsync("node", [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PAPERBAKER_API_URL: apiBase,
      PAPERBAKER_TOKEN: token,
      PAPERBAKER_CONFIG_DIR: configDir,
      PAPERBAKER_QUIET: "1",
    },
  });
  return stdout;
}

/** Run pb with NO credential (offline): no token env, and a config dir with no
 * stored session. Models a user who created a project before logging in. */
async function pbNoAuth(args: string[], cwd: string, configDir: string): Promise<string> {
  const { stdout } = await execFileAsync("node", [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PAPERBAKER_API_URL: apiBase,
      PAPERBAKER_CONFIG_DIR: configDir,
      PAPERBAKER_QUIET: "1",
    },
  });
  return stdout;
}

describe("pb ↔ backend sync (real binary, real handler, emulator)", () => {
  it("`project create` publishes immediately when logged in; sync reconciles papers", { timeout: 60_000 }, async () => {
    const token = await seedSession();
    await seedPaper();

    const work = mkdtempSync(join(tmpdir(), "pb-sync-"));
    const cfg = mkdtempSync(join(tmpdir(), "pb-cfg-"));
    try {
      // Logged in, so `create` reaches the server now: the server mints the
      // stableId + id and creates the project — synced from birth.
      const created = await pb(["project", "create", "Sync Test"], work, token, cfg);
      expect(created).toMatch(/Created "Sync Test"/);
      expect(created).toMatch(/id: sync-test/);

      // The CLI persisted the server binding (stableId + id) into config.json.
      const localCfg = JSON.parse(
        readFileSync(join(work, "paperbaker", "config.json"), "utf8"),
      ) as { name: string; stableId?: string; id?: string };
      expect(localCfg.id).toBe("sync-test");
      expect(localCfg.stableId).toMatch(/^[2-9a-z]{8}$/);

      // The server holds the (top-level) project already, before any sync.
      const db = getFirestore();
      const projects = await db.collection("projects").where("ownerUid", "==", ALICE).get();
      expect(projects.size).toBe(1);
      const projectId = projects.docs[0].id;
      expect(projectId).toBe(localCfg.stableId);
      expect(projects.docs[0].data().id).toBe("sync-test");

      // Seed the paper list directly (no arxiv round-trip), then sync pushes it.
      writeFileSync(
        join(work, "paperbaker", "papers.json"),
        JSON.stringify([PAPER], null, 2),
      );
      const out = await pb(["sync"], work, token, cfg);
      expect(out).toMatch(/pushed 1, 1 paper\(s\) total/);

      // The membership AND the saved record (projectPaper ⊆ savedPapers) landed.
      const membership = await db
        .collection("projects").doc(projectId)
        .collection("projectPapers").doc(PAPER.paperId)
        .get();
      expect(membership.exists).toBe(true);

      const saved = await db
        .collection("users").doc(ALICE)
        .collection("savedPapers").doc(PAPER.paperId)
        .get();
      expect(saved.exists).toBe(true);

      // Read it back through the binary: project list reflects the new project.
      const list = await pb(["project", "list"], work, token, cfg);
      expect(list).toContain("sync-test");

      // A second sync is idempotent: nothing new to push, and refs.bib is
      // regenerated from the reconciled manifest.
      const sync = await pb(["sync"], work, token, cfg);
      expect(sync).toMatch(/pushed 0, 1 paper\(s\) total/);
      const bib = readFileSync(join(work, "paperbaker", "refs.bib"), "utf8");
      expect(bib).toContain("Attention Is All You Need");
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(cfg, { recursive: true, force: true });
    }
  });

  it("an offline `create` (no credential) is published by the first `pb sync`", { timeout: 60_000 }, async () => {
    const token = await seedSession();
    await seedPaper();

    const work = mkdtempSync(join(tmpdir(), "pb-sync-off-"));
    const cfg = mkdtempSync(join(tmpdir(), "pb-cfg-off-"));
    try {
      // Created before logging in: stays local-only, no stable id, no server doc.
      await pbNoAuth(["project", "create", "Sync Test"], work, cfg);
      const before = JSON.parse(
        readFileSync(join(work, "paperbaker", "config.json"), "utf8"),
      ) as { stableId?: string };
      expect(before.stableId).toBeUndefined();

      writeFileSync(
        join(work, "paperbaker", "papers.json"),
        JSON.stringify([PAPER], null, 2),
      );

      // First sync after logging in publishes: mints the id, creates the
      // project, and files the local paper.
      const out = await pb(["sync"], work, token, cfg);
      expect(out).toMatch(/Published as "Sync Test"/);
      expect(out).toMatch(/pushed 1 paper/);

      const after = JSON.parse(
        readFileSync(join(work, "paperbaker", "config.json"), "utf8"),
      ) as { stableId?: string; id?: string };
      expect(after.id).toBe("sync-test");
      expect(after.stableId).toMatch(/^[2-9a-z]{8}$/);

      const membership = await getFirestore()
        .collection("projects").doc(after.stableId!)
        .collection("projectPapers").doc(PAPER.paperId)
        .get();
      expect(membership.exists).toBe(true);
    } finally {
      rmSync(work, { recursive: true, force: true });
      rmSync(cfg, { recursive: true, force: true });
    }
  });
});
