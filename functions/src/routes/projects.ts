import { onRequest, type Request } from "firebase-functions/v2/https";
import {
  getFirestore,
  FieldValue,
  type CollectionReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import type { Response } from "express";
import type {
  Project,
  ProjectPaper,
  ProjectManifest,
  PaperMetadata,
} from "@paper-baker/core";
import {
  generateProjectId,
  isValidProjectId,
  slugify,
  uniqueSlug,
} from "@paper-baker/core";
import { requireAuth } from "../middleware/auth.js";
import { routePath } from "../lib/routePath.js";

const db = () => getFirestore();

/** A user's projects live under their own document: users/{uid}/projects/{id}. */
const projectsCol = (uid: string): CollectionReference =>
  db().collection("users").doc(uid).collection("projects");

/**
 * Resolve a project by its stable id OR its slug (id wins when both match).
 * Returns the snapshot, or null if neither hits.
 */
async function resolveProject(
  uid: string,
  idOrSlug: string,
): Promise<DocumentSnapshot | null> {
  const byId = await projectsCol(uid).doc(idOrSlug).get();
  if (byId.exists) return byId;
  const bySlug = await projectsCol(uid)
    .where("slug", "==", idOrSlug)
    .limit(1)
    .get();
  return bySlug.empty ? null : bySlug.docs[0];
}

/**
 * Projects API — single onRequest handler with URL-based routing.
 *
 * All routes are implicitly scoped to the authenticated user's
 * users/{uid}/projects subtree. `:id` accepts the stable id or the slug.
 *
 * Routes:
 *   POST   /                    — create project (mints stable id + unique slug)
 *   GET    /                    — list the caller's projects
 *   GET    /:id                 — get single project (by id or slug)
 *   PUT    /:id                 — idempotent create-with-id (CLI publish/sync)
 *   PATCH  /:id                 — update project (name re-slugs; description)
 *   DELETE /:id                 — delete project and its items subcollection
 *   POST   /:id/papers          — add paper to project
 *   DELETE /:id/papers/:paperId — remove paper from project
 *   GET    /:id/manifest        — full project manifest (project + items + metadata)
 */
/**
 * The projects API request handler. Exported (separately from the onRequest
 * wrapper) so integration tests can drive it directly against the Firestore
 * emulator with mock req/res, no HTTP layer needed.
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
  const segments = path.split("/").filter(Boolean);

  try {
    // POST / — create project
    if (req.method === "POST" && segments.length === 0) {
      await handleCreateProject(uid, req, res);
      return;
    }

    // GET / — list projects
    if (req.method === "GET" && segments.length === 0) {
      await handleListProjects(uid, res);
      return;
    }

    // Routes with /:id
    if (segments.length >= 1) {
      const idOrSlug = decodeURIComponent(segments[0]);

      // GET /:id/manifest
      if (
        req.method === "GET" &&
        segments.length === 2 &&
        segments[1] === "manifest"
      ) {
        await handleGetManifest(uid, idOrSlug, res);
        return;
      }

      // POST /:id/papers — add paper
      if (
        req.method === "POST" &&
        segments.length === 2 &&
        segments[1] === "papers"
      ) {
        await handleAddPaper(uid, idOrSlug, req, res);
        return;
      }

      // DELETE /:id/papers/:paperId — remove paper
      if (
        req.method === "DELETE" &&
        segments.length >= 3 &&
        segments[1] === "papers"
      ) {
        const paperId = decodeURIComponent(segments.slice(2).join("/"));
        await handleRemovePaper(uid, idOrSlug, paperId, res);
        return;
      }

      // GET /:id — get project
      if (req.method === "GET" && segments.length === 1) {
        await handleGetProject(uid, idOrSlug, res);
        return;
      }

      // PUT /:id — idempotent create-with-id (CLI publish/sync). Unlike POST,
      // the client supplies the stable id, so the same project can be created
      // under multiple accounts (each scoped to its own users/{uid} subtree).
      if (req.method === "PUT" && segments.length === 1) {
        await handleUpsertProject(uid, idOrSlug, req, res);
        return;
      }

      // PATCH /:id — update project
      if (req.method === "PATCH" && segments.length === 1) {
        await handleUpdateProject(uid, idOrSlug, req, res);
        return;
      }

      // DELETE /:id — delete project
      if (req.method === "DELETE" && segments.length === 1) {
        await handleDeleteProject(uid, idOrSlug, res);
        return;
      }
    }

    res.status(404).json({ error: "Not found" });
  } catch (err: unknown) {
    console.error("projects API error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

// invoker: "public" so Hosting can reach it unauthenticated; the handler
// enforces app-level auth via requireAuth.
export const projectsApi = onRequest({ cors: true, invoker: "public" }, handleProjectsRequest);

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleCreateProject(uid: string, req: Request, res: Response) {
  const { name, description } = req.body as {
    name?: string;
    description?: string;
  };

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }

  const now = new Date().toISOString();
  const col = projectsCol(uid);

  // One transaction: read the user's existing ids+slugs, then mint a unique id
  // and slug and write. The collection is tiny (<~20), so reading it whole is
  // cheap and makes uniqueness race-free.
  const project = await db().runTransaction(async (tx) => {
    const snap = await tx.get(col);
    const slugs = new Set<string>();
    const ids = new Set<string>();
    snap.forEach((d) => {
      ids.add(d.id);
      const s = (d.data() as Project).slug;
      if (s) slugs.add(s);
    });

    const slug = uniqueSlug(slugify(name), slugs);
    let id = generateProjectId();
    for (let guard = 0; ids.has(id) && guard < 50; guard++) {
      id = generateProjectId();
    }

    const p: Project = {
      projectId: id,
      slug,
      name,
      description: description ?? "",
      ownerUid: uid,
      createdAt: now,
      updatedAt: now,
      paperCount: 0,
    };
    tx.set(col.doc(id), p);
    return p;
  });

  res.status(201).json(project);
}

async function handleUpsertProject(
  uid: string,
  id: string,
  req: Request,
  res: Response,
) {
  const { name, description } = req.body as {
    name?: string;
    description?: string;
  };

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "name is required" });
    return;
  }
  // The client owns the id, so validate its shape rather than minting one. A
  // slug would also resolve a project for GET, but creating one requires a real
  // stable id — reject anything else so we never write a slug-shaped doc id.
  if (!isValidProjectId(id)) {
    res.status(400).json({ error: "invalid project id" });
    return;
  }

  const now = new Date().toISOString();
  const col = projectsCol(uid);

  // Idempotent: if the id already exists under this account, return it untouched
  // (a re-sync). Otherwise mint a unique slug and create it. Reading the whole
  // (tiny) collection in the transaction keeps slug uniqueness race-free.
  const { project, created } = await db().runTransaction(async (tx) => {
    const ref = col.doc(id);
    const existing = await tx.get(ref);
    if (existing.exists) {
      return { project: existing.data() as Project, created: false };
    }

    const snap = await tx.get(col);
    const slugs = new Set<string>();
    snap.forEach((d) => {
      const s = (d.data() as Project).slug;
      if (s) slugs.add(s);
    });

    const p: Project = {
      projectId: id,
      slug: uniqueSlug(slugify(name), slugs),
      name,
      description: description ?? "",
      ownerUid: uid,
      createdAt: now,
      updatedAt: now,
      paperCount: 0,
    };
    tx.set(ref, p);
    return { project: p, created: true };
  });

  res.status(created ? 201 : 200).json(project);
}

async function handleListProjects(uid: string, res: Response) {
  const snapshot = await projectsCol(uid).get();
  const projects = snapshot.docs.map((doc) => doc.data() as Project);
  res.status(200).json(projects);
}

async function handleGetProject(
  uid: string,
  idOrSlug: string,
  res: Response,
) {
  const snap = await resolveProject(uid, idOrSlug);
  if (!snap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  res.status(200).json(snap.data() as Project);
}

async function handleUpdateProject(
  uid: string,
  idOrSlug: string,
  req: Request,
  res: Response,
) {
  const { name, description } = req.body as {
    name?: string;
    description?: string;
  };
  const col = projectsCol(uid);

  const updated = await db().runTransaction(async (tx) => {
    // Resolve inside the transaction (by id, then slug).
    let ref = col.doc(idOrSlug);
    let snap = await tx.get(ref);
    if (!snap.exists) {
      const q = await tx.get(col.where("slug", "==", idOrSlug).limit(1));
      if (q.empty) return null;
      snap = q.docs[0];
      ref = snap.ref;
    }

    const project = snap.data() as Project;
    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (description !== undefined) updates.description = description;

    // Renaming re-slugs, staying unique among the user's *other* projects.
    if (typeof name === "string" && name.length > 0 && name !== project.name) {
      updates.name = name;
      const all = await tx.get(col);
      const slugs = new Set<string>();
      all.forEach((d) => {
        if (d.id === ref.id) return;
        const s = (d.data() as Project).slug;
        if (s) slugs.add(s);
      });
      updates.slug = uniqueSlug(slugify(name), slugs);
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

async function handleDeleteProject(
  uid: string,
  idOrSlug: string,
  res: Response,
) {
  const snap = await resolveProject(uid, idOrSlug);
  if (!snap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Delete all membership docs in the subcollection, then the project doc.
  const membershipSnapshot = await snap.ref.collection("projectPapers").get();
  const batch = db().batch();
  for (const memberDoc of membershipSnapshot.docs) {
    batch.delete(memberDoc.ref);
  }
  batch.delete(snap.ref);
  await batch.commit();

  res.status(200).json({ deleted: true });
}

async function handleAddPaper(
  uid: string,
  idOrSlug: string,
  req: Request,
  res: Response,
) {
  const { paperId } = req.body as { paperId?: string };

  if (!paperId || typeof paperId !== "string") {
    res.status(400).json({ error: "paperId is required" });
    return;
  }

  const projectSnap = await resolveProject(uid, idOrSlug);
  if (!projectSnap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Verify the paper exists in the global papers collection
  const paperDoc = await db().collection("papers").doc(paperId).get();
  if (!paperDoc.exists) {
    res
      .status(404)
      .json({ error: "Paper not found. Resolve it first via the papers API." });
    return;
  }

  const memberRef = projectSnap.ref.collection("projectPapers").doc(paperId);
  const existing = await memberRef.get();
  if (existing.exists) {
    res.status(409).json({ error: "Paper already in project" });
    return;
  }

  const now = new Date().toISOString();
  // ownerUid is denormalized so web collectionGroup reads can scope to the user.
  const projectPaper: ProjectPaper = {
    paperId,
    projectId: projectSnap.id,
    ownerUid: uid,
    addedAt: now,
  };

  // Every projectPaper implies a savedPapers entry — filing a paper also saves
  // it to the user's library (matching the web). The thin record carries only
  // the id + savedAt; metadata stays in the global papers/ cache. Don't clobber
  // an existing savedAt on re-filing.
  const savedRef = db()
    .collection("users")
    .doc(uid)
    .collection("savedPapers")
    .doc(paperId);
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
  idOrSlug: string,
  paperId: string,
  res: Response,
) {
  const projectSnap = await resolveProject(uid, idOrSlug);
  if (!projectSnap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const memberRef = projectSnap.ref.collection("projectPapers").doc(paperId);
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

async function handleGetManifest(
  uid: string,
  idOrSlug: string,
  res: Response,
) {
  const projectSnap = await resolveProject(uid, idOrSlug);
  if (!projectSnap) {
    res.status(404).json({ error: "Project not found" });
    return;
  }
  const project = projectSnap.data() as Project;

  // Fetch all membership docs
  const membershipSnapshot = await projectSnap.ref
    .collection("projectPapers")
    .get();
  const projectPapers = membershipSnapshot.docs.map(
    (doc) => doc.data() as ProjectPaper,
  );

  // Fetch all referenced papers in parallel
  const paperIds = projectPapers.map((pp) => pp.paperId);
  const paperDocs = await Promise.all(
    paperIds.map((id) => db().collection("papers").doc(id).get()),
  );

  const papersMap = new Map<string, PaperMetadata>();
  for (const doc of paperDocs) {
    if (doc.exists) {
      papersMap.set(doc.id, doc.data() as PaperMetadata);
    }
  }

  // Join each membership with its paper metadata
  const papers = projectPapers
    .filter((pp) => papersMap.has(pp.paperId))
    .map((pp) => ({
      ...papersMap.get(pp.paperId)!,
      projectPaper: pp,
    }));

  const manifest: ProjectManifest = {
    projectId: project.projectId,
    slug: project.slug,
    name: project.name,
    papers,
  };

  res.status(200).json(manifest);
}
