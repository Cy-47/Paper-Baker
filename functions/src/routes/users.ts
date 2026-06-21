import { onRequest, type Request } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import type { Response } from "express";
import type { UserProfile } from "@paper-baker/core";
import {
  isReservedHandle,
  isValidHandle,
  normalizeHandle,
} from "@paper-baker/core";
import { requireAuth } from "../middleware/auth.js";

const db = () => getFirestore();
const usersCol = () => db().collection("users");
const handlesCol = () => db().collection("handles");

/**
 * Identity API — the public profile + handle registry.
 *
 * The Firebase uid stays the internal key; this layer adds the public, GitHub-style
 * handle (and display name) on top. Backend is the sole writer so handle uniqueness
 * is minted in one place and can never be forged. See DESIGN.md §3.2.
 *
 * Routes:
 *   GET /me                 — the caller's profile ({ uid, handle|null, displayName })
 *   PUT /me  {handle?,displayName?} — claim/change the handle + display name
 *   GET /users/:handle      — public profile lookup by handle
 *
 * Mounted behind the hosting rewrites /api/me and /api/users/** ; also works when
 * invoked directly (req.path = "/me"). Exported separately for integration tests.
 */
export async function handleUsersRequest(req: Request, res: Response): Promise<void> {
  // Normalize to a path relative to the api root, so "/api/me" and "/me" route alike.
  let p = req.path || "/";
  if (p.startsWith("/api")) p = p.slice(4) || "/";
  const segments = p.split("/").filter(Boolean).map((s) => decodeURIComponent(s));

  try {
    if (segments[0] === "me" && segments.length === 1) {
      const uid = await authed(req, res);
      if (!uid) return;
      if (req.method === "GET") {
        await handleGetMe(uid, res);
        return;
      }
      if (req.method === "PUT") {
        await handleUpdateMe(uid, req, res);
        return;
      }
    }

    if (segments[0] === "users" && segments[1] && segments.length === 2) {
      const uid = await authed(req, res);
      if (!uid) return;
      if (req.method === "GET") {
        await handleGetUserByHandle(segments[1], res);
        return;
      }
    }

    res.status(404).json({ error: "Not found" });
  } catch (err: unknown) {
    console.error("users API error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// invoker: "public" so Hosting can reach it unauthenticated; the handler enforces
// app-level auth via requireAuth.
export const usersApi = onRequest({ cors: true, invoker: "public" }, handleUsersRequest);

// ---------------------------------------------------------------------------

async function authed(req: Request, res: Response): Promise<string | null> {
  try {
    return await requireAuth(req);
  } catch (err: unknown) {
    const e = err as { status: number; message: string };
    res.status(e.status).json({ error: e.message });
    return null;
  }
}

async function handleGetMe(uid: string, res: Response): Promise<void> {
  const snap = await usersCol().doc(uid).get();
  if (!snap.exists) {
    // No profile yet — the web onboards the user by PUTting a handle.
    res.status(200).json({ uid, handle: null, displayName: null });
    return;
  }
  res.status(200).json(snap.data() as UserProfile);
}

async function handleGetUserByHandle(rawHandle: string, res: Response): Promise<void> {
  const handle = normalizeHandle(rawHandle);
  const reg = await handlesCol().doc(handle).get();
  const uid = reg.data()?.uid as string | undefined;
  if (!uid) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  const profile = await usersCol().doc(uid).get();
  if (!profile.exists) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(200).json(profile.data() as UserProfile);
}

async function handleUpdateMe(uid: string, req: Request, res: Response): Promise<void> {
  const body = req.body as { handle?: unknown; displayName?: unknown };
  const rawHandle = typeof body.handle === "string" ? body.handle : undefined;
  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : undefined;

  let handle: string | undefined;
  if (rawHandle !== undefined) {
    handle = normalizeHandle(rawHandle);
    if (!isValidHandle(handle)) {
      res.status(400).json({
        error: "Invalid handle: use 3–39 lowercase letters, numbers, and single hyphens.",
      });
      return;
    }
    if (isReservedHandle(handle)) {
      res.status(409).json({ error: "That handle is reserved." });
      return;
    }
  }

  const now = new Date().toISOString();

  // Claim the handle (if changing) and write the profile in one transaction so a
  // handle can never be double-claimed. Reads first, then writes (tx requirement).
  let conflict = false;
  await db().runTransaction(async (tx) => {
    const meRef = usersCol().doc(uid);
    const meSnap = await tx.get(meRef);
    const existing = meSnap.data() as UserProfile | undefined;

    let oldHandleRef = null;
    if (handle !== undefined && existing?.handle && existing.handle !== handle) {
      oldHandleRef = handlesCol().doc(existing.handle);
    }

    if (handle !== undefined) {
      const taken = await tx.get(handlesCol().doc(handle));
      const owner = taken.data()?.uid as string | undefined;
      if (owner && owner !== uid) {
        conflict = true;
        return;
      }
    }

    const profile: UserProfile = {
      uid,
      handle: handle ?? existing?.handle ?? "",
      displayName: displayName ?? existing?.displayName ?? "",
      createdAt: existing?.createdAt ?? now,
    };

    if (handle !== undefined) {
      if (oldHandleRef) tx.delete(oldHandleRef);
      tx.set(handlesCol().doc(handle), { uid });
    }
    tx.set(meRef, profile);
  });

  if (conflict) {
    res.status(409).json({ error: "That handle is already taken." });
    return;
  }

  // Keep the denormalized ownerHandle on the caller's projects in sync.
  if (handle !== undefined) {
    await fanOutOwnerHandle(uid, handle);
  }

  const fresh = await usersCol().doc(uid).get();
  res.status(200).json(fresh.data() as UserProfile);
}

/** Update the denormalized ownerHandle on every project this user owns. */
async function fanOutOwnerHandle(uid: string, handle: string): Promise<void> {
  const owned = await db().collection("projects").where("ownerUid", "==", uid).get();
  if (owned.empty) return;
  const batch = db().batch();
  for (const doc of owned.docs) batch.update(doc.ref, { ownerHandle: handle });
  await batch.commit();
}
