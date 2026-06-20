import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { requireAuth } from "./middleware/auth.js";
import { handleDeviceRequest } from "./routes/device.js";

// Whole-stack login e2e, exercised exactly as production runs it — every layer is
// REAL and nothing is mocked:
//
//   real `pb login` binary  →  HTTP  →  real device API (handleDeviceRequest)
//        ↳ POST /device/code, polls POST /device/token
//   real web approval        →  HTTP  →  real /device/approve behind real requireAuth
//        ↳ a real Firebase ID token from the Auth emulator (any-provider stand-in)
//   real requireAuth gate    ←  the minted pbk token must authenticate as the user
//
// This is the seam the layer-isolated tests can't cover: device.integration mocks
// requireAuth, and the CLI's auth.test.ts mocks fetch. Here the binary drives the
// live backend, so a regression like the verificationUri pointing at the wrong
// host, or a minted token the gate won't accept, fails here.

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";
const FAKE_API_KEY = "fake-api-key"; // the auth emulator accepts any non-empty key

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const cliEntry = join(repoRoot, "apps", "cli", "dist", "index.js");

let server: Server;
let apiBase: string; // e.g. http://127.0.0.1:PORT/api

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });

  // The approval URL the CLI prints is the WEB host, set per-deploy via this env
  // (the emulator sets it too). Pin it so we can assert the CLI prints OUR host
  // and never falls back to the prod default — the bug that motivated this test.
  process.env.PAPERBAKER_WEB_URL = "http://localhost:5173";

  // Build the real CLI bundle so we drive the published artifact, as an agent would.
  execFileSync("pnpm", ["--filter", "@paper-baker/cli", "build"], {
    cwd: repoRoot,
    stdio: "ignore",
    timeout: 180_000,
  });

  // A bare HTTP server adapting requests to the real device handler. The
  // /api/device prefix matches the hosting rewrite, so routePath strips it
  // exactly as in production.
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

        if (url.pathname.startsWith("/api/device")) {
          await handleDeviceRequest(req, res);
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

const execFileAsync = promisify(execFile);

function reqWith(token: string): Request {
  return { headers: { authorization: `Bearer ${token}` } } as unknown as Request;
}

/** A real Firebase ID token for `uid` via the Auth emulator (the web's credential). */
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

/**
 * Stand in for the human at the browser: wait for the CLI to start a login (a
 * pending deviceCode appears), then approve that user code as a signed-in ALICE
 * through the REAL /device/approve endpoint (real Firebase ID token).
 */
async function approveAsAlice(): Promise<void> {
  const db = getFirestore();
  let userCode: string | undefined;
  for (let i = 0; i < 200 && !userCode; i++) {
    const q = await db
      .collection("deviceCodes")
      .where("status", "==", "pending")
      .limit(1)
      .get();
    if (!q.empty) userCode = q.docs[0].data().userCode as string;
    else await sleep(50);
  }
  if (!userCode) throw new Error("CLI never requested a device code");

  const idToken = await firebaseIdToken(ALICE);
  const res = await fetch(`${apiBase}/device/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ userCode }),
  });
  if (!res.ok) {
    throw new Error(`approve failed (${res.status}): ${await res.text()}`);
  }
}

/**
 * Run the real `pb login` to completion: spawn it, approve as the browser user,
 * and resolve with its captured stdout/stderr. A clean child env (no process.env
 * spread) keeps vitest's NODE_OPTIONS loader out of the child; `extraEnv` adds
 * per-case vars (e.g. PAPERBAKER_TOKEN). The temp dirs are caller-owned.
 */
async function runLogin(
  cfg: string,
  work: string,
  extraEnv: Record<string, string> = {},
): Promise<{ stdout: string; stderr: string }> {
  const child = execFileAsync("node", [cliEntry, "login", "--no-open"], {
    cwd: work,
    encoding: "utf8",
    timeout: 45_000,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      PAPERBAKER_API_URL: apiBase,
      PAPERBAKER_CONFIG_DIR: cfg,
      PAPERBAKER_QUIET: "1",
      ...extraEnv,
    },
  });
  await approveAsAlice();
  const { stdout, stderr } = await child;
  return { stdout, stderr };
}

describe("pb login (real binary, real device API, emulator)", () => {
  it(
    "completes the device-link flow: approve → token stored → token authenticates",
    { timeout: 60_000 },
    async () => {
      const cfg = mkdtempSync(join(tmpdir(), "pb-login-cfg-"));
      const work = mkdtempSync(join(tmpdir(), "pb-login-"));
      try {
        const { stdout, stderr } = await runLogin(cfg, work);
        expect(stdout).toMatch(/Signed in \(uid: alice-uid\)/);
        // The approval URL the CLI printed must honor PAPERBAKER_WEB_URL (our
        // host), never the prod default — a regression guard for the stale
        // import-time default that once leaked the prod URL on the emulator.
        expect(stdout).toContain("http://localhost:5173/device");
        expect(stdout).not.toContain("paper-baker.web.app");
        // Fresh login (empty config, no env token): neither advisory fires.
        expect(stdout).not.toContain("Already signed in");
        expect(stderr).not.toContain("PAPERBAKER_TOKEN");

        // The opaque token + uid were persisted to the global config (0600 file).
        const stored = JSON.parse(
          readFileSync(join(cfg, "config.json"), "utf8"),
        ) as { accessToken?: string; uid?: string };
        expect(stored.uid).toBe(ALICE);
        expect(stored.accessToken).toMatch(/^pbk\.[^.]+\.[^.]+$/);

        // The minted token is accepted by the REAL auth gate as ALICE — the whole
        // point: login produces a credential the backend actually honors.
        expect(await requireAuth(reqWith(stored.accessToken as string))).toBe(ALICE);

        // Consuming the code registered an active connection and logged a
        // `connected` activity event (the audit log behind the web "CLI" tab).
        const db = getFirestore();
        const clis = await db.collection("users").doc(ALICE).collection("clis").get();
        expect(clis.size).toBe(1);
        expect(clis.docs[0].data().status).toBe("active");

        const events = await db
          .collection("users").doc(ALICE).collection("cliEvents").get();
        expect(events.docs.map((d) => d.data().type)).toContain("connected");
      } finally {
        rmSync(cfg, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
      }
    },
  );

  it(
    "notes re-authentication when a credential is already stored",
    { timeout: 60_000 },
    async () => {
      const cfg = mkdtempSync(join(tmpdir(), "pb-login-cfg-"));
      const work = mkdtempSync(join(tmpdir(), "pb-login-"));
      try {
        // Pre-seed a stored session, as a prior login would leave behind.
        writeFileSync(
          join(cfg, "config.json"),
          JSON.stringify({ accessToken: "pbk.old.secret", uid: "prior-uid" }),
        );
        const { stdout } = await runLogin(cfg, work);
        expect(stdout).toContain("Already signed in as prior-uid; re-authenticating.");
        expect(stdout).toMatch(/Signed in \(uid: alice-uid\)/);
        // The stored token was actually replaced with the new one.
        const stored = JSON.parse(
          readFileSync(join(cfg, "config.json"), "utf8"),
        ) as { accessToken?: string; uid?: string };
        expect(stored.uid).toBe(ALICE);
        expect(stored.accessToken).not.toBe("pbk.old.secret");
      } finally {
        rmSync(cfg, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
      }
    },
  );

  it(
    "warns that PAPERBAKER_TOKEN overrides the login when it's set in the env",
    { timeout: 60_000 },
    async () => {
      const cfg = mkdtempSync(join(tmpdir(), "pb-login-cfg-"));
      const work = mkdtempSync(join(tmpdir(), "pb-login-"));
      try {
        // An env token shadows whatever login stores (resolveAuthToken is env-first).
        const { stdout, stderr } = await runLogin(cfg, work, {
          PAPERBAKER_TOKEN: "pbk.envconn.envsecret",
        });
        expect(stdout).toMatch(/Signed in \(uid: alice-uid\)/);
        expect(stderr).toContain("PAPERBAKER_TOKEN is set in your environment");
        expect(stderr).toContain("overrides this login");
      } finally {
        rmSync(cfg, { recursive: true, force: true });
        rmSync(work, { recursive: true, force: true });
      }
    },
  );
});
