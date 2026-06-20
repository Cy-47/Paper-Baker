import { defineConfig, devices } from "@playwright/test";

// Full-stack web E2E. Run via `pnpm test:e2e` (scripts/e2e.sh), which brings up
// an ISOLATED emulator on offset ports so it never collides with a dev emulator
// running on the standard ports. The ports below match firebase.e2e.json; they
// can be overridden via env if you ever need to relocate them.
const FS_PORT = process.env.E2E_FIRESTORE_PORT ?? "8180";
const AUTH_PORT = process.env.E2E_AUTH_PORT ?? "9199";
const FN_PORT = process.env.E2E_FUNCTIONS_PORT ?? "5101";
const WEB_PORT = process.env.E2E_WEB_PORT ?? "5273";

// seed.ts writes straight to the Firestore emulator over REST. emulators:exec
// sets FIRESTORE_EMULATOR_HOST for us; default it here so a direct run (reusing
// an already-up e2e emulator) targets the same isolated port the app uses.
process.env.FIRESTORE_EMULATOR_HOST ??= `127.0.0.1:${FS_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    // Own Vite instance on its own port (not the dev server's 5173), pointed at
    // the isolated emulator's offset ports.
    command: `pnpm dev:web`,
    url: `http://localhost:${WEB_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      VITE_USE_EMULATOR: "true",
      VITE_EMULATOR_AUTH_PORT: AUTH_PORT,
      VITE_EMULATOR_FIRESTORE_PORT: FS_PORT,
      E2E_FUNCTIONS_PORT: FN_PORT,
      E2E_WEB_PORT: WEB_PORT,
    },
  },
});
