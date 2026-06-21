#!/usr/bin/env node
// Sign each release binary with the Ed25519 private key from $PB_SIGNING_KEY
// (PKCS8 PEM contents, supplied as a CI secret). Writes <asset>.sig — the raw
// signature, base64-encoded — next to each binary, exactly what the CLI's
// downloadAndSwap fetches and verifyBinarySignature checks.
//
// Run AFTER ad-hoc signing + checksums so the signature covers the final bytes
// that ship. Skips .sha256/.sig sidecars so re-runs don't sign sidecars.
import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const pem = process.env.PB_SIGNING_KEY;
if (!pem || !pem.trim()) {
  console.error("PB_SIGNING_KEY is not set — cannot sign release binaries.");
  process.exit(1);
}
const key = createPrivateKey(pem);

const here = dirname(fileURLToPath(import.meta.url)); // apps/cli/scripts
const binDir = resolve(here, "..", "binaries");

const binaries = readdirSync(binDir).filter(
  (f) => f.startsWith("pb-") && !f.endsWith(".sig") && !f.endsWith(".sha256"),
);
if (binaries.length === 0) {
  console.error(`No binaries found in ${binDir}.`);
  process.exit(1);
}

for (const f of binaries) {
  const p = join(binDir, f);
  const sig = cryptoSign(null, readFileSync(p), key).toString("base64");
  writeFileSync(`${p}.sig`, sig + "\n");
  console.log(`Signed ${f} -> ${f}.sig`);
}
