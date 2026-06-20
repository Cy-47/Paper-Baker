import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import {
  isCliToken,
  parseConnectionId,
  tokenMatchesHash,
} from "../lib/cliSessions.js";

// Only refresh lastSeenAt this often — it's a "last active" hint for the CLI
// tab, not an audit log, so we trade precision for one fewer write per request.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Extract and verify the authenticated user's UID from the request.
 *
 * Two credential types map to a uid here:
 *
 *   1. Opaque CLI access tokens (`pbk.…`) — issued by the device-link flow.
 *      Resolved against the backend-only cliSessions doc (token hash → uid),
 *      then gated on the user-facing connection's revocation status. Because
 *      this token is NOT a Firebase identity, the API is its ONLY reachable
 *      surface — so this check is a complete, per-CLI revocation point.
 *   2. Firebase ID tokens — the web app (which calls /device/approve) and the
 *      legacy/CI $PAPERBAKER_TOKEN. Verified with revocation checking. These
 *      carry no per-CLI session and are not managed by the CLI tab.
 *
 * Throws an object with `status` and `message` on failure so the caller
 * can forward it as an HTTP error response.
 */
export async function requireAuth(req: Request): Promise<string> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { status: 401, message: "Missing or malformed Authorization header" };
  }

  const token = authHeader.split("Bearer ")[1];
  if (!token) {
    throw { status: 401, message: "Missing token" };
  }

  if (isCliToken(token)) {
    return resolveCliToken(token);
  }

  try {
    // checkRevoked: account-level revocation/disable takes effect on the next
    // call instead of lingering until the ID token's ~1h expiry.
    const decoded = await getAuth().verifyIdToken(token, true);
    return decoded.uid;
  } catch {
    throw { status: 401, message: "Invalid or expired token" };
  }
}

/**
 * Resolve an opaque CLI access token to its uid, or throw a 401. The token is
 * untrusted input: we trust nothing parsed out of it until its full string
 * hashes to the stored hash (constant-time). Revocation is enforced via the
 * user-facing connection doc, which the CLI tab writes directly.
 */
async function resolveCliToken(token: string): Promise<string> {
  const connectionId = parseConnectionId(token);
  if (!connectionId) {
    throw { status: 401, message: "Malformed access token" };
  }

  const db = getFirestore();

  // This is an auth gate: if a read fails, deny (503) rather than wave through.
  let sessionSnap;
  try {
    sessionSnap = await db.collection("cliSessions").doc(connectionId).get();
  } catch {
    throw { status: 503, message: "Could not verify CLI session" };
  }
  const session = sessionSnap.data() as
    | { uid?: string; tokenHash?: string }
    | undefined;
  if (!session?.tokenHash || !session.uid || !tokenMatchesHash(token, session.tokenHash)) {
    throw { status: 401, message: "Invalid access token" };
  }
  const uid = session.uid;

  let connSnap;
  try {
    connSnap = await db
      .collection("users")
      .doc(uid)
      .collection("clis")
      .doc(connectionId)
      .get();
  } catch {
    throw { status: 503, message: "Could not verify CLI session" };
  }
  if (!connSnap.exists || connSnap.data()?.status === "revoked") {
    throw { status: 401, message: "This CLI connection has been revoked" };
  }

  // Throttled, best-effort heartbeat — a failed write must not break the call.
  const lastSeenAt = connSnap.data()?.lastSeenAt as string | undefined;
  const stale =
    !lastSeenAt || Date.now() - Date.parse(lastSeenAt) > LAST_SEEN_THROTTLE_MS;
  if (stale) {
    await connSnap.ref
      .update({ lastSeenAt: new Date().toISOString() })
      .catch(() => undefined);
  }

  return uid;
}
