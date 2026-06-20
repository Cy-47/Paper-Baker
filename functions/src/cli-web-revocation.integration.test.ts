import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { requireAuth } from "./middleware/auth.js";
import { mintAccessToken } from "./lib/cliSessions.js";
import { handleDeviceRequest } from "./routes/device.js";

// Cross-surface (CLI ↔ web) test of the per-CLI revocation seam. Both halves are
// REAL: the CLI half is the real `requireAuth` gate driven with a real minted
// pbk token; the web half is the real device API (DELETE /connections/:id) driven
// with a real Firebase ID token — the same call the web "CLI" tab makes now that
// all writes go through the backend. So clicking Delete in the web tab makes the
// live CLI's very next call fail.

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";
const BOB = "bob-uid";
const FAKE_API_KEY = "fake-api-key"; // the emulator accepts any non-empty key

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

/** Drive the real device handler as the web app would (Firebase ID token). */
async function deviceCall(
  method: string,
  path: string,
  idToken: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const req = {
    method,
    path,
    body: {},
    headers: { authorization: `Bearer ${idToken}` },
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

const webDelete = (actor: string, id: string) =>
  firebaseIdToken(actor).then((t) => deviceCall("DELETE", `/connections/${id}`, t));

/** Seed a CLI session (as device-link consume does) and return its token. */
async function seedSession(
  connectionId: string,
  { status = "active", uid = ALICE }: { status?: string; uid?: string } = {},
): Promise<string> {
  const { token, tokenHash } = mintAccessToken(connectionId);
  const db = getFirestore();
  await db.collection("cliSessions").doc(connectionId).set({ connectionId, uid, tokenHash, createdAt: "" });
  await db
    .collection("users").doc(uid).collection("clis").doc(connectionId)
    .set({ connectionId, uid, status, device: {}, createdAt: "", lastSeenAt: "" });
  return token;
}

describe("CLI ↔ web revocation seam", () => {
  it("a live CLI token works until the web tab deletes it, then fails", async () => {
    const token = await seedSession("conn-A");
    expect(await requireAuth(reqWith(token))).toBe(ALICE);

    const res = await webDelete(ALICE, "conn-A");
    expect(res.status).toBe(200);

    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
  });

  it("the web Delete kills the live CLI token and drops the backend session", async () => {
    const token = await seedSession("conn-A");
    expect(await requireAuth(reqWith(token))).toBe(ALICE);

    const res = await webDelete(ALICE, "conn-A");
    expect(res.status).toBe(200);

    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
    expect((await getFirestore().collection("cliSessions").doc("conn-A").get()).exists).toBe(false);
  });

  it("another user cannot delete your CLI (404; token stays valid)", async () => {
    const token = await seedSession("conn-A", { uid: ALICE });
    expect((await webDelete(BOB, "conn-A")).status).toBe(404);
    expect(await requireAuth(reqWith(token))).toBe(ALICE);
  });

  it("deletion is terminal — the connection is gone, the token stays locked out", async () => {
    const token = await seedSession("conn-A");
    expect((await webDelete(ALICE, "conn-A")).status).toBe(200);
    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
    // The connection no longer exists; deleting again is a 404 and the token stays out.
    expect((await webDelete(ALICE, "conn-A")).status).toBe(404);
    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
  });
});
