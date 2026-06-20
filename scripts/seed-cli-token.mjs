#!/usr/bin/env node
// Seed a connected-CLI session straight into the Firestore emulator and print a
// matching opaque access token — so you can exercise the authenticated CLI
// against local emulators without the browser device-link dance:
//
//   pnpm emulators:all                       # in one terminal
//   export PAPERBAKER_TOKEN=$(pnpm -s seed-cli-token)
//   node apps/cli/dist/index.js project list # now authenticated as the seeded uid
//
// Pass a uid as the first arg (default "dev-user"). Writes via the emulator's
// admin REST endpoint (Bearer owner bypasses security rules, like the Admin SDK).

import { randomBytes, createHash } from "node:crypto";

const PROJECT_ID = "paper-baker";
const HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const uid = process.argv[2] || "dev-user";

// Mint the token exactly like functions/src/lib/cliSessions.ts.
const connectionId = randomBytes(12).toString("base64url");
const secret = randomBytes(32).toString("base64url");
const token = `pbk.${connectionId}.${secret}`;
const tokenHash = createHash("sha256").update(token).digest("hex");
const now = new Date().toISOString();

const s = (stringValue) => ({ stringValue });
const docName = (path) =>
  `projects/${PROJECT_ID}/databases/(default)/documents/${path}`;

const writes = [
  {
    update: {
      name: docName(`cliSessions/${connectionId}`),
      fields: { connectionId: s(connectionId), uid: s(uid), tokenHash: s(tokenHash), createdAt: s(now) },
    },
  },
  {
    update: {
      name: docName(`users/${uid}/clis/${connectionId}`),
      fields: {
        connectionId: s(connectionId),
        uid: s(uid),
        status: s("active"),
        device: { mapValue: { fields: { hostname: s("seed-cli-token"), platform: s(process.platform) } } },
        createdAt: s(now),
        lastSeenAt: s(now),
      },
    },
  },
];

const res = await fetch(
  `http://${HOST}/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
  {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner" },
    body: JSON.stringify({ writes }),
  },
);
if (!res.ok) {
  console.error(`seed-cli-token failed (${res.status}): ${await res.text()}`);
  console.error(`Is the Firestore emulator running at ${HOST}? Try: pnpm emulators:all`);
  process.exit(1);
}

// Token to stdout (so it can be captured); human note to stderr.
console.error(`Seeded CLI connection ${connectionId} for uid "${uid}".`);
console.log(token);
