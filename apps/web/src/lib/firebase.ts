import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  initializeFirestore,
  connectFirestoreEmulator,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// ignoreUndefinedProperties: arxiv metadata has optional fields (affiliation,
// venue, doi, updatedAt) that are often absent. Firestore rejects `undefined`
// values outright, so drop them instead of erroring on every write.
export const db = initializeFirestore(app, {
  ignoreUndefinedProperties: true,
});

// In local dev, point the SDK at the Firebase emulators instead of the cloud
// project. Set VITE_USE_EMULATOR=true in apps/web/.env to enable.
//
// The `import.meta.env.DEV` guard is load-bearing: it's statically `false` in a
// production `vite build`, so Rollup dead-code-eliminates this whole block. That
// makes it impossible for the emulator flag (or a stray VITE_USE_EMULATOR=true
// in a build env) to leak into a deployed bundle and point real users at
// localhost. The dev server and e2e (both `vite`, DEV=true) are unaffected.
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATOR === "true") {
  // Ports default to the standard emulator (pnpm emulators). The e2e suite runs
  // a second, isolated emulator on offset ports and overrides these via env
  // (see playwright.config.ts) so it never collides with a running dev one.
  const host = import.meta.env.VITE_EMULATOR_HOST ?? "127.0.0.1";
  const authPort = Number(import.meta.env.VITE_EMULATOR_AUTH_PORT ?? 9099);
  const firestorePort = Number(import.meta.env.VITE_EMULATOR_FIRESTORE_PORT ?? 8080);
  connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, firestorePort);
  console.info(`[firebase] Using local emulators (auth:${authPort}, firestore:${firestorePort})`);

  // Headless sign-in helper for automated testing against the Auth emulator,
  // which accepts unsigned ID tokens (no popup needed). Dev + emulator only.
  // Resolves to the emulator-minted uid so the e2e can seed that user's profile
  // (the uid is the emulator's, not the token's `sub`).
  (window as unknown as { __pbDevSignIn?: unknown }).__pbDevSignIn = async (
    email = "dev@example.com"
  ): Promise<string> => {
    const { GoogleAuthProvider, signInWithCredential } = await import(
      "firebase/auth"
    );
    const fakeIdToken = JSON.stringify({
      sub: "dev-user-1",
      email,
      email_verified: true,
      name: "Dev User",
    });
    const cred = GoogleAuthProvider.credential(fakeIdToken);
    const result = await signInWithCredential(auth, cred);
    return result.user.uid;
  };
}
