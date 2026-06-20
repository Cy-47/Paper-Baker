import { randomBytes, randomInt } from "node:crypto";

// Device authorization grant (RFC 8628) parameters and code generation.
//
// Two codes per login attempt:
//   - deviceCode: long, secret, held only by the CLI; the poll/claim ticket.
//   - userCode:   short, human-typed in the browser on the /device page.
// They only meet server-side once the user has proven who they are.

export const DEVICE_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const DEVICE_POLL_INTERVAL_S = 5;

// Human-typed alphabet: Crockford-ish base32 with ambiguous glyphs removed
// (no 0/1, no I/L/O/U) so codes are easy to read aloud and type.
const USER_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const USER_CODE_LEN = 8;

/** Long, URL-safe secret the CLI keeps and polls with. */
export function generateDeviceCode(): string {
  return randomBytes(32).toString("base64url");
}

/** Short user-facing code, normalized form (no separator), e.g. "ABCD2FGH". */
export function generateUserCode(): string {
  let out = "";
  for (let i = 0; i < USER_CODE_LEN; i++) {
    out += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)];
  }
  return out;
}

/** Display form with a separator for readability: "ABCD-2FGH". */
export function formatUserCode(normalized: string): string {
  const mid = Math.ceil(normalized.length / 2);
  return `${normalized.slice(0, mid)}-${normalized.slice(mid)}`;
}

/** Normalize a user-entered code for lookup: uppercase, drop non-alphanumerics. */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
