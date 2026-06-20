# Paper Baker — Design

A system for managing research papers, organized by **projects**, with three clients
over one shared core:

1. **Website** — read PDFs, manage projects, browse metadata (React, HeroUI, Tailwind, Firebase).
2. **CLI** — agent-facing; downloads arxiv tex sources into research codebases so AI agents
   can read context and write papers.
3. **MCP / Claude skill** *(future)* — a simpler concatenated-context form for models.

Designed around arxiv, structured so other APIs and manual PDF+OCR drop in as plugins.

> **Scope (v1):** single-user. Each project has one owner and lives under that owner
> (`users/{uid}/projects/{id}`). Sharing is deferred; per-user scoping keeps a future share
> feature additive (a membership index) rather than a carried-but-unused field.

---

## 1. Architectural backbone

The central decision: **the backend owns paper metadata as the source of truth**, a shared
**`core`** library encodes all domain logic, and a **provider interface** makes arxiv the
first of many sources. The three clients are thin.

```
        ┌─────────┐   ┌─────────┐   ┌──────────────┐
        │  Web    │   │  CLI    │   │ MCP (future) │
        └────┬────┘   └────┬────┘   └──────┬───────┘
             │   api-client (shared typed client)
             └────────────┬───────────────┘
                          ▼
              ┌───────────────────────────┐
              │  Cloud Functions (the API) │
              │  - metadata (Firestore)    │
              │  - source cache (Storage)  │
              └───────┬───────────────────-┘
                ┌─────┴───────┐
                ▼             ▼
          Firestore
          (metadata,
           projects)
```

### Source-fetch strategy

**v1: CLI downloads directly from arxiv.** The backend handles metadata only (Firestore).
Source files (tex tarballs, PDFs) are fetched by the client and stored locally. No Cloud
Storage needed in v1 — keeps the backend simple and free-tier friendly.

**v2 (future): server-side cache.** When multiple users exist, add a backend-authored cache:
CLI checks server first → cache hit = fast download; cache miss = CLI downloads from arxiv
directly, backend independently enqueues its own fetch to populate the cache for next time.
The backend **always authors its own cache from arxiv** — never accepts user uploads — so
there's no trust/verification problem. See `DESIGN-FUTURE.md` for details.

**Version pinning:** arxiv papers have versions (v1, v2…). The CLI tracks the version in
`papers.json`. When a new version is detected on sync, local sources are re-downloaded.

---

## 2. Monorepo layout (pnpm workspace)

```
paper-baker/
├── packages/
│   ├── core/          # pure domain logic, NO I/O:
│   │                  #   - PaperMetadata normalized schema + types
│   │                  #   - citation-key generation, BibTeX rendering
│   │                  #   - tex-bundle parsing (find main file, strip preamble/comments)
│   │                  #   - buildConcatenatedContext() for MCP/skill
│   ├── providers/     # PaperProvider interface + ArxivProvider
│   │                  #   (future: SemanticScholarProvider, DoiProvider, ManualProvider)
│   └── api-client/    # typed wrapper over the Cloud Functions API; auth handling
├── apps/
│   ├── web/           # React + HeroUI + Tailwind + Firebase SDK
│   └── cli/           # the agent-facing CLI (commander/yargs)
├── functions/         # Firebase Cloud Functions = backend API + fetch workers
├── firebase/          # firestore.rules, storage.rules, firestore.indexes.json
└── pnpm-workspace.yaml
```

`core`, `providers`, `api-client` are imported by **all** clients. Adding a new paper source =
implement one interface in `providers`; nothing else changes.

---

## 3. Domain model

### 3.1 Normalized `PaperMetadata` (in `core`)

Source-independent. arxiv is one producer of this shape; future providers produce the same.

```ts
type Source =
  | { type: "arxiv"; id: string }            // id = "2301.12345"
  | { type: "doi";   id: string }
  | { type: "manual"; id: string };          // uploaded PDF, OCR'd

interface PaperMetadata {
  paperId: string;          // canonical key: `${source.type}:${source.id}`, e.g. "arxiv:2301.12345"
  source: Source;
  title: string;
  abstract: string;
  authors: { name: string; affiliation?: string }[];
  publishedAt: string;      // ISO 8601
  updatedAt?: string;
  categories: string[];     // arxiv categories / subject tags
  venue?: string;           // enrichment slot (see §6) — often absent from arxiv
  doi?: string;
  links: { pdf?: string; abs?: string; source?: string };
  sourceStatus: "available" | "pdf_only" | "pending" | "failed";
}
```

### 3.2 Firestore collections

```
users/{uid}
    { displayName, email, settings, createdAt }

cliSessions/{connectionId}              ← CLI auth, backend-only (see §5.1)
    { connectionId, uid, tokenHash, createdAt }   ← SHA-256 of the access token; never the token

users/{uid}/clis/{connectionId}         ← user-facing connected-CLI registry (web "CLI" tab)
    { connectionId, uid, status: "active"|"revoked", device, createdAt, lastSeenAt }
    (status is a defense-in-depth gate in requireAuth; the only user action is Delete)

users/{uid}/cliEvents/{eventId}         ← append-only CLI activity log (shown below the list)
    { type: "connected"|"deleted", connectionId, device, at }  ← survives deletion

papers/{paperId}                        ← GLOBAL, deduplicated, shared by all users
    PaperMetadata  (public arxiv metadata — the SINGLE source of paper metadata;
                    safe to share; dedupes tex cache. Backend-written on resolve.)

users/{uid}/savedPapers/{paperId}       ← per-user library: a THIN record, no metadata
    { paperId, savedAt }   ← id + user-specific data only; metadata lives in papers/{id}

users/{uid}/projects/{projectId}        ← per-user; scoped under the owner
    { projectId, slug, name, description, ownerUid,
      createdAt, updatedAt, paperCount }

users/{uid}/projects/{projectId}/projectPapers/{paperId}   ← project ↔ paper membership
    { paperId, projectId, ownerUid, addedAt }   ← ownerUid denormalized for collectionGroup
```

**Project identity: stable id + renamable slug**
- Projects are **scoped per-user** (`users/{uid}/projects/{id}`). Most users have well under
  ~20 projects, so an id only needs to be unique within one user's projects.
- `projectId` is a **stable 4-char id** (`core.generateProjectId()`) — the durable key. It is
  *plumbing*: it appears only in the CLI's `paperbaker/config.json` (like a `.git` ref) and as
  the Firestore doc id. Users never type it.
- `slug` is derived from the name (`core.slugify(name)`), unique within the user, and is the
  **only handle users see/type** — in `pb project` commands, URLs, and error messages.
- This decoupling is what makes **rename cheap and binding-safe**: renaming updates `name` +
  `slug` in a single field write; the stable `projectId` never changes, so every CLI binding
  keeps working across renames with no migration. (The alternative — slug *as* the id — would
  turn every rename into a doc-id migration that breaks bound `config.json` files.)
- The stable id buys exactly one thing: silent rename-survival of bindings. That's why it's
  worth carrying a second (hidden) identifier.

**Metadata lives in exactly one place**
- `papers/{id}` is **global, deduped, and the only store of paper metadata**: tex/PDF and the
  normalized `PaperMetadata` for a given arxiv id are stored once; everything else references it
  by `paperId`. Public metadata, so no privacy concern. It is **backend-only writable** (clients
  can't poison the shared cache) and populated on **resolve**.
- `savedPapers/{id}` and `projectPapers/{id}` are **thin** — they carry only the `paperId` and
  user-/membership-specific data, never duplicated metadata. The Library/Home/Project read paths
  **join** each id against `papers/{id}` (see web `useData` / CLI manifest).
- Because clients can't write `papers/`, the **web resolves through the backend on save**
  (`POST /papers` with a Firebase ID token → populates `papers/{id}`), then writes the thin
  `savedPapers` record. The CLI already resolves before filing. So every saved/filed paper has a
  `papers/{id}` entry to join against.
- **`projectPaper ⊆ savedPapers`**: filing a paper into a project also writes its `savedPapers`
  record (both surfaces), so a filed paper always appears in the library, never as an orphan
  membership.
- **Sharing (`memberUids`) is deferred, not designed-in.** Per-user scoping makes a future
  share feature additive work (a separate membership index / collection-group query), not a
  field that's silently carried unused. v1 has no sharing.

### 3.3 Security rules (read-your-own, write backend-only)

The web reads its data via real-time Firestore snapshots but performs **every mutation through
the Functions API** (Admin SDK, which bypasses rules) — the same path the CLI uses. So the
backend is the **sole writer** of user data: one implementation of the domain rules, and no way
for a client to write an inconsistent or forged document. Rules therefore allow owner *reads* and
deny *all* client writes:

- `papers/*` — read: any authenticated user; write: `false` (backend only; anti-poisoning).
- `users/{uid}/savedPapers/**` — read: owner; write: `false`. Thin records; metadata lives in `papers/`.
- `users/{uid}/projects/**` and nested `projectPapers/{id}` — read: owner; write: `false`.
- `{path=**}/projectPapers/{id}` — collectionGroup read authorized on `ownerUid == uid` (the query
  must filter `where("ownerUid","==",uid)`); lets the web read every membership at once.
- `users/{uid}/clis/**` — read: owner; write: `false`. Deletes go through the device API.
- `users/{uid}/cliEvents/**` — read: owner; write: `false`. Append-only log; the backend writes
  one entry per connect/delete (the device API), so deletion history survives the connection.
- `cliSessions/*`, `deviceCodes/*` — backend only (read/write `false`); hold the access-token
  hashes and login codes, never client-readable.

---

## 4. Backend API (Cloud Functions)

HTTPS/callable functions. Auth (`requireAuth`, dual-path): an **opaque CLI access token**
(`pbk.…`, resolved via `cliSessions` + the `users/{uid}/clis` revocation status) **or** a
**Firebase ID token** (the web app's `/device/approve` call, and headless `$PAPERBAKER_TOKEN`)
→ resolved to `uid`.

The device-link auth endpoints (`POST /device/code`, `/device/approve`, `/device/token`)
implement the login flow in §5.1; everything below requires a resolved `uid`.

Both the web and the CLI mutate exclusively through these endpoints; the web additionally reads
via Firestore snapshots (admin writes still fire those listeners, so the UI stays real-time).

| Endpoint | Purpose |
|---|---|
| `POST /papers` `{source}` | Resolve + cache `PaperMetadata` in the global `papers/` cache (idempotent). |
| `GET  /papers/:id` | Fetch cached `PaperMetadata`. |
| `GET  /papers/search?q=&source=` | Search via provider (default arxiv). Results not auto-cached until added. |
| `POST /library` `{source}` | Save a paper: resolve into `papers/`, then write the thin `savedPapers` record. |
| `DELETE /library/:paperId` | Unsave a paper; also unfiles it from every project (cascade). |
| `POST /projects` / `GET /projects` / `GET /projects/:id` / `PATCH` / `DELETE` | Project CRUD (scoped to `users/{uid}`). `POST` mints a stable 4-char id + unique slug; `PATCH {name}` re-slugs. `:id` accepts the stable id **or** the slug. |
| `POST /projects/:id/papers` `{paperId}` | File a paper into a project (also ensures it's in `savedPapers`). |
| `DELETE /projects/:id/papers/:paperId` | Unfile from a project (leaves it saved). |
| `GET  /projects/:id/manifest` | Full project state for CLI sync: papers + metadata + source status. |
| `DELETE /device/connections/:id` | Web "CLI" tab: delete a connected CLI (forgets it, rejects its next call, logs a `deleted` event). |

### Tex/PDF handling (v1)

The CLI downloads source tarballs directly from arxiv's `https://arxiv.org/e-print/{id}`
endpoint. Extraction (find `.tex/.bib/.bbl` + figures, identify main file via `\documentclass`)
happens client-side. Papers without source on arxiv get `sourceStatus: "pdf_only"`.

The web app links to arxiv's PDF URL directly, or uses a lightweight CORS proxy function
if needed for the embedded viewer.

---

## 5. CLI design (agent-facing)

Mental model = **git**: a global identity + a per-directory project binding.

### 5.1 Auth (global)

```
paperbaker login      # device-link flow: prints a URL + code to approve in any browser
paperbaker whoami
paperbaker logout
```
`login` runs the device-link flow (RFC 8628): the CLI prints a verification URL + short code;
the user approves it on the web `/device` page while signed in (any Firebase provider). On
approval the backend mints a single **opaque access token** — `pbk.<connectionId>.<secret>` —
and returns it once.

- **Not a Firebase identity.** The token resolves only through the Cloud Functions API
  (`requireAuth`), never Firestore directly. That's the whole point: it gives the CLI exactly
  the reach it needs (the API) and nothing more, so a connection can be revoked **completely
  and per-CLI** from the web "CLI" tab — there's no second surface for a revoked token to slip
  through. (Firebase has no native per-session revocation; a Firebase credential would also
  reach Firestore under the uid-scoped rules, which the rules can't gate on a session.)
- **Storage.** Stored at `~/.config/paperbaker/config.json` (XDG, owner-only `0600`) as
  `accessToken`; sent verbatim as the bearer. The backend persists only the token's SHA-256 in
  the backend-only `cliSessions` doc; `users/{uid}/clis` holds the display metadata
  (hostname/OS, captured at login) + revocation status.
- **Headless / CI.** Set `$PAPERBAKER_TOKEN` to an access token instead of running `login`;
  it takes precedence over the stored token and never touches disk.
- **Revocation.** Deleting a connection in the web "CLI" tab makes that token's
  next API call fail. It is the *only* per-CLI control; `revokeRefreshTokens` (Firebase) is a
  separate, account-wide "sign out everywhere" lever and is not per-device.

### 5.2 Project binding (per-dir), like `git`

A directory is *bound* to a server project by `paperbaker/config.json`. Identity is split:
`name` is always present; `stableId` is the durable server key, **minted on the first `pb sync`**
— its presence is the binding (set ⇔ synced, absent ⇔ offline, no `local-…` sentinel); `slug` is
the server's renamable handle. Because `stableId` is client-owned it stays constant across accounts,
so the binding survives renames *and* re-homing. Binding happens via the `pb project` subcommand
(§5.2.1), which replaces the old single `init`.

```
AGENTS.md                # root brief: a short, marked block pointing here  ← COMMIT
paperbaker/              # ONE visible dir — everything is searchable
├── config.json      # { name, stableId?, slug?, rootBrief? }   (stableId absent ⇒ offline)
├── papers.json      # lockfile: paper list + cached metadata        ← COMMIT
├── refs.bib         # generated BibTeX bibliography                  ← COMMIT
├── README.md        # generated guide: what's here, how to read it   ← COMMIT
└── sources/             # nested git repo (sealed); tex per paper, NOT in host history
    └── arxiv-2301.12345/
        ├── main.tex          # flagged main file
        ├── *.tex, *.bib, *.bbl
        └── figures/
```

**Why one visible `paperbaker/` and not a hidden dot-dir:** coding-agent search tools are built on
ripgrep, which skips both hidden (dot-prefixed) directories and gitignored paths. To let an agent
grep the paper text *and* the metadata (`papers.json`, `refs.bib`, `README.md`), none of it can be
hidden or ignored. So the whole project lives in a visible `paperbaker/`, never added to `.gitignore`.

**Why a root brief, not just `paperbaker/README.md`:** the `AGENTS.md`/`CLAUDE.md` convention
prioritizes the file at the *repo root*; a guide nested in `paperbaker/` is found by search but not
auto-loaded. So `pb project create`/`bind` injects a short, marked block (`<!-- BEGIN/END PAPER
BAKER -->`) into the root agent file — appending to an existing `AGENTS.md`/`CLAUDE.md`, else creating
`AGENTS.md`. It's a one-time decision recorded in `config.json` (`rootBrief: "added" | "declined"`) so
hand-deleting the block doesn't make us re-add it; `--no-brief` opts out, and outside a TTY it injects
silently. The full per-project index stays in `paperbaker/README.md`, which the brief links to.

**Keeping the bulky tex out of the host repo's history:** `paperbaker/sources/` is its own nested git
repo. That nested `.git` "seals" the subdirectory — a `git add -A` in the host repo can stage at most
a gitlink for `sources/`, never the (bulky, re-downloadable) tex files, while the rest of `paperbaker/`
(config, manifest, bib, guide) stays normally trackable. The tex isn't committed into the nested repo
either; it's a boundary only. Committing `paperbaker/papers.json` + `refs.bib` means a teammate or
fresh agent reproduces the whole corpus with one `pb sync` — no source files travel through git.

#### 5.2.1 `pb project` — bind/create/manage (replaces `init`)

The `project` subcommand is the one entry point for getting a directory bound to a project,
whether the project is new, existing, or offline.

```
pb project create [name]              scaffold dir; publish to the server if logged in, else local
pb project list                       your remote projects; marks the one bound here (*)
pb project bind <slug>                attach this dir to an existing remote project
pb project bind <slug> --merge        on drift, union local <-> remote (non-interactive)
pb project bind <slug> --replace-local   on drift, take remote wholesale
pb project rename <name>              update name+slug locally and remote (one field write if bound)
pb project delete                     delete the remote project (and unbind)
pb project unbind                     detach this dir (drop stableId), keeping both copies
pb sync                               publish (first sync) / reconcile a bound project
```

**Binding state machine** (a directory is in exactly one state):

```
fresh    ──create (logged in)──▶ bound (mints stableId, creates the server doc)
fresh    ──create (offline)────▶ offline (local-only; no stableId)
fresh    ──bind──────────────▶ bound
offline  ──sync (logged in)──▶ bound (mints stableId, creates the project, pushes papers up)
offline  ──bind────▶ bound (merge | replace-local on drift)
bound    ──sync──▶ bound (push local-only up, union the server's papers back down)
bound    ──unbind──▶ offline (stableId dropped; a later sync re-publishes under a fresh id)
bound    ──rename──▶ bound (slug changes, stableId stable)
```

**Rules of behavior**
- **`create` is online-first** — logged in, it mints the `stableId` and creates the server doc
  immediately, so the project is synced from birth and every later mutation mirrors. With no
  credential (or if the server is unreachable) it falls back to a local-only project, which the
  first `pb sync` then publishes. There is no `--offline` flag and no separate `push`/promote step.
- **Mutations follow the binding:** once a project is bound, `add`/`remove`/`rename`/`delete`
  write through to the server. `add`/`remove` do **not** auto-publish an offline project — a single
  mutation can't carry the full local paper set onto a fresh server doc, so that reconcile stays
  `pb sync`'s job.
- **`bind <slug>`** resolves the slug under the caller's account. With no flag, if local state
  differs from the remote manifest it **prompts to merge**; `--merge` / `--replace-local` make
  that non-interactive.
- **`bind` into an already-bound dir** refuses unless preceded by `unbind` (no silent rebind).
- **Sync semantics — never-drop:** `sync` pushes local-only papers up, then unions the server's
  papers back down. It never lets the server *delete* a paper the directory still holds — that is
  what makes syncing onto a fresh/empty account (a new login) non-destructive. To drop a paper,
  `pb remove` it (which also deletes it server-side). Online `add`/`remove` mirror eagerly, so a
  bound directory rarely drifts.
- **Non-TTY / CI** (e.g. `PAPERBAKER_TOKEN` set, no terminal): every prompt **hard-errors** and
  demands an explicit flag (`--merge`, `--replace-local`). No interactive fallback.

### 5.3 Commands (all support `--json`; stable exit codes)

```
pb add <id|url|"query">    resolve, add to project, download tex
pb remove <paperId>
pb search <query>          search arxiv (via backend)
pb list                    papers in this project
pb show <paperId>          metadata (title/abstract/authors/date/venue)
pb sync                    publish/reconcile, download missing sources, rebuild refs.bib
pb read <paperId>          print tex path, or concatenated source to stdout
pb bib                     regenerate refs.bib
pb context                 concatenated tex + figure list (the "simpler" form, §6)
```

- **Eager mirror, explicit reconcile:** while a project is synced, `add`/`remove` mirror to the
  server immediately; `pb sync` is the catch-up that publishes a still-local project, pulls server
  changes, and re-downloads missing sources.
- **Why agents love this layout:** reading needs no CLI at all. The root brief points an agent at
  `paperbaker/README.md` to learn the corpus, then it opens `paperbaker/sources/<id>/main.tex` directly. The CLI is for *mutation*
  (add/remove/sync) and for *agent-optimized reads* (`read`, `context`). Predictable paths + `--json`
  = no scraping.

---

## 6. Future-facing slots (designed now, built later)

- **Other APIs:** implement `PaperProvider` (search/fetchMetadata/fetchSource/fetchPdf). Semantic
  Scholar is the natural second — it also backfills **`venue`**, citation counts, and references.
- **`venue`:** arxiv rarely exposes it directly (sometimes in the free-text `comments` field, e.g.
  "Accepted at NeurIPS 2024"). Treat as an enrichment pass: a provider fills the existing `venue`
  slot asynchronously. No schema change.
- **Manual PDF + OCR:** `ManualProvider` — upload PDF → Storage → OCR (Document AI / equivalent)
  → produce the same `PaperMetadata` with `source.type: "manual"`. Feeds the identical pipeline.
- **MCP / Claude skill:** another thin client over `api-client` + `core`. Tools: `search_papers`,
  `add_paper`, `get_project_context`, `read_paper`. The "simpler context" =
  `core.buildConcatenatedContext(project)` — strips preamble/comments, concatenates tex bodies,
  collects figures into one bundle. Built in `core` from day one (it's where bib/citation logic
  already lives), reused by `pb context` and the MCP resource.

---

## 7. Build order (recommended)

1. **`core`**: `PaperMetadata`, citation/BibTeX, tex parsing. Pure, fully unit-testable.
2. **`providers`**: `PaperProvider` interface + `ArxivProvider` (search, metadata, e-print tarball).
3. **`functions`**: `resolve` + fetch queue + `papers/:id` + manifest. The broker.
4. **`cli`**: `login`, `init`, `add`, `sync`, `read` — the end-to-end agent slice.
5. **`web`**: auth, projects, paper table, PDF viewer, connected-CLIs tab (delete devices + activity log).
6. **Later**: enrichment provider (venue), manual+OCR, MCP server.

### Local development against emulators

- `pnpm emulators:all` — builds functions and starts auth + firestore + **functions** + **hosting**
  (hosting on **5050**, since macOS ControlCenter squats on 5000). Hosting serves the same `/api/*`
  rewrites as production, so both the web and the CLI hit real endpoints locally.
- **Web:** the Vite dev server proxies same-origin `/api/<fn>` to the Functions emulator
  (`apps/web/vite.config.ts`), so `pnpm dev:web` works with no extra config.
- **CLI:** `source scripts/dev-cli.sh` builds the bundle and defines a `pb` shell function for the
  current shell only — nothing is installed (a child process / pnpm command can't add `pb` to your
  shell, so this must be *sourced*). Pass `emulator` to also point at the hosting emulator
  (`PAPERBAKER_EMULATOR=1` → `/api` on 5050) and seed a token, skipping the browser flow:

  ```bash
  pnpm emulators:all                                  # terminal 1
  source scripts/dev-cli.sh emulator                  # terminal 2: builds pb, wires emulator + token
  pb project create "Test" && pb add 1706.03762 && pb sync   # create publishes; add mirrors; sync reconciles
  ```

  Rebuild after CLI changes with `pnpm --filter @paper-baker/cli build`; open a new shell to drop `pb`.
- `pnpm test:e2e` boots the same full stack before Playwright, so the web's mutations exercise the
  real backend end-to-end.

### Test layers

Each layer trades fidelity for speed; they overlap on purpose.

| Suite | Command | Runs against | Catches |
|---|---|---|---|
| Unit | `pnpm test` | pure functions, mocked I/O | logic, parsing, precedence |
| Rules | `pnpm test:rules` | Firestore emulator + real rules | read-own / backend-write authz |
| Functions integration | `pnpm test:functions` | handlers imported **from source**, mounted behind a bare HTTP server → emulator | route + domain logic, the CLI↔web contract, the device-link login flow (real `pb` binary, real `requireAuth`) |
| **Hosting smoke** | `pnpm test:smoke` | the **hosting emulator** (:5050) + the **tsup-built bundle** over real HTTP | the deployment wiring the layer above bypasses: `firebase.json` rewrites (incl. bare paths), the bundle actually loading in plain Node, env (`PAPERBAKER_WEB_URL`) reaching the runtime |
| E2E | `pnpm test:e2e` | full stack + real browser (Playwright) | the web UI itself |

The integration tests mount handlers **from source** for fast, source-level coverage — so they cannot
see a broken `dist` bundle, a missing rewrite, or a wrong runtime env. Those are exactly the three
latent prod bugs found earlier; the hosting smoke test exists to guard that seam.
