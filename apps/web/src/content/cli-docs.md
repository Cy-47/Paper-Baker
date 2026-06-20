# Paper Baker CLI

`pb` downloads the LaTeX source of papers from arXiv into your repository and keeps
generated metadata, a bibliography, and a reading guide alongside it. Everything lands in
a single `paperbaker/` directory as plain text, so a coding agent can grep and read the
papers with its normal tools.

The reading guide is written to `paperbaker/README.md`: it lists the project's papers and
where each source lives, for an agent to open directly.

The CLI works offline; sign in only to sync with the web app.

## Install

```sh
curl -LsSf https://paper-baker.web.app/install.sh | sh
```

On Windows, run `irm https://paper-baker.web.app/install.ps1 | iex` in PowerShell. This
installs the self-contained `pb` binary into `~/.local/bin`. For a
step-by-step walkthrough, see the Quickstart.

## Commands

Run `pb --help` or `pb <command> --help` for usage. Most read commands accept `--json`;
login is optional and only required for syncing.

Once a project is bound to the server, most commands reconcile with it automatically when
they finish — adding, removing, reading, or listing all trigger a quiet background sync — so
you rarely need to run [`pb sync`](#pb-sync) by hand. The automatic pass only touches
**already-bound** projects and never publishes a local-only one; see [Sync](#sync).

### Papers

#### `pb search <query>`

Search arXiv. Throttled to arXiv's rate limits.

| Option | Description |
| --- | --- |
| `-n, --max-results <n>` | Max results (default `10`) |

#### `pb add <id-or-url>`

Resolve an arXiv ID or URL, add the paper, and download its `.tex` source into
`paperbaker/sources/`. Regenerates `refs.bib` and `README.md`, and mirrors to the server
when the project is synced.

```sh
pb add 1706.03762
```

#### `pb remove <paper-id>`

Remove a paper and delete its source directory.

#### `pb list`

List the papers in the current project.

#### `pb show <paper-id>`

Print detailed metadata for one paper.

### Reading

Get paper text and references out of the project.

#### `pb read <paper-id>`

Print a paper's tex to stdout — `main.tex` by default, or all `.tex` files with `--concat`.

#### `pb context`

Print the concatenated tex bodies and figure list for every paper — one blob for an agent's
context window.

#### `pb bib`

Regenerate `refs.bib` and print it to stdout.

### Projects

A project binds a directory to a set of papers.

#### `pb project create [name]`

Scaffold `paperbaker/` and create the project. Publishes to the server when logged in, else
stays local until the first `pb sync`. Name defaults to the directory name.

| Option | Description |
| --- | --- |
| `--no-brief` | Don't add the brief to the root `AGENTS.md`/`CLAUDE.md` |

#### `pb project bind <id>`

Bind the current directory to an existing remote project.

| Option | Description |
| --- | --- |
| `--merge` | On drift, union local and remote papers |
| `--replace-local` | On drift, take the remote state |
| `--no-brief` | Don't add the brief to the root `AGENTS.md`/`CLAUDE.md` |

#### `pb project list`

List your server-side projects, marking the one bound here.

#### `pb project rename <name>`

Rename the bound project (updates the server when bound).

#### `pb project delete`

Delete the bound remote project and unbind. Local files are left in place. `-y`/`--yes`
skips the confirmation prompt.

#### `pb project unbind`

Detach the directory from its remote project, keeping both copies.

### Sync

#### `pb sync`

Reconcile with the server: publishes a local project on the first sync (when logged in),
pulls remote changes, re-downloads missing sources, and regenerates `refs.bib` and
`README.md`. Runs local-only when not logged in.

Once a project is bound, most in-project commands run this reconcile automatically when they
finish, so local and server stay in step without an explicit `pb sync`. The automatic pass
is quiet (it only speaks up on a real failure), best-effort (a network blip never fails the
command), and only touches **already-bound** projects — a local-only project stays offline
until you publish it with an explicit `pb sync`. Set `PAPERBAKER_NO_SYNC=1` to turn the
automatic pass off.

### Account

#### `pb login`

Sign in via a browser device link. `--open` opens the verification URL automatically.

#### `pb logout`

Remove the stored credential.

#### `pb whoami`

Print the current authentication status.

### Maintenance

#### `pb update`

Update `pb` to the latest release. `--force` reinstalls even if already current.

#### `pb uninstall`

Remove the binary and its `PATH` entries. `--purge` also deletes the stored config;
`--keep-config` keeps it without prompting.

### Environment

| Variable | Effect |
| --- | --- |
| `PAPERBAKER_QUIET=1` | Silence the "not signed in" notice |
| `PAPERBAKER_NO_SYNC=1` | Disable the automatic post-command sync |
| `PAPERBAKER_TOKEN` | Supply a credential for headless/CI use |
| `PAPERBAKER_API_URL` | Override the backend API base URL |

## The `paperbaker/` directory

Everything `pb` manages lives in one **visible** `paperbaker/` directory (not a dot-dir), so
agent search tools (ripgrep et al.) can read both the metadata and the paper text.

```text
your-project/
├── AGENTS.md            # (or CLAUDE.md) short brief pointing agents at the papers
└── paperbaker/
    ├── config.json      # project binding: name, server id, slug
    ├── papers.json      # manifest: paper list + cached metadata
    ├── refs.bib         # generated BibTeX bibliography
    ├── README.md        # generated guide: the project's papers and where each source lives
    └── sources/         # nested git repo — tex per paper
        └── arxiv-1706.03762/
            ├── main.tex
            ├── *.tex, *.bib, *.bbl
            └── figures/
```

`config.json`, `papers.json`, `refs.bib`, and `README.md` are meant to be committed — a
teammate or fresh agent reproduces the corpus with one `pb sync`. `sources/` is a sealed
nested git repo so the bulky, re-downloadable tex stays out of your project's history: a
`git add -A` can stage at most a gitlink for it, never the tex files themselves.
