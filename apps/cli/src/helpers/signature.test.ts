import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { describe, it, expect } from "vitest";
import { signingConfigured, verifyBinarySignature } from "./signature.js";

// A fresh Ed25519 keypair per suite, mirroring what gen-signing-key.mjs writes
// (SPKI public PEM) and sign-binaries.mjs produces (raw signature).
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }) as string;
const sign = (buf: Buffer) => cryptoSign(null, buf, privateKey);

describe("signingConfigured", () => {
  it("is false for an empty/whitespace key, true for a real one", () => {
    expect(signingConfigured("")).toBe(false);
    expect(signingConfigured("   \n")).toBe(false);
    expect(signingConfigured(PUB_PEM)).toBe(true);
  });
});

describe("verifyBinarySignature", () => {
  const payload = Buffer.from("the pb binary bytes");

  it("accepts a valid signature from the matching key", () => {
    expect(() => verifyBinarySignature(payload, sign(payload), PUB_PEM)).not.toThrow();
  });

  it("rejects a tampered payload", () => {
    const sig = sign(payload);
    const tampered = Buffer.from("the pb binary bytez");
    expect(() => verifyBinarySignature(tampered, sig, PUB_PEM)).toThrow(/verification failed/i);
  });

  it("rejects a signature from a different key", () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const sig = cryptoSign(null, payload, other);
    expect(() => verifyBinarySignature(payload, sig, PUB_PEM)).toThrow(/verification failed/i);
  });

  it("rejects a malformed (wrong-length) signature instead of crashing", () => {
    expect(() => verifyBinarySignature(payload, Buffer.from("nope"), PUB_PEM)).toThrow(
      /verification failed/i,
    );
  });

  it("fails closed when no signing key is embedded", () => {
    expect(() => verifyBinarySignature(payload, sign(payload), "")).toThrow(
      /no release signing key/i,
    );
  });

  it("rejects a structurally invalid public key", () => {
    expect(() => verifyBinarySignature(payload, sign(payload), "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----")).toThrow(
      /invalid embedded signing key/i,
    );
  });
});
