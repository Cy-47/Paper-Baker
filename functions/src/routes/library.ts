import { onRequest, type Request } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import type { Response } from "express";
import type { Source } from "@paper-baker/core";
import { requireAuth } from "../middleware/auth.js";
import { routePath } from "../lib/routePath.js";
import { resolveAndCachePaper } from "../lib/resolvePaper.js";
import { sendRateLimited } from "./papers.js";

const db = () => getFirestore();

/**
 * Library API — a user's saved papers (users/{uid}/savedPapers/{paperId}).
 *
 * savedPapers are THIN ({ paperId, savedAt }): metadata lives once in the global
 * papers/ cache. So saving first resolves the paper there, then writes the thin
 * record. This is the single backend write path for the library, shared by the
 * web and (later) the CLI.
 *
 * Routes:
 *   POST   /            { source }  — resolve metadata into papers/, then save
 *   DELETE /:paperId                — unsave + remove its project memberships
 *
 * Exported separately from the onRequest wrapper so integration tests can drive
 * it against the emulators with mock req/res.
 */
export async function handleLibraryRequest(
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

  const path = routePath(req.path, "/api/library");
  const segments = path.split("/").filter(Boolean);

  try {
    if (req.method === "POST" && segments.length === 0) {
      await handleSave(uid, req, res);
      return;
    }
    if (req.method === "DELETE" && segments.length >= 1) {
      const paperId = decodeURIComponent(segments.join("/"));
      await handleUnsave(uid, paperId, res);
      return;
    }
    res.status(404).json({ error: "Not found" });
  } catch (err: unknown) {
    if (sendRateLimited(res, err)) return;
    console.error("library API error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export const libraryApi = onRequest({ cors: true }, handleLibraryRequest);

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleSave(uid: string, req: Request, res: Response) {
  const { source } = req.body as { source?: Source };
  if (!source || typeof source.type !== "string" || typeof source.id !== "string") {
    res.status(400).json({ error: "Request body must include source: {type, id}" });
    return;
  }
  if (source.type !== "arxiv") {
    res.status(400).json({ error: `Unsupported source type: ${source.type}` });
    return;
  }

  // Ensure the metadata is cached in the global papers/ collection first.
  const resolved = await resolveAndCachePaper(source);
  if (!resolved) {
    res.status(404).json({ error: `Paper not found on arxiv: ${source.id}` });
    return;
  }
  const paperId = resolved.paper.paperId;

  // Then the thin per-user record. Don't clobber an existing savedAt on re-save.
  const ref = db().collection("users").doc(uid).collection("savedPapers").doc(paperId);
  const existing = await ref.get();
  const now = new Date().toISOString();
  if (!existing.exists) await ref.set({ paperId, savedAt: now });

  res.status(existing.exists ? 200 : 201).json({
    paperId,
    savedAt: (existing.data()?.savedAt as string | undefined) ?? now,
  });
}

async function handleUnsave(uid: string, paperId: string, res: Response) {
  // Unsaving also unfiles the paper from every project (a paper can't be in a
  // project without being saved — projectPaper ⊆ savedPapers). We iterate the
  // user's projects and delete the membership doc by id (no collectionGroup
  // index needed), decrementing each project's paperCount.
  const projects = await db().collection("users").doc(uid).collection("projects").get();
  const batch = db().batch();
  for (const project of projects.docs) {
    const memberRef = project.ref.collection("projectPapers").doc(paperId);
    const member = await memberRef.get();
    if (member.exists) {
      batch.delete(memberRef);
      batch.update(project.ref, {
        paperCount: FieldValue.increment(-1),
        updatedAt: new Date().toISOString(),
      });
    }
  }
  batch.delete(db().collection("users").doc(uid).collection("savedPapers").doc(paperId));
  await batch.commit();

  res.status(200).json({ deleted: true });
}
