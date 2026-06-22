// Canonical "root brief" — the short, marked block Paper Baker injects into a
// repo's root AGENTS.md / CLAUDE.md to point coding agents at the papers.
//
// It lives in core so the two places that need the exact same text stay in
// lockstep: the CLI (apps/cli) WRITES it on `pb project create`/`bind`, and the
// web docs page (apps/web) PREVIEWS it for copying. Change it here and both
// follow. The block is static (no per-project data) by design — that's what lets
// it be injected once and shown verbatim on the website.

export const ROOT_BRIEF_BEGIN = "<!-- BEGIN PAPER BAKER -->";
export const ROOT_BRIEF_END = "<!-- END PAPER BAKER -->";

/** The managed block (including its BEGIN/END markers), with a trailing newline. */
export function generateRootBrief(): string {
  return [
    ROOT_BRIEF_BEGIN,
    "## Research papers (Paper Baker)",
    "",
    "This project uses [Paper Baker](https://paper-baker.web.app) to keep the",
    "**LaTeX source** of cited papers inside the repo, so you can read and search",
    "the literature with your normal tools.",
    "",
    "- Sources: `paperbaker/sources/<paper-id>/` — plain `.tex`. Read and search them like",
    '  code (`rg "scaled dot-product" paperbaker/sources/`). Multi-file papers pull sections',
    "  in with `\\input{...}`; follow those to the sibling files in the same directory.",
    "- Metadata: `paperbaker/papers.json` · Bibliography: `paperbaker/refs.bib`.",
    "- Full guide (install, commands, layout): `paperbaker/README.md`.",
    "",
    "Useful commands (run `pb --help` for all):",
    "- `pb list` — papers in this project",
    "- `pb read <id>` — print a paper's tex to stdout",
    "- `pb search <query>` / `pb add <id|url>` — find / add a paper",
    "- `pb sync` — re-download missing sources, regenerate `refs.bib`",
    "",
    "Prefer the `.tex` source over any PDF: equations, tables, and notation only",
    "survive in the source.",
    ROOT_BRIEF_END,
    "",
  ].join("\n");
}
