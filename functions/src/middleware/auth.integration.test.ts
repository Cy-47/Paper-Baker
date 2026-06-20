import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { requireAuth } from "./auth.js";
import { mintAccessToken } from "../lib/cliSessions.js";

// Exercises the REAL requireAuth gate (NOT mocked) against the Auth + Firestore
// emulators, proving both credential paths:
//   - opaque CLI access tokens (pbk.…) resolve via the backend-only cliSessions
//     doc and are gated on the user-facing connection's revocation status;
//   - Firebase ID tokens (web / legacy) still verify and resolve to a uid.

const PROJECT_ID = "paper-baker";
const ALICE = "alice-uid";
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

/** Mint a CLI session exactly as device-link consume would, and return its token. */
async function seedSession(
  connectionId: string,
  { status = "active", uid = ALICE }: { status?: string; uid?: string } = {},
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
    .set({ connectionId, uid, status, device: {}, createdAt: "", lastSeenAt: "" });
  return token;
}

/** A real Firebase ID token for ALICE via the Auth emulator (web/legacy path). */
async function firebaseIdToken(): Promise<string> {
  const custom = await getAuth().createCustomToken(ALICE);
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

describe("requireAuth — opaque CLI access tokens", () => {
  it("accepts a token whose session is active", async () => {
    const token = await seedSession("conn-A");
    expect(await requireAuth(reqWith(token))).toBe(ALICE);
  });

  it("rejects a token whose connection was revoked", async () => {
    const token = await seedSession("conn-A", { status: "revoked" });
    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token whose connection doc was deleted (remove == revoke)", async () => {
    const token = await seedSession("conn-A");
    await getFirestore().collection("users").doc(ALICE).collection("clis").doc("conn-A").delete();
    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token whose session is unknown (forged connectionId)", async () => {
    const { token } = mintAccessToken("never-registered");
    await expect(requireAuth(reqWith(token))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a tampered token (secret changed → hash mismatch)", async () => {
    const token = await seedSession("conn-A");
    const [p, cid, secret] = token.split(".");
    const tampered = `${p}.${cid}.${secret.slice(0, -1)}${secret.slice(-1) === "A" ? "B" : "A"}`;
    await expect(requireAuth(reqWith(tampered))).rejects.toMatchObject({ status: 401 });
  });

  it("rejects a token pointed at another connection's id (hash binds the whole token)", async () => {
    // Real session A, but swap in B's connectionId — the stored hash for B won't
    // match this token, and A's hash isn't looked up. Either way: denied.
    await seedSession("conn-A");
    const tokenB = await seedSession("conn-B");
    const tokenA = await seedSession("conn-A"); // re-mint A (fresh secret)
    const spliced = `pbk.conn-B.${tokenA.split(".")[2]}`;
    expect(spliced).not.toBe(tokenB);
    await expect(requireAuth(reqWith(spliced))).rejects.toMatchObject({ status: 401 });
  });
});

describe("requireAuth — Firebase ID tokens (web / legacy)", () => {
  it("resolves a valid Firebase ID token to its uid, no session required", async () => {
    expect(await requireAuth(reqWith(await firebaseIdToken()))).toBe(ALICE);
  });

  it("rejects a malformed bearer token", async () => {
    await expect(requireAuth(reqWith("not-a-real-token"))).rejects.toMatchObject({
      status: 401,
    });
  });
});
