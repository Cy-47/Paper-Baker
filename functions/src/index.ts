import { initializeApp } from "firebase-admin/app";
import { onRequest, type Request } from "firebase-functions/v2/https";
import type { Response } from "express";
import { handleDeviceRequest } from "./routes/device.js";
import { handleProjectsRequest } from "./routes/projects.js";
import { handlePapersRequest } from "./routes/papers.js";
import { handleLibraryRequest } from "./routes/library.js";
import { handleUsersRequest } from "./routes/users.js";

initializeApp();

// One API gateway behind the single Hosting rewrite `/api/** → api`. It dispatches
// on the first path segment to a route handler; each handler still strips its own
// `/api/<mount>` prefix (routePath() / the users handler), so they're unchanged.
//
// Why one function instead of one-per-route: the route list used to be duplicated
// across firebase.json rewrites AND the Vite dev proxy, in two config languages,
// and silently drifted (the arXiv path was dev-only; /api/me was prod-only). With
// a single `/api/**` rewrite and a single `/api` dev proxy there is no per-route
// list to keep in sync, so dev and prod routing can't diverge.
//
// invoker:"public" so Hosting (and the CLI, which also calls /api/*) can reach it
// unauthenticated; every handler enforces app-level auth itself.
const ROUTES: Record<string, (req: Request, res: Response) => Promise<void>> = {
  device: handleDeviceRequest,
  projects: handleProjectsRequest,
  papers: handlePapersRequest,
  library: handleLibraryRequest,
  // usersApi served both mounts; the handler routes "me" vs "users" internally.
  me: handleUsersRequest,
  users: handleUsersRequest,
};

export const api = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  // Behind the rewrite, Hosting passes the full path (e.g. "/api/papers/search"),
  // so the mount is the segment after "api". Same shape in dev (the Vite proxy
  // forwards /api/** to this function verbatim) — so dispatch is env-agnostic.
  const segments = (req.path || "/").split("/").filter(Boolean);
  const mount = segments[0] === "api" ? segments[1] : segments[0];
  const handler = mount ? ROUTES[mount] : undefined;
  if (!handler) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await handler(req, res);
});
