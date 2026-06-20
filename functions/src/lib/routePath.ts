/**
 * Normalize the routed path for a function reachable two ways:
 *   - directly (req.path is already relative, e.g. "/search")
 *   - behind a Firebase Hosting rewrite, which passes the FULL path including
 *     the mount prefix (e.g. "/api/papers/search")
 *
 * Strips `mount` when present so the route matching downstream is identical in
 * both cases. Returns "/" for the mount root.
 */
export function routePath(reqPath: string | undefined, mount: string): string {
  const p = reqPath || "/";
  if (p === mount) return "/";
  if (p.startsWith(`${mount}/`)) return p.slice(mount.length) || "/";
  return p;
}
