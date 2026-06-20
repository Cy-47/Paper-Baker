import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

// Integration tests for the device-link auth API, driven directly against the
// emulators. Only token verification is mocked (an `x-test-uid` header → uid);
// every Firestore read/write AND the real `createCustomToken` (against the Auth
// emulator) run for real — so this exercises the full Firebase bridge.
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(async (req: Request) => {
    const uid = req.headers["x-test-uid"] as string | undefined;
    if (!uid) throw { status: 401, message: "Unauthorized" };
    return uid;
  }),
}));

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { handleDeviceRequest } from "./device.js";

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
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

  await handleDeviceRequest(req, res);
  return { status, body: (json ?? {}) as Record<string, unknown> };
}

describe("POST /device/code — start a login", () => {
  it("returns a device code, a formatted user code, and poll params", async () => {
    const res = await call("POST", "/code", null);
    expect(res.status).toBe(201);
    expect(typeof res.body.deviceCode).toBe("string");
    expect((res.body.deviceCode as string).length).toBeGreaterThan(20);
    // user code is human-formatted with a separator
    expect(res.body.userCode).toMatch(/^[0-9A-Z]+-[0-9A-Z]+$/);
    expect(res.body.verificationUri).toMatch(/\/device$/);
    expect(typeof res.body.interval).toBe("number");
    expect(typeof res.body.expiresIn).toBe("number");

    // It persisted a pending record keyed by the device code.
    const doc = await getFirestore()
      .collection("deviceCodes")
      .doc(res.body.deviceCode as string)
      .get();
    expect(doc.exists).toBe(true);
    expect(doc.data()?.status).toBe("pending");
    expect(doc.data()?.uid).toBeNull();
  });

  it("the verification URL honors PAPERBAKER_WEB_URL (read at request time)", async () => {
    const prev = process.env.PAPERBAKER_WEB_URL;
    process.env.PAPERBAKER_WEB_URL = "http://localhost:5173";
    try {
      const res = await call("POST", "/code", null);
      expect(res.body.verificationUri).toBe("http://localhost:5173/device");
    } finally {
      if (prev === undefined) delete process.env.PAPERBAKER_WEB_URL;
      else process.env.PAPERBAKER_WEB_URL = prev;
    }
  });
});

describe("full device-link flow → opaque access token", () => {
  it("code → poll(pending) → approve(any provider) → poll(access token) → consumed", async () => {
    // 1. CLI requests a code.
    const start = await call("POST", "/code", null);
    const deviceCode = start.body.deviceCode as string;
    const userCode = start.body.userCode as string;

    // 2. CLI polls — still pending.
    const pending = await call("POST", "/token", null, { deviceCode });
    expect(pending.status).toBe(200);
    expect(pending.body.status).toBe("pending");

    // 3. User approves in the browser as ALICE (uid comes from the verified
    //    session; the dashed display code is normalized server-side).
    const approve = await call("POST", "/approve", ALICE, { userCode });
    expect(approve.status).toBe(200);
    expect(approve.body.approved).toBe(true);

    // 4. CLI polls again — gets an opaque access token for ALICE.
    const done = await call("POST", "/token", null, { deviceCode });
    expect(done.status).toBe(200);
    expect(done.body.status).toBe("approved");
    expect(done.body.uid).toBe(ALICE);
    const accessToken = done.body.accessToken as string;
    expect(accessToken).toMatch(/^pbk\.[^.]+\.[^.]+$/);
    expect(done.body.customToken).toBeUndefined();

    // 5. The code is single-use — a second poll is rejected.
    const reuse = await call("POST", "/token", null, { deviceCode });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe("already_used");

    // 6. Consuming the code registered a connected CLI for ALICE (user-facing,
    //    active) ...
    const clis = await getFirestore()
      .collection("users")
      .doc(ALICE)
      .collection("clis")
      .get();
    expect(clis.size).toBe(1);
    const conn = clis.docs[0];
    expect(conn.data().status).toBe("active");
    expect(conn.data().uid).toBe(ALICE);

    // ... and a backend-only session holding ONLY the token's hash (never the
    //     token itself), keyed by the same connectionId.
    const session = await getFirestore().collection("cliSessions").doc(conn.id).get();
    expect(session.exists).toBe(true);
    expect(session.data()?.uid).toBe(ALICE);
    expect(typeof session.data()?.tokenHash).toBe("string");
    expect(session.data()?.tokenHash).not.toContain(accessToken.split(".")[2]);
    // The hash is the SHA-256 of the full token we handed back.
    const { hashToken } = await import("../lib/cliSessions.js");
    expect(session.data()?.tokenHash).toBe(hashToken(accessToken));
  });

  it("captures self-reported device metadata for the connection label", async () => {
    const start = await call("POST", "/code", null, {
      device: { hostname: "alices-laptop", platform: "darwin" },
    });
    const deviceCode = start.body.deviceCode as string;
    const userCode = start.body.userCode as string;

    await call("POST", "/approve", ALICE, { userCode });
    await call("POST", "/token", null, { deviceCode });

    const clis = await getFirestore()
      .collection("users")
      .doc(ALICE)
      .collection("clis")
      .get();
    expect(clis.docs[0].data().device).toEqual({
      hostname: "alices-laptop",
      platform: "darwin",
    });
  });
});

describe("device API guardrails", () => {
  it("approve requires authentication", async () => {
    const start = await call("POST", "/code", null);
    const res = await call("POST", "/approve", null, {
      userCode: start.body.userCode,
    });
    expect(res.status).toBe(401);
  });

  it("approve rejects an unknown user code", async () => {
    const res = await call("POST", "/approve", ALICE, { userCode: "ZZZZ-ZZZZ" });
    expect(res.status).toBe(404);
  });

  it("poll rejects an unknown device code", async () => {
    const res = await call("POST", "/token", null, { deviceCode: "nope" });
    expect(res.status).toBe(404);
  });

  it("poll rejects an expired code (and cleans it up)", async () => {
    // Seed an already-expired pending record directly.
    const deviceCode = "expired-device-code";
    await getFirestore().collection("deviceCodes").doc(deviceCode).set({
      userCode: "EXPIRED1",
      status: "pending",
      uid: null,
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const res = await call("POST", "/token", null, { deviceCode });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("expired");

    const doc = await getFirestore()
      .collection("deviceCodes")
      .doc(deviceCode)
      .get();
    expect(doc.exists).toBe(false);
  });

  it("unknown routes 404", async () => {
    const res = await call("GET", "/code", null);
    expect(res.status).toBe(404);
  });

  it("routes identically behind the /api/device hosting rewrite", async () => {
    const res = await call("POST", "/api/device/code", null);
    expect(res.status).toBe(201);
    expect(typeof res.body.deviceCode).toBe("string");
  });
});

describe("connection management (web CLI tab)", () => {
  async function seedConnection(): Promise<void> {
    const db = getFirestore();
    await db.collection("cliSessions").doc("conn-1").set({
      connectionId: "conn-1",
      uid: ALICE,
      tokenHash: "hash",
      createdAt: "x",
    });
    await db.collection("users").doc(ALICE).collection("clis").doc("conn-1").set({
      connectionId: "conn-1",
      uid: ALICE,
      status: "active",
      device: {},
      createdAt: "x",
      lastSeenAt: "x",
    });
  }

  it("delete removes both the connection and its backend session", async () => {
    await seedConnection();
    const res = await call("DELETE", "/connections/conn-1", ALICE);
    expect(res.status).toBe(200);

    const db = getFirestore();
    expect((await db.collection("users").doc(ALICE).collection("clis").doc("conn-1").get()).exists).toBe(false);
    expect((await db.collection("cliSessions").doc("conn-1").get()).exists).toBe(false);
  });

  it("delete appends a 'deleted' entry to the activity log", async () => {
    await seedConnection();
    await call("DELETE", "/connections/conn-1", ALICE);

    const events = await getFirestore()
      .collection("users").doc(ALICE).collection("cliEvents").get();
    const deleted = events.docs.map((d) => d.data()).filter((e) => e.type === "deleted");
    expect(deleted).toHaveLength(1);
    expect(deleted[0]).toMatchObject({ type: "deleted", connectionId: "conn-1" });
  });

  it("delete requires authentication", async () => {
    await seedConnection();
    const res = await call("DELETE", "/connections/conn-1", null);
    expect(res.status).toBe(401);
  });

  it("404s deleting a connection that doesn't exist", async () => {
    const res = await call("DELETE", "/connections/nope", ALICE);
    expect(res.status).toBe(404);
  });
});
