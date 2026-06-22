// The same-origin API mounts the web calls. The Vite dev server proxies each to
// the Functions emulator (see vite.config.ts); in production Firebase Hosting
// serves them via the firebase.json `rewrites`.
//
// INVARIANT (enforced by prod-parity.test.ts): every mount here has a matching
// production rewrite, so a path that works under `pnpm dev` also works once
// deployed. The arXiv `/arxiv-api` dev proxy used to live alongside these with NO
// prod rewrite — in production it silently fell through to index.html, breaking
// search-by-id. The web now resolves papers through `/api/papers` instead, and
// this list is the single source of truth so dev and prod can't drift again.
//
// Adding a mount? Add a firebase.json Hosting rewrite for it too.
export const API_PROXY_MOUNTS = [
  { mount: "projects", fn: "projectsApi" },
  { mount: "papers", fn: "papersApi" },
  { mount: "device", fn: "deviceApi" },
  { mount: "library", fn: "libraryApi" },
] as const;
