# Paper Baker

**PDF for you, `.tex` for your agent.**

Paper Baker drops the LaTeX source of every paper you read into your codebase, so
your AI coding agent can read and `grep` the literature with the tools it already
has — grounded on exactly the same papers you are.

🌐 **[paper-baker.web.app](https://paper-baker.web.app)** · 📦 [GitHub Releases](https://github.com/Cy-47/Paper-Baker/releases)

---

## Why

You read papers as PDFs. AI agents are native to text. When you ask an agent to
implement a method or write a related-work section, it has never actually seen
the paper behind it — and a PDF is the wrong format to hand it: equations,
tables, and notation only survive in the **source**.

Paper Baker bridges that gap:

- **The CLI (`pb`)** finds a paper on arXiv, downloads its **LaTeX source** into
  your project, and keeps a manifest, a `refs.bib`, and a `paperbaker/README.md`
  index up to date — plus a short brief in your root `AGENTS.md`/`CLAUDE.md` so
  agents discover the papers automatically.
- **The web app** lets you search, organize papers into projects, and read them —
  the human-facing side of the same library.
- **Sync** keeps the two in lockstep, so you and your agent share one set of
  references.

Once the `.tex` is in your repo, any coding agent (Claude Code, Cursor, …) reads
and searches it with its **own native tools** — no PDF parsing, no lost math.

## How it works

```
pb search "DistilBERT"        →  finds arXiv:1910.01108
pb add 1910.01108             →  downloads the LaTeX into paperbaker/sources/
# now your agent reads it natively:
Grep "\mathcal{L}" paperbaker/sources/distilbert
Read paperbaker/sources/distilbert/main.tex
pb bib > refs.bib             →  a clean bibliography, on tap
```

Paper sources live in **`paperbaker/sources/`** — a *visible* directory (so
ripgrep/grep and agent tools find it), but sealed inside a nested git repo so the
bulky, re-downloadable TeX never lands in your project's history or diffs.

## Install the CLI

The `pb` binary is self-contained, for macOS & Linux:

```sh
curl -LsSf https://paper-baker.web.app/install.sh | sh
```

Windows (PowerShell):

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://paper-baker.web.app/install.ps1 | iex"
```

This installs `pb` into `~/.local/bin` and puts it on your `PATH`.

## Quick start

```sh
pb login                 # optional — sign in to sync with your account
pb project create        # bind the current directory to a project
pb add 1706.03762        # add a paper by arXiv ID or URL
pb sync                  # download missing sources, regenerate refs.bib
```

The CLI works fully offline — login is only needed to sync with the web app.

## CLI reference

Run `pb --help` or `pb <command> --help` for details.

| Command | Description |
| --- | --- |
| `pb search <query>` | Search arXiv for papers |
| `pb add <id\|url>` | Add a paper to the project (downloads tex source) |
| `pb remove <id>` | Remove a paper from the project |
| `pb list` | List papers in the current project |
| `pb show <id>` | Show detailed metadata for a paper |
| `pb read <id>` | Print a paper's tex source to stdout |
| `pb context` | Concatenate all papers' tex bodies + figure list |
| `pb bib` | Regenerate `refs.bib` and print to stdout |
| `pb sync` | Reconcile with the server, re-download sources, regenerate `refs.bib` |
| `pb project create\|list\|bind\|rename\|delete\|unbind` | Manage projects |
| `pb login` / `pb logout` / `pb whoami` | Account / auth |
| `pb update` / `pb uninstall` | Manage the `pb` binary |

## For coding agents

After a `pb add`/`pb sync`, the project contains:

- `paperbaker/sources/<paper-id>/` — extracted `.tex` files, searchable with grep/ripgrep
- `paperbaker/refs.bib` — a generated BibTeX bibliography
- `paperbaker/README.md` — a generated guide telling the agent where the sources
  live and how to search them

`pb project create`/`bind` also drops a short, clearly-marked brief into your
root `AGENTS.md` (or `CLAUDE.md` if that's what the repo uses) pointing at the
above — so an agent finds the papers from the repo root without being told. It's
written once; opt out with `--no-brief`.

So you can point your agent at the literature directly:

```sh
rg "scaled dot-product" paperbaker/sources/
```

## Repository layout

This is a pnpm monorepo.

| Path | Package | Role |
| --- | --- | --- |
| `apps/cli` | `@paper-baker/cli` | The `pb` command-line tool |
| `apps/web` | `@paper-baker/web` | React + Vite web app (Firebase Hosting) |
| `functions` | `@paper-baker/functions` | Firebase Cloud Functions (API) |
| `packages/core` | `@paper-baker/core` | Shared logic — arXiv parsing/query, BibTeX, project IDs |
| `packages/providers` | `@paper-baker/providers` | Paper providers (arXiv) |
| `packages/api-client` | `@paper-baker/api-client` | Typed client for the backend API |

## Development

**Prerequisites:** Node ≥ 20, pnpm ≥ 9. (Firebase emulators need a JDK.)

```sh
pnpm install            # install all workspaces
pnpm dev:web            # run the web app (Vite dev server)
pnpm dev:functions      # run the functions in watch mode
pnpm build              # build every workspace
pnpm lint               # eslint
pnpm typecheck          # tsc across workspaces
```

### Testing

```sh
pnpm test               # unit tests (vitest)
pnpm test:integration   # integration tests
pnpm test:rules         # Firestore security-rules tests (emulator)
pnpm test:functions     # Cloud Functions tests (emulator)
pnpm test:e2e           # end-to-end tests
pnpm test:smoke         # full-stack smoke test against the emulators
```

Run the Firebase emulators locally:

```sh
pnpm emulators          # auth + firestore
pnpm emulators:all      # auth + firestore + functions + hosting
```

## Deployment

The web app, installer scripts, and Cloud Functions deploy to Firebase:

```sh
pnpm deploy:prod        # pnpm build && firebase deploy --project paper-baker
```

The `pb` binary is published as platform builds on
[GitHub Releases](https://github.com/Cy-47/Paper-Baker/releases); the
`install.sh` / `install.ps1` scripts (served from the web app) fetch the latest.

## Tech stack

- **CLI:** TypeScript, [commander](https://github.com/tj/commander.js), bundled
  with tsup into a self-contained binary
- **Web:** React, Vite, Tailwind CSS, [HeroUI](https://www.heroui.com/)
- **Backend:** Firebase (Auth, Firestore, Cloud Functions, Hosting)
- **Papers:** arXiv source/metadata, throttled to the provider's limits

## License

Open source under the [MIT License](LICENSE).
