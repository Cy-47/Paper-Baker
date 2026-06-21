import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// ---------------------------------------------------------------------------
// Release signature verification.
//
// Auto-update runs with no human in the loop, so the downloaded binary must be
// authenticated, not just transport-secured. Each release artifact is signed in
// CI with an Ed25519 private key (held only as a GitHub secret); the matching
// public key is embedded here at build time and used to verify the signature
// BEFORE the binary is ever written or executed. This is the Tauri model: the
// trust anchor is an app-level key, not OS code signing.
//
// tsup injects __PB_SIGNING_PUBKEY__ from apps/cli/signing-pub.pem (see
// tsup.config.ts), mirroring the VERSION define. Under tsx/tests the define is
// absent and this falls back to "" — which makes verification fail closed.
// ---------------------------------------------------------------------------

declare const __PB_SIGNING_PUBKEY__: string | undefined;

export const SIGNING_PUBKEY: string =
  typeof __PB_SIGNING_PUBKEY__ === "string" ? __PB_SIGNING_PUBKEY__ : "";

/** Whether this build carries a release signing key. Gates auto-update so we
 *  never spawn a background updater that could only fail closed at verify. */
export function signingConfigured(pubkeyPem: string = SIGNING_PUBKEY): boolean {
  return pubkeyPem.trim().length > 0;
}

/**
 * Verify an Ed25519 signature over `buf` against the release public key. Throws
 * if the signature is invalid, malformed, or if no key is embedded — we fail
 * closed and never install an unverified binary. `sig` is the raw signature
 * bytes. The verifying key defaults to the build-time-embedded SIGNING_PUBKEY;
 * tests pass an explicit key generated in-process.
 */
export function verifyBinarySignature(
  buf: Buffer,
  sig: Buffer,
  pubkeyPem: string = SIGNING_PUBKEY,
): void {
  if (!signingConfigured(pubkeyPem)) {
    throw new Error(
      "No release signing key is embedded in this build; refusing to install an unverified update.",
    );
  }

  let key;
  try {
    key = createPublicKey(pubkeyPem);
  } catch (err) {
    throw new Error(
      `Invalid embedded signing key: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }

  let ok: boolean;
  try {
    ok = cryptoVerify(null, buf, key, sig);
  } catch (err) {
    // A malformed signature (wrong length, garbage) throws rather than
    // returning false — treat that as a failed verification, not a crash.
    throw new Error(
      `Update signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
  if (!ok) {
    throw new Error("Update signature verification failed; refusing to install.");
  }
}
