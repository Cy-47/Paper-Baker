import type { Request } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  type CollectionReference,
  type DocumentSnapshot,
  type Query,
} from "firebase-admin/firestore";
import type { Response } from "express";
import type {
  Project,
  ProjectPaper,
  ProjectManifest,
  PaperMetadata,
} from "@paper-baker/core";
import {
  generateStableId,
  paperDocId,
  slugify,
  uniqueProjectId,
} from "@paper-baker/core";
import { requireAuth } from "../middleware/auth.js";
import { routePath } from "../lib/routePath.js";
import { resolveHandle } from "../lib/handles.js";

const db = () => getFirestore();

/** Projects are TOP-LEVEL and globally addressable: projects/{stableId}. */
const projectsCol = (): CollectionReference =>
  db().collection("projects");

/** A project the caller may act on (owner or, later, a shared member), or null. */
async function authorizedProject(
  uid: string,
  stableId: string,
): Promise<DocumentSnapshot | null> {
  const snap = await projectsCol().doc(stableId).get();
  if (!snap.exists) return null;
  const data = snap.data() as Project;
  if (!Array.isArray(data.memberUids) || !data.memberUids.includes(uid)) {
    return null;
  }
  return snap;
}

/**
 * Resolve a project by `handle/id` (cross-user) or by `id` alone (the caller's
 * own). Returns the snapshot only if the caller is a member, else null — so a
 * non-member can't tell "not found" from "not allowed".
 */
async function resolveByHandleId(
  callerUid: string,
  handle: string | null,
  id: string,
): Promise<DocumentSnapshot | null> {
  const ownerUid = handle === null ? callerUid : await resolveHandle(handle);
  if (!ownerUid) return null;
  const q = await projectsCol()
    .where("ownerUid", "==", ownerUid)
    .where("id", "==", id)
    .limit(1)
    .get();
  if (q.empty) return null;
  const snap = q.docs[0];
  const data = snap.data() as Project;
  return data.memberUids?.includes(callerUid) ? snap : null;
}

/**
 * Projects API — single onRequest handler with URL-based routing.
 *
 * Routes (all membership-gated; writes go through here, never client Firestore):
 *   POST   /                       — create (server-mints stableId + owner-unique id)
 *   GET    /                       — list projects the caller is a member of
 *   GET    /lookup/:id             — resolve the caller's own project by id
 *   GET    /lookup/:handle/:id     — resolve handle/id (another owner's, if shared)
 *   GET    /:stableId              — get a single project
 *   PATCH  /:stableId              — update (name re-derives the id; description)
 *   DELETE /:stableId              — delete the project and its projectPapers
 *   POST   /:stableId/papers       — file a paper into the project
 *   DELETE /:stableId/papers/:pid  — unfile a paper
 *   GET    /:stableId/manifest     — full manifest (project + papers + metadata)
 *
 * Exported separately from the onRequest wrapper so integration tests can drive
 * it directly against the Firestore emulator with mock req/res.
 */
export async function handleProjectsRequest(
  req: Request,
  res: Response,
): Promise<void> {
  let uid: string;
  try {
    uid = await requireAuth(req);
  } catch (err: unknown) {
    const e = err as { status: number; message: string };
    res.status(e.status).json({ error: e.message });
    return;
  }

  const path = routePath(req.path, "/api/projects");
  const segments = path.split("/").filter(Boolean).map((s) => decodeURIComponent(s));

  try {
    if (req.method === "POST" && segments.length === 0) {
      await handleCreateProject(uid, req, res);
      return;
    }
    if (req.method === "GET" && segments.length === 0) {
      await handleListProjects(uid, res);
      return;
    }

    // Handle/id resolution. /lookup/:id (own) or /lookup/:handle/:id (cross-user).
    if (req.method === "GET" && segments[0] === "lookup") {
      if (segments.length === 2) {
        await handleResolve(uid, null, segments[1], res);
        return;
      }
      if (segments.length === 3) {
        await handleResolve(uid, segments[1], segments[2], res);
        return;
      }
    }

    if (segments.length >= 1) {
      const stableId = segments[0];

      if (req.method === "GET" && segments.length === 2 && segments[1] === "manifest") {
        await handleGetManifest(uid, stableId, res);
        return;
      }
      if (req.method === "POST" && segments.length === 2 && segments[1] === "papers") {
        await handleAddPaper(uid, stableId, req, res);
        return;
      }
      if (req.method === "DELETE" && segments.length >= 3 && segments[1] === "papers") {
        const paperId = segments.slice(2).join("/");
        await handleRemovePaper(uid, stableId, paperId, res);
        return;
      }
      if (req.method === "GET" && segments.length === 1) {
        await handleGetProject(uid, stableId, res);
        return;
      }
      if (req.method === "PATCH" && segments.length === 1) {
        await handleUpdateProject(uid, stableId, req, res);
        return;
      }
      if (req.method === "DELETE" && segments.length === 1) {
        await handleDeleteProject(uid, stableId, res);
        return;
      }
    }

    res.status(404).json({ error: "Not found" });
  } catch (err: unknown) {
    console.error("projects API error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** The owner's handle, denormalized onto the project for display. "" if unset. */
async function ownerHandleOf(uid: string): Promise<string> {
  const snap = await db().collection("users").doc(uid).get();
  return (snap.data()?.handle as string | undefined) ?? "";
}

/** Collect the user-facing ids already used by this owner (for uniqueness). */
function takenIds(q: FirebaseFirestore.QuerySnapshot, exceptStableId?: string): Set<string> {
  const ids = new Set<string>();
  q.forEach((d) => {
    if (exceptStableId && d.id === exceptStableId) return;
    const v = (d.data() as Project).id;
    if (v) ids.add(v);
  });
  return ids;
}

async function handleCreateProject(uid: string, req: Request, res: Response) {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const now = new Date().toISOString();
  const ownerHandle = await ownerHandleOf(uid);
  const ownerProjects: Query = projectsCol().where("ownerUid", "==", uid);

  // One transaction: read the owner's existing ids (for a unique user-facing id),
  // mint a globally-unique stableId, then write.
  const project = await db().runTransaction(async (tx) => {
    const mine = await tx.get(ownerProjects);
    const ids = takenIds(mine);

    let stableId = generateStableId();
    for (let guard = 0; guard < 50; guard++) {
      const existing = await tx.get(projectsCol().doc(stableId));
      if (!existing.exists) break;
      stableId = generateStableId();
    }

    const id = uniqueProjectId(slugify(name) || stableId, ids);
    const p: Project = {
      stableId,
      id,
      name,
      description: description ?? "",
      ownerUid: uid,
      ownerHandle,
      memberUids: [uid],
      visibility: "private",
      createdAt: now,
      updatedAt: now,
      paperCount: 0,
    };
    tx.set(projectsCol().doc(stableId), p);
    return p;
  });

  res.status(201).json(project);
}

async function handleListProjects(uid: string, res: Response) {
  const snapshot = await projectsCol().where("memberUids", "array-contains", uid).get();
  const projects = snapshot.docs.map((doc) => doc.data() as Project);
  res.status(200).json(projects);
}

async function handleResolve(
  uid: string,
  handle: string | null,
  id: string,
  res: Response,
) {
  const snap = await resolveByHandleId(uid, handle, id);
  if (!snap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(200).json(snap.data() as Project);
}

async function handleGetProject(uid: string, stableId: string, res: Response) {
  const snap = await authorizedProject(uid, stableId);
  if (!snap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(200).json(snap.data() as Project);
}

async function handleUpdateProject(
  uid: string,
  stableId: string,
  req: Request,
  res: Response,
) {
  const { name, description } = req.body as { name?: string; description?: string };

  const updated = await db().runTransaction(async (tx) => {
    const ref = projectsCol().doc(stableId);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const project = snap.data() as Project;
    if (!project.memberUids?.includes(uid)) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (description !== undefined) updates.description = description;

    // Renaming re-derives the id, staying unique among the OWNER's other projects.
    if (typeof name === "string" && name.length > 0 && name !== project.name) {
      updates.name = name;
      const mine = await tx.get(projectsCol().where("ownerUid", "==", project.ownerUid));
      const ids = takenIds(mine, stableId);
      updates.id = uniqueProjectId(slugify(name) || stableId, ids);
    }

    tx.update(ref, updates);
    return { ...project, ...updates };
  });

  if (!updated) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(200).json(updated);
}

async function handleDeleteProject(uid: string, stableId: string, res: Response) {
  const snap = await authorizedProject(uid, stableId);
  if (!snap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const membershipSnapshot = await snap.ref.collection("projectPapers").get();
  const batch = db().batch();
  for (const memberDoc of membershipSnapshot.docs) batch.delete(memberDoc.ref);
  batch.delete(snap.ref);
  await batch.commit();

  res.status(200).json({ deleted: true });
}

async function handleAddPaper(
  uid: string,
  stableId: string,
  req: Request,
  res: Response,
) {
  const { paperId } = req.body as { paperId?: string };
  if (!paperId || typeof paperId !== "string") {
    res.status(400).json({ error: "paperId is required" });
    return;
  }

  const projectSnap = await authorizedProject(uid, stableId);
  if (!projectSnap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const project = projectSnap.data() as Project;

  // Verify the paper exists in the global papers collection.
  const paperDoc = await db().collection("papers").doc(paperDocId(paperId)).get();
  if (!paperDoc.exists) {
    res.status(404).json({ error: "Paper not found. Resolve it first via the papers API." });
    return;
  }

  const memberRef = projectSnap.ref.collection("projectPapers").doc(paperDocId(paperId));
  const existing = await memberRef.get();
  if (existing.exists) {
    res.status(409).json({ error: "Paper already in project" });
    return;
  }

  const now = new Date().toISOString();
  // memberUids mirrors the project so the collectionGroup read authorizes on it.
  const projectPaper: ProjectPaper = {
    paperId,
    projectStableId: stableId,
    memberUids: project.memberUids,
    addedAt: now,
  };

  // Every projectPaper implies a savedPapers entry for the acting user — filing a
  // paper also saves it to their library. Don't clobber an existing savedAt.
  const savedRef = db().collection("users").doc(uid).collection("savedPapers").doc(paperDocId(paperId));
  const savedSnap = await savedRef.get();

  const batch = db().batch();
  batch.set(memberRef, projectPaper);
  if (!savedSnap.exists) batch.set(savedRef, { paperId, savedAt: now });
  batch.update(projectSnap.ref, {
    paperCount: FieldValue.increment(1),
    updatedAt: now,
  });
  await batch.commit();

  res.status(201).json(projectPaper);
}

async function handleRemovePaper(
  uid: string,
  stableId: string,
  paperId: string,
  res: Response,
) {
  const projectSnap = await authorizedProject(uid, stableId);
  if (!projectSnap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const memberRef = projectSnap.ref.collection("projectPapers").doc(paperDocId(paperId));
  const memberDoc = await memberRef.get();
  if (!memberDoc.exists) {
    res.status(404).json({ error: "Paper not in project" });
    return;
  }

  const now = new Date().toISOString();
  const batch = db().batch();
  batch.delete(memberRef);
  batch.update(projectSnap.ref, {
    paperCount: FieldValue.increment(-1),
    updatedAt: now,
  });
  await batch.commit();

  res.status(200).json({ deleted: true });
}

async function handleGetManifest(uid: string, stableId: string, res: Response) {
  const projectSnap = await authorizedProject(uid, stableId);
  if (!projectSnap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const project = projectSnap.data() as Project;

  const membershipSnapshot = await projectSnap.ref.collection("projectPapers").get();
  const projectPapers = membershipSnapshot.docs.map((doc) => doc.data() as ProjectPaper);

  const paperIds = projectPapers.map((pp) => pp.paperId);
  const paperDocs = await Promise.all(
    paperIds.map((id) => db().collection("papers").doc(paperDocId(id)).get()),
  );

  // Keyed by the sanitized doc id (doc.id), which is what paperDocId(pp.paperId)
  // produces — so the join matches for classic ids too, not just new-style ones.
  const papersMap = new Map<string, PaperMetadata>();
  for (const doc of paperDocs) {
    if (doc.exists) papersMap.set(doc.id, doc.data() as PaperMetadata);
  }

  const papers = projectPapers
    .filter((pp) => papersMap.has(paperDocId(pp.paperId)))
    .map((pp) => ({ ...papersMap.get(paperDocId(pp.paperId))!, projectPaper: pp }));

  const manifest: ProjectManifest = {
    stableId: project.stableId,
    id: project.id,
    name: project.name,
    ownerHandle: project.ownerHandle,
    papers,
  };

  res.status(200).json(manifest);
}
