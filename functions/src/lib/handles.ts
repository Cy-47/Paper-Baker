import { getFirestore } from "firebase-admin/firestore";
import { normalizeHandle } from "@paper-baker/core";

// ---------------------------------------------------------------------------
// Handle registry helpers. The handles/{handle} collection maps a public handle
// to its owning uid (uniqueness + reverse lookup). Backend-only writes; resolving
// a handle is a plain read. See DESIGN.md §3.2.
// ---------------------------------------------------------------------------

const db = () => getFirestore();

/** Resolve a (raw) handle to its uid, or null if unclaimed. */
export async function resolveHandle(rawHandle: string): Promise<string | null> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return null;
  const snap = await db().collection("handles").doc(handle).get();
  return snap.exists ? ((snap.data()?.uid as string | undefined) ?? null) : null;
}
