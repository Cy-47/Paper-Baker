import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

// Opaque CLI access tokens — the credential a connected CLI carries instead of a
// Firebase identity. Shape: `pbk.<connectionId>.<secret>`.
//
//   - The prefix lets requireAuth tell our token apart from a Firebase ID token
//     (both are dot-separated, but a JWT's first segment is base64url JSON, never
//     "pbk").
//   - connectionId is the lookup key (the cliSessions / users/{uid}/clis doc id).
//   - secret is 256 bits of entropy; only its SHA-256 is ever stored, so a leak
//     of the backend-only session doc doesn't yield a usable token.
//
// Because the credential is not a Firebase token, it can ONLY reach the Cloud
// Functions API (which resolves it here) — never Firestore directly — so deleting
// or revoking the session is a complete, single-surface logout.

export const CLI_TOKEN_PREFIX = "pbk";

/** Stable, URL/doc-id-safe id for a connected CLI (the lookup key). */
export function generateConnectionId(): string {
  return randomBytes(12).toString("base64url");
}

/** SHA-256 (hex) of a token — the only thing we persist. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Mint a fresh access token for a connection. Returns the token (handed to the
 * CLI once, never stored server-side) and its hash (stored backend-only).
 */
export function mintAccessToken(connectionId: string): {
  token: string;
  tokenHash: string;
} {
  const secret = randomBytes(32).toString("base64url");
  const token = `${CLI_TOKEN_PREFIX}.${connectionId}.${secret}`;
  return { token, tokenHash: hashToken(token) };
}

/** True if a bearer value is one of our opaque CLI tokens (vs a Firebase JWT). */
export function isCliToken(token: string): boolean {
  return token.startsWith(`${CLI_TOKEN_PREFIX}.`);
}

/** Extract the connectionId from a well-formed CLI token, else null. */
export function parseConnectionId(token: string): string | null {
  const parts = token.split(".");
  return parts.length === 3 && parts[0] === CLI_TOKEN_PREFIX ? parts[1] : null;
}

/** Constant-time check that a presented token hashes to the stored hash. */
export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const computed = hashToken(token);
  if (computed.length !== storedHash.length) return false;
  return timingSafeEqual(Buffer.from(computed), Buffer.from(storedHash));
}
