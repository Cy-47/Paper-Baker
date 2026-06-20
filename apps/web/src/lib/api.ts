import { PaperBakerClient } from "@paper-baker/api-client";
import { auth } from "./firebase";

// The Functions API base. Same-origin hosting rewrites (/api/*) in production;
// point at the local hosting emulator for dev/e2e via VITE_API_URL.
const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

/**
 * A PaperBakerClient authenticated as the current user. Every mutation the web
 * makes now goes through the backend (the single write path the CLI also uses),
 * so domain logic lives in exactly one place. Reads stay on Firestore snapshots
 * for real-time. We mint a client per call so the Firebase ID token is always
 * fresh (getIdToken refreshes it as needed).
 */
export async function getApiClient(): Promise<PaperBakerClient> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  return new PaperBakerClient({ baseUrl: API_BASE, token });
}
