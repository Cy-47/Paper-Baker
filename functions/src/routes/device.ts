import { onRequest, type Request } from "firebase-functions/v2/https";
import {
  getFirestore,
  type CollectionReference,
} from "firebase-admin/firestore";
import type { Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { routePath } from "../lib/routePath.js";
import {
  DEVICE_CODE_TTL_MS,
  DEVICE_POLL_INTERVAL_S,
  generateDeviceCode,
  generateUserCode,
  formatUserCode,
  normalizeUserCode,
} from "../lib/deviceCodes.js";
import { generateConnectionId, mintAccessToken } from "../lib/cliSessions.js";

const db = () => getFirestore();
const deviceCodes = (): CollectionReference => db().collection("deviceCodes");
// Backend-only secret material for a connected CLI (token hash + owner). Locked
// off in firestore.rules — never client-readable. Keyed by connectionId.
const cliSessions = (): CollectionReference => db().collection("cliSessions");
// User-facing connection registry powering the web "CLI" tab. Holds only
// display metadata + the revocation status; carries no secret.
const clisCol = (uid: string): CollectionReference =>
  db().collection("users").doc(uid).collection("clis");
// Append-only audit log behind the "CLI" tab: one entry per connect/delete, with
// a snapshot of the device label so a deleted connection still reads sensibly.
// Backend-only writes (locked off in rules); the owner reads their own.
const cliEvents = (uid: string): CollectionReference =>
  db().collection("users").doc(uid).collection("cliEvents");

/**
 * Self-reported device info, captured at `/code` time so the web "CLI" tab can
 * show a recognizable label. Untrusted (anyone can claim any hostname) — it's a
 * UI affordance for the account owner, never a security control. Length-capped
 * so a malicious CLI can't bloat the doc.
 */
interface DeviceInfo {
  hostname?: string;
  platform?: string;
  cliVersion?: string;
}

function sanitizeDeviceInfo(raw: unknown): DeviceInfo {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : undefined;
  const info: DeviceInfo = {};
  const hostname = str(obj.hostname);
  const platform = str(obj.platform);
  const cliVersion = str(obj.cliVersion);
  if (hostname) info.hostname = hostname;
  if (platform) info.platform = platform;
  if (cliVersion) info.cliVersion = cliVersion;
  return info;
}

// Where the user approves a login. The CLI prints `${webBaseUrl()}/device`; the
// user opens it in any browser, signs in with any Firebase provider, and enters
// the user code. Read at request time (NOT a module-load const) so the deployed
// env — or the emulator's PAPERBAKER_WEB_URL — always takes effect; a stale
// import-time default once made the emulator print the prod URL.
function webBaseUrl(): string {
  return process.env.PAPERBAKER_WEB_URL ?? "https://paper-baker.web.app";
}

interface DeviceCodeDoc {
  userCode: string; // normalized (no separator)
  status: "pending" | "approved" | "consumed";
  uid: string | null;
  device?: DeviceInfo; // self-reported, captured at /code time
  createdAt: string;
  expiresAt: string; // ISO 8601
}

/**
 * The user-facing half of a connected CLI, surfaced and revoked in the web "CLI"
 * tab (users/{uid}/clis/{connectionId}). Carries no secret — only display
 * metadata and the revocation status that requireAuth reads. Clients may read,
 * revoke (status → revoked), and delete their own, but never forge one.
 */
interface CliConnectionDoc {
  connectionId: string;
  uid: string;
  status: "active" | "revoked";
  device: DeviceInfo;
  createdAt: string;
  lastSeenAt: string;
}

/**
 * The backend-only half (cliSessions/{connectionId}): the SHA-256 of the access
 * token and the owner it resolves to. requireAuth verifies a presented token
 * against this, then checks the user-facing doc for revocation. Locked off in
 * rules so the hash is never client-readable.
 */
interface CliSessionDoc {
  connectionId: string;
  uid: string;
  tokenHash: string;
  createdAt: string;
}

/**
 * One entry in the append-only CLI activity log (users/{uid}/cliEvents). Written
 * backend-side when a CLI connects or is deleted. Carries a snapshot of the
 * device label so the log still reads sensibly after the connection is gone.
 */
interface CliEventDoc {
  type: "connected" | "deleted";
  connectionId: string;
  device: DeviceInfo;
  at: string; // ISO 8601
}

/** Append one entry to a user's CLI activity log (best-effort id via auto-doc). */
function logCliEvent(uid: string, event: CliEventDoc): Promise<unknown> {
  return cliEvents(uid).doc().set(event);
}

/**
 * Device-link auth API — the provider-agnostic bridge into Firebase.
 *
 * Routes:
 *   POST /code     — (unauthenticated) start a login; returns device + user code
 *   POST /approve  — (authenticated)   the /device page approves a user code,
 *                    binding it to the signed-in uid (any provider)
 *   POST /token    — (unauthenticated) CLI polls with the device code; once
 *                    approved, returns a Firebase custom token (minted once)
 *
 * The deviceCodes collection is Admin-SDK-only (locked off in firestore.rules).
 *
 * Exported separately from the onRequest wrapper so integration tests can drive
 * it against the emulators with mock req/res.
 */
export async function handleDeviceRequest(
  req: Request,
  res: Response,
): Promise<void> {
  // Works both directly (req.path = "/code") and behind the hosting rewrite
  // (req.path = "/api/device/code").
  const segments = routePath(req.path, "/api/device").split("/").filter(Boolean);
  const route = segments[0] ?? "";

  try {
    if (req.method === "POST" && route === "code") {
      await handleRequestCode(req, res);
      return;
    }
    if (req.method === "POST" && route === "approve") {
      await handleApprove(req, res);
      return;
    }
    if (req.method === "POST" && route === "token") {
      await handlePollToken(req, res);
      return;
    }
    // Connection management for the web "CLI" tab (owner-authenticated):
    //   DELETE /connections/:id — delete the connection (forgets + revokes it)
    if (route === "connections" && segments[1]) {
      const connectionId = decodeURIComponent(segments[1]);
      if (req.method === "DELETE" && segments.length === 2) {
        await handleDeleteConnection(req, connectionId, res);
        return;
      }
    }
    res.status(404).json({ error: "Not found" });
  } catch (err: unknown) {
    console.error("device API error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const deviceApi = onRequest({ cors: true }, handleDeviceRequest);

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** Authenticate, then return the caller's uid, or null after sending a 401. */
async function authedUid(req: Request, res: Response): Promise<string | null> {
  try {
    return await requireAuth(req);
  } catch (err: unknown) {
    const e = err as { status: number; message: string };
    res.status(e.status).json({ error: e.message });
    return null;
  }
}

// Delete is the only user-facing connection action (GitHub-style: one button,
// no "disabled-but-listed" tombstone). Deleting the user-facing doc already makes
// requireAuth reject the token (it 401s when the connection is missing); we also
// drop the backend session so no orphan hash lingers, and append a "deleted"
// entry to the activity log — all atomically. (The status→revoked gate in
// requireAuth remains as defense-in-depth; it just has no API surface now.)
async function handleDeleteConnection(
  req: Request,
  connectionId: string,
  res: Response,
): Promise<void> {
  const uid = await authedUid(req, res);
  if (!uid) return;
  const ref = clisCol(uid).doc(connectionId);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Connection not found" });
    return;
  }
  const device = (snap.data() as CliConnectionDoc).device ?? {};

  const batch = db().batch();
  batch.delete(ref);
  batch.delete(cliSessions().doc(connectionId));
  batch.set(cliEvents(uid).doc(), {
    type: "deleted",
    connectionId,
    device,
    at: new Date().toISOString(),
  } satisfies CliEventDoc);
  await batch.commit();
  res.status(200).json({ deleted: true });
}

async function handleRequestCode(req: Request, res: Response): Promise<void> {
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const now = Date.now();

  const doc: DeviceCodeDoc = {
    userCode,
    status: "pending",
    uid: null,
    device: sanitizeDeviceInfo((req.body as { device?: unknown }).device),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DEVICE_CODE_TTL_MS).toISOString(),
  };
  await deviceCodes().doc(deviceCode).set(doc);

  res.status(201).json({
    deviceCode,
    userCode: formatUserCode(userCode),
    verificationUri: `${webBaseUrl()}/device`,
    interval: DEVICE_POLL_INTERVAL_S,
    expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
  });
}

async function handleApprove(req: Request, res: Response): Promise<void> {
  // The approver must be signed in — their verified uid is what we bind. The
  // client cannot forge it; requireAuth checks a real Firebase ID token.
  let uid: string;
  try {
    uid = await requireAuth(req);
  } catch (err: unknown) {
    const e = err as { status: number; message: string };
    res.status(e.status).json({ error: e.message });
    return;
  }

  const raw = (req.body as { userCode?: string }).userCode;
  if (!raw || typeof raw !== "string") {
    res.status(400).json({ error: "userCode is required" });
    return;
  }
  const userCode = normalizeUserCode(raw);

  const q = await deviceCodes()
    .where("userCode", "==", userCode)
    .where("status", "==", "pending")
    .limit(1)
    .get();

  if (q.empty) {
    res.status(404).json({ error: "Unknown or already-used code" });
    return;
  }
  const snap = q.docs[0];
  if (Date.parse((snap.data() as DeviceCodeDoc).expiresAt) < Date.now()) {
    res.status(400).json({ error: "Code expired" });
    return;
  }

  await snap.ref.update({
    status: "approved",
    uid,
    approvedAt: new Date().toISOString(),
  });
  res.status(200).json({ approved: true });
}

async function handlePollToken(req: Request, res: Response): Promise<void> {
  const deviceCode = (req.body as { deviceCode?: string }).deviceCode;
  if (!deviceCode || typeof deviceCode !== "string") {
    res.status(400).json({ error: "deviceCode is required" });
    return;
  }

  const ref = deviceCodes().doc(deviceCode);
  const snap = await ref.get();
  if (!snap.exists) {
    res.status(404).json({ error: "Unknown device code" });
    return;
  }
  const data = snap.data() as DeviceCodeDoc;

  if (Date.parse(data.expiresAt) < Date.now()) {
    await ref.delete();
    res.status(400).json({ error: "expired" });
    return;
  }
  if (data.status === "pending") {
    res.status(200).json({ status: "pending" });
    return;
  }
  if (data.status === "consumed" || !data.uid) {
    res.status(400).json({ error: "already_used" });
    return;
  }

  // Approved: register a connected-CLI session and mint an opaque access token
  // for it. The token is NOT a Firebase credential — it only resolves through
  // this API (requireAuth), never Firestore — so revoking the connection is a
  // complete, single-surface logout. We persist only the token's hash.
  //
  // Order matters: write the secret-bearing session and the user-facing doc
  // BEFORE handing back the token, so it's enforceable the instant the CLI calls.
  const now = new Date().toISOString();
  const connectionId = generateConnectionId();
  const { token, tokenHash } = mintAccessToken(connectionId);

  const session: CliSessionDoc = {
    connectionId,
    uid: data.uid,
    tokenHash,
    createdAt: now,
  };
  await cliSessions().doc(connectionId).set(session);

  const connection: CliConnectionDoc = {
    connectionId,
    uid: data.uid,
    status: "active",
    device: data.device ?? {},
    createdAt: now,
    lastSeenAt: now,
  };
  await clisCol(data.uid).doc(connectionId).set(connection);
  await logCliEvent(data.uid, {
    type: "connected",
    connectionId,
    device: connection.device,
    at: now,
  });

  await ref.update({ status: "consumed", consumedAt: now });
  res.status(200).json({ status: "approved", uid: data.uid, accessToken: token });
}
