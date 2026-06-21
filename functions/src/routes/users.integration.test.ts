import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { Request } from "firebase-functions/v2/https";
import type { Response } from "express";

// Integration tests for the identity API (profiles + handle registry), driven
// against the Firestore emulator. Token verification is mocked via x-test-uid.
vi.mock("../middleware/auth.js", () => ({
  requireAuth: vi.fn(async (req: Request) => {
    const uid = req.headers["x-test-uid"] as string | undefined;
    if (!uid) throw { status: 401, message: "Unauthorized" };
    return uid;
  }),
}));

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { handleUsersRequest } from "./users.js";

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

  await handleUsersRequest(req, res);
  return { status, body: json };
}

interface Profile {
  uid: string;
  handle: string | null;
  displayName: string | null;
}

describe("GET /me", () => {
  it("returns a null-handle profile when none exists yet (onboarding signal)", async () => {
    const res = await call("GET", "/me", ALICE);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ uid: ALICE, handle: null, displayName: null });
  });

  it("rejects unauthenticated callers", async () => {
    expect((await call("GET", "/me", null)).status).toBe(401);
  });
});

describe("PUT /me — claim/update handle + display name", () => {
  it("claims a handle, writes the profile and the registry entry", async () => {
    const res = await call("PUT", "/me", ALICE, { handle: "Alice", displayName: "Alice Chen" });
    expect(res.status).toBe(200);
    const p = res.body as Profile;
    expect(p.handle).toBe("alice"); // normalized
    expect(p.displayName).toBe("Alice Chen");

    const reg = await getFirestore().collection("handles").doc("alice").get();
    expect(reg.data()).toEqual({ uid: ALICE });

    expect((await call("GET", "/me", ALICE)).body).toMatchObject({ handle: "alice" });
  });

  it("rejects an invalid handle and a reserved one", async () => {
    expect((await call("PUT", "/me", ALICE, { handle: "a b" })).status).toBe(400);
    expect((await call("PUT", "/me", ALICE, { handle: "ab" })).status).toBe(400);
    expect((await call("PUT", "/me", ALICE, { handle: "settings" })).status).toBe(409);
  });

  it("rejects a handle already taken by another user", async () => {
    await call("PUT", "/me", ALICE, { handle: "shared", displayName: "A" });
    const res = await call("PUT", "/me", BOB, { handle: "shared", displayName: "B" });
    expect(res.status).toBe(409);
  });

  it("frees the old handle when a user renames theirs", async () => {
    await call("PUT", "/me", ALICE, { handle: "alice", displayName: "A" });
    await call("PUT", "/me", ALICE, { handle: "alice2" });
    // Old registry entry gone, new one points at ALICE.
    expect((await getFirestore().collection("handles").doc("alice").get()).exists).toBe(false);
    expect((await getFirestore().collection("handles").doc("alice2").get()).data()).toEqual({ uid: ALICE });
    // BOB may now take the freed handle.
    expect((await call("PUT", "/me", BOB, { handle: "alice" })).status).toBe(200);
  });

  it("fans the new handle out to the owner's projects' denormalized ownerHandle", async () => {
    await getFirestore().collection("projects").doc("ab23kd9p").set({
      stableId: "ab23kd9p",
      id: "proj",
      name: "Proj",
      ownerUid: ALICE,
      ownerHandle: "",
      memberUids: [ALICE],
      visibility: "private",
    });
    await call("PUT", "/me", ALICE, { handle: "alice" });
    const proj = await getFirestore().collection("projects").doc("ab23kd9p").get();
    expect(proj.data()?.ownerHandle).toBe("alice");
  });
});

describe("GET /users/:handle — public profile lookup", () => {
  it("resolves a claimed handle to its profile", async () => {
    await call("PUT", "/me", ALICE, { handle: "alice", displayName: "Alice Chen" });
    const res = await call("GET", "/users/alice", BOB);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ uid: ALICE, handle: "alice", displayName: "Alice Chen" });
  });

  it("404s for an unclaimed handle", async () => {
    expect((await call("GET", "/users/ghost", ALICE)).status).toBe(404);
  });
});
