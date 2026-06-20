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
// a stale array can never diverge from the real membership.
export interface LibraryItem extends PaperMetadata {
  projectIds: string[];
  savedAt?: string;
}

// One project<->paper membership, surfaced from a collectionGroup query.
export interface Membership {
  paperId: string;
  projectId: string;
}

export interface ProjectDoc {
  projectId: string;
  slug: string;
  name: string;
  description: string;
  ownerUid: string;
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

// Projects are scoped under the owner: users/{uid}/projects/{id}. The path
// enforces ownership, so reads need no ownerUid filter.
function projectsCol() {
  return collection(db, "users", uid(), "projects");
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
// Authorized by the recursive projectPapers rule (read if ownerUid == uid); the
// where() filter is required for that rule to admit the query.
export function subscribeMemberships(cb: (memberships: Membership[]) => void) {
  const q = query(
    collectionGroup(db, "projectPapers"),
    where("ownerUid", "==", uid())
  );
  return onSnapshot(q, (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          paperId: data.paperId as string,
          projectId: data.projectId as string,
        };
      })
    );
  });
}

export function subscribeProjects(cb: (projects: ProjectDoc[]) => void) {
  return onSnapshot(projectsCol(), (snap) => {
    cb(
      snap.docs.map((d) => {
        const data = d.data();
        return {
          projectId: d.id,
          slug: data.slug ?? d.id,
          name: data.name ?? "",
          description: data.description ?? "",
          ownerUid: data.ownerUid ?? "",
        };
      })
    );
  });
}

// ---------------------------------------------------------------------------
// Writes — through the Functions API (one shared backend implementation)
// ---------------------------------------------------------------------------

/** Create a project (backend mints the stable id + unique slug). Returns its id. */
export async function createProject(name: string, description = ""): Promise<string> {
  const project = await (await getApiClient()).createProject(name.trim(), description.trim());
  return project.projectId;
}

/** Rename a project; the stable projectId (and every binding) is unchanged. */
export async function renameProject(projectId: string, name: string): Promise<void> {
  await (await getApiClient()).updateProject(projectId, { name: name.trim() });
}

/** Save a paper to the library (backend resolves its metadata, then saves). */
export async function saveToLibrary(paper: PaperMetadata): Promise<void> {
  await (await getApiClient()).saveToLibrary(paper.source);
}

/** File a paper into a project. Ensures it's saved (resolved) first, then files. */
export async function addPaperToProject(
  projectId: string,
  paper: PaperMetadata
): Promise<void> {
  const client = await getApiClient();
  await client.saveToLibrary(paper.source);
  await client.addPaperToProject(projectId, paper.paperId);
}

/** Unfile a paper from one project (leaves it saved in the library). */
export async function removePaperFromProject(
  projectId: string,
  paperId: string
): Promise<void> {
  await (await getApiClient()).removePaperFromProject(projectId, paperId);
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
