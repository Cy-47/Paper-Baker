#!/usr/bin/env node
// Generate the Ed25519 release signing keypair (the Tauri model: an app-level
// key, embedded in the binary, that auto-update uses to verify downloads).
//
//   node scripts/gen-signing-key.mjs [privateKeyOutPath]
//
// Writes:
//   - the PUBLIC key to apps/cli/signing-pub.pem  (commit this; tsup embeds it)
//   - the PRIVATE key to <privateKeyOutPath>      (default ./pb-signing-private.pem,
//                                                  mode 0600, gitignored — NEVER commit)
//
// The private key is never printed. Store it as a CI secret and back it up
// offline, then delete the working copy. If it leaks, an attacker can sign
// malicious updates; rotating means shipping a new build with a new pubkey.
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url)); // apps/cli/scripts
const cliDir = resolve(here, ".."); // apps/cli
const pubOut = join(cliDir, "signing-pub.pem");
const privOut = resolve(process.argv[2] ?? "pb-signing-private.pem");

if (existsSync(pubOut)) {
  console.error(`Refusing to overwrite existing ${pubOut}.`);
  console.error("Delete it first if you intend to rotate the signing key.");
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync(privOut, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
writeFileSync(pubOut, publicKey.export({ type: "spki", format: "pem" }));

console.log(`✓ Public key  -> ${pubOut}   (commit this)`);
console.log(`✓ Private key -> ${privOut}  (mode 0600 — DO NOT commit)`);
console.log("");
console.log("Next steps:");
console.log(`  1. Store the private key as the CI signing secret:`);
console.log(`       gh secret set PB_SIGNING_KEY < ${privOut}`);
console.log(`  2. Commit apps/cli/signing-pub.pem.`);
console.log(`  3. Back up the private key offline, then remove the working copy:`);
console.log(`       rm ${privOut}`);
