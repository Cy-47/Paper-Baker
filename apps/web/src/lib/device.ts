import { auth } from "./firebase";

// Where the device-link endpoints live. Defaults to a same-origin hosting
// rewrite (/api/device/** → deviceApi); override for local/functions-emulator.
const DEVICE_API = import.meta.env.VITE_DEVICE_API_URL ?? "/api/device";

/**
 * Approve a pending CLI login by binding the signed-in user's uid to the
 * user code. Sends the current Firebase ID token; the backend verifies it and
 * reads the trusted uid from it.
 */
export async function approveDeviceCode(userCode: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to authorize a device.");

  const idToken = await user.getIdToken();
  const res = await fetch(`${DEVICE_API}/approve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ userCode }),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Approval failed (${res.status}).`);
  }
}
