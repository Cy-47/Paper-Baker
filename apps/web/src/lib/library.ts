import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";
import { db, auth } from "./firebase";
import type { PaperMetadata } from "@paper-baker/core";
import { getApiClient } from "./api";

// ---------------------------------------------------------------------------
// The web's data layer. READS are direct Firestore snapshots (real-time);
// WRITES go through the Functions API (the single backend write path the CLI
// also uses), so domain logic isn't duplicated client-side. Admin writes from
// the API still fire these snapshot listeners, so the UI stays reactive.
// ---------------------------------------------------------------------------

// The thin per-user record at users/{uid}/savedPapers/{paperId}: just the id and
// user-specific data. Metadata is NOT stored here — it lives once in the global
// papers/{paperId} cache, which useData joins in (see getPaperMeta).
export interface SavedRecord {
  paperId: string;
  savedAt: string;
}

// A library item as the UI consumes it: the paper's canonical metadata (joined
// from papers/) plus this user's saved/membership state. `projectIds` is derived
// in useData from the projectPapers memberships (the single source of truth), so
// a stale array can never diverge from the real membership. The ids it holds are
// project stableIds (the global doc keys used for every data op).
export interface LibraryItem extends PaperMetadata {
  projectIds: string[];
  savedAt?: string;
}

// One project<->paper membership, surfaced from a collectionGroup query.
export interface Membership {
  paperId: string;
  projectStableId: string;
}

export interface ProjectDoc {
  // The global, server-minted doc key — used for every data op (file/rename/etc).
  stableId: string;
  // The user-facing, renamable id (the `id` in `handle/id`) — used in URLs.
  id: string;
  name: string;
  description: string;
  ownerUid: string;
  ownerHandle: string;
}

function uid(): string {
  const u = auth.currentUser;
  if (!u) throw new Error("Not signed in");
  return u.uid;
}

// ---------------------------------------------------------------------------
// Reads — direct Firestore snapshots
// ---------------------------------------------------------------------------

// The user's saved papers: users/{uid}/savedPapers/{paperId} (thin records).
function libCol() {
  return collection(db, "users", uid(), "savedPapers");
}

// Projects are now top-level docs at projects/{stableId}. Reads are gated on
// membership (the security rules require the array-contains filter below), so the
// query returns exactly the projects this user can see (owned + later shared).
function projectsCol() {
  return collection(db, "projects");
}

export function subscribeSavedPapers(cb: (saved: SavedRecord[]) => void) {
  return onSnapshot(libCol(), (snap) => {
    cb(
      snap.docs.map((d) => {
        // `savedAt` is written server-side as an ISO string, but tolerate a
        // Firestore Timestamp too (defensive) and normalize to a string.
        const raw = d.data().savedAt;
        const savedAt =
          raw instanceof Timestamp
            ? raw.toDate().toISOString()
            : typeof raw === "string"
              ? raw
              : "";
        return { paperId: d.id, savedAt };
      })
    );
  });
}

// Read a paper's canonical metadata from the global papers/{id} cache. The cache
// is populated by the backend on resolve (the save endpoint resolves before
// writing the thin record), so every saved/filed paper has an entry here.
export async function getPaperMeta(paperId: string): Promise<PaperMetadata | null> {
  const snap = await getDoc(doc(db, "papers", paperId));
  return snap.exists() ? (snap.data() as PaperMetadata) : null;
}

// All of the current user's project memberships, in one collectionGroup query.
// Authorized by the recursive projectPapers rule (read if member); the
// array-contains filter is required for that rule to admit the query.
export function subscribeMemberships(cb: (memberships: Membership[]) => void) {
  const q = query(
    collectionGroup(db, "projectPapers"),
    where("memberUids", "array-contains", uid())
  );
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          paperId: data.paperId as string,
          projectStableId: data.projectStableId as string,
        };
      })
    );
  });
}

export function subscribeProjects(cb: (projects: ProjectDoc[]) => void) {
  const q = query(
    projectsCol(),
    where("memberUids", "array-contains", uid())
  );
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          stableId: d.id,
          id: data.id ?? d.id,
          name: data.name ?? "",
          description: data.description ?? "",
          ownerUid: data.ownerUid ?? "",
          ownerHandle: data.ownerHandle ?? "",
        };
      })
    );
  });
}

// ---------------------------------------------------------------------------
// Writes — through the Functions API (one shared backend implementation)
// ---------------------------------------------------------------------------

/**
 * Create a project (backend mints the global stableId + an owner-unique id).
 * Returns both the `stableId` (used for filing papers and other mutations) and
 * the user-facing `id` (used to build the project URL).
 */
export async function createProject(
  name: string,
  description = "",
): Promise<{ stableId: string; id: string }> {
  const project = await (await getApiClient()).createProject(name.trim(), description.trim());
  return { stableId: project.stableId, id: project.id };
}

/** Rename a project; the stableId (and every binding) is unchanged. */
export async function renameProject(stableId: string, name: string): Promise<void> {
  await (await getApiClient()).updateProject(stableId, { name: name.trim() });
}

/** Save a paper to the library (backend resolves its metadata, then saves). */
export async function saveToLibrary(paper: PaperMetadata): Promise<void> {
  await (await getApiClient()).saveToLibrary(paper.source);
}

/** File a paper into a project. Ensures it's saved (resolved) first, then files. */
export async function addPaperToProject(
  stableId: string,
  paper: PaperMetadata
): Promise<void> {
  const client = await getApiClient();
  await client.saveToLibrary(paper.source);
  await client.addPaperToProject(stableId, paper.paperId);
}

/** Unfile a paper from one project (leaves it saved in the library). */
export async function removePaperFromProject(
  stableId: string,
  paperId: string
): Promise<void> {
  await (await getApiClient()).removePaperFromProject(stableId, paperId);
}

/** Unsave a paper entirely. The backend cascades the unfiling across projects. */
export async function removeFromLibrary(paperId: string): Promise<void> {
  await (await getApiClient()).removeFromLibrary(paperId);
}

// Dev-only: lets automated checks seed the library through the real save path
// (the API). The e2e seeds the matching papers/{id} metadata into the emulator
// (see e2e/seed.ts) so the backend resolve finds it without hitting arxiv.
if (import.meta.env.DEV) {
  (window as unknown as { __pbSaveToLibrary?: unknown }).__pbSaveToLibrary = (
    paper: PaperMetadata
  ) => saveToLibrary(paper);
}
