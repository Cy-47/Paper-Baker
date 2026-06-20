#!/usr/bin/env bash
# Run the Playwright E2E suite against an ISOLATED emulator.
#
# The e2e emulator runs on offset ports (firestore 8180, auth 9199, functions
# 5101, hub 4500 — see firebase.e2e.json), so it never collides with a dev
# emulator on the standard ports. Your dev emulator and its data are left
# completely untouched; you can keep `pnpm emulators` running while e2e runs.
#
# If an e2e emulator is already up on :8180 (e.g. you ran `pnpm emulators:e2e`
# to keep one alive for fast iteration), reuse it — clear its Firestore data for
# a clean run and leave it running. Otherwise spin up a throwaway one via
# `firebase emulators:exec`, which stops it when the run finishes.
#
# Extra args forward to Playwright: `pnpm test:e2e -- --ui`, or
# `pnpm test:e2e e2e/home-abstract.spec.ts`.
set -euo pipefail

_repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$_repo"

PROJECT_ID="paper-baker"
E2E_FIRESTORE_HOST="127.0.0.1:8180"

# Functions are bundled by the emulator; build them first either way.
pnpm --filter @paper-baker/functions build

if curl -sf "http://${E2E_FIRESTORE_HOST}/" >/dev/null 2>&1; then
  echo "↻ Reusing the e2e emulator already on :8180 (it will stay up)."
  echo "  Clearing its Firestore data for a clean run…"
  curl -sf -X DELETE \
    "http://${E2E_FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents" \
    >/dev/null
  FIRESTORE_EMULATOR_HOST="$E2E_FIRESTORE_HOST" exec npx playwright test "$@"
else
  echo "▶ Starting a throwaway isolated emulator on offset ports for this run."
  export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
  exec firebase emulators:exec --config firebase.e2e.json \
    --only auth,firestore,functions --project "$PROJECT_ID" \
    "npx playwright test $*"
fi
