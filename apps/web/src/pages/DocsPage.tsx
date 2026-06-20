import { FileText, FolderTree, BookText } from "lucide-react";
import { generateRootBrief, ROOT_BRIEF_BEGIN, ROOT_BRIEF_END } from "@paper-baker/core";
import { DocsChrome } from "../components/DocsChrome";
import { CopyBlock } from "../components/CopyBlock";
import { Markdown } from "../components/Markdown";

/** One generated/derived file Paper Baker keeps in your repo. */
function FileRow({
  icon: Icon,
  path,
  desc,
}: {
  icon: typeof FileText;
  path: string;
  desc: string;
}) {
  return (
    <li className="flex items-start gap-3 border-b border-solid border-[var(--border)] py-3 last:border-b-0">
      <Icon size={16} className="mt-0.5 flex-none text-[var(--accent)]" />
      <div className="min-w-0">
        <code className="text-sm text-[var(--foreground)]">{path}</code>
        <p className="mt-0.5 text-sm text-[var(--muted)]">{desc}</p>
      </div>
    </li>
  );
}

export default function DocsPage() {
  const brief = generateRootBrief();
  // The BEGIN/END markers are HTML comments that matter for copy (the CLI keys
  // off them) but are noise when rendered, so drop them from the preview only.
  const briefRendered = brief.replaceAll(ROOT_BRIEF_BEGIN, "").replaceAll(ROOT_BRIEF_END, "").trim();

  return (
    <DocsChrome>
      <p className="text-sm font-medium text-[var(--accent)]">Documentation</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
        Agent integration
      </h1>
      <p className="mt-4 max-w-2xl text-[var(--muted)]">
        So your coding agent discovers the papers on its own, Paper Baker adds a short
        guide to your repo when you set up a project. Here's exactly what gets written —
        and how to opt out.
      </p>

      {/* ---------- the root brief ---------- */}
      <section className="mt-12">
        <h2 id="the-root-brief" className="text-xl font-semibold text-[var(--foreground)]">
          The root brief
        </h2>
        <p className="mt-3 text-[var(--muted)]">
          When you run{" "}
          <code className="rounded bg-[var(--background-secondary)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--foreground)]">
            pb project create
          </code>{" "}
          or{" "}
          <code className="rounded bg-[var(--background-secondary)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--foreground)]">
            pb project bind
          </code>
          , the following block is appended to your repo's root{" "}
          <code className="rounded bg-[var(--background-secondary)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--foreground)]">
            AGENTS.md
          </code>{" "}
          (or{" "}
          <code className="rounded bg-[var(--background-secondary)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--foreground)]">
            CLAUDE.md
          </code>{" "}
          if that's what your repo uses):
        </p>

        <div className="mt-4">
          <CopyBlock copyText={brief} label="AGENTS.md / CLAUDE.md">
            <Markdown slug={false}>{briefRendered}</Markdown>
          </CopyBlock>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Shown rendered — <strong className="font-medium text-[var(--foreground)]">Copy</strong>{" "}
            grabs the raw markdown.
          </p>
        </div>

        <ul className="mt-5 space-y-2 text-sm text-[var(--muted)]">
          <li className="flex gap-2">
            <span className="text-[var(--accent)]">•</span>
            <span>
              <strong className="font-medium text-[var(--foreground)]">Written once.</strong>{" "}
              The decision is remembered, so deleting the block by hand won't make it
              come back on the next command.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent)]">•</span>
            <span>
              <strong className="font-medium text-[var(--foreground)]">Picks the right file.</strong>{" "}
              It appends to an existing <code className="font-mono">AGENTS.md</code> or{" "}
              <code className="font-mono">CLAUDE.md</code>, and only creates{" "}
              <code className="font-mono">AGENTS.md</code> if neither exists.
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-[var(--accent)]">•</span>
            <span>
              <strong className="font-medium text-[var(--foreground)]">Opt out anytime.</strong>{" "}
              Pass{" "}
              <code className="rounded bg-[var(--background-secondary)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--foreground)]">
                --no-brief
              </code>{" "}
              to <code className="font-mono">pb project create</code>/
              <code className="font-mono">bind</code>, or just delete the block — it stays gone.
            </span>
          </li>
        </ul>
      </section>

      {/* ---------- what else lands in the repo ---------- */}
      <section className="mt-12">
        <h2
          id="what-else-lands-in-your-repo"
          className="text-xl font-semibold text-[var(--foreground)]"
        >
          What else lands in your repo
        </h2>
        <p className="mt-3 text-[var(--muted)]">
          Everything Paper Baker manages lives in a single visible{" "}
          <code className="font-mono">paperbaker/</code> directory, so agent search tools
          (ripgrep &amp; friends) can read it:
        </p>
        <ul className="mt-4">
          <FileRow
            icon={FolderTree}
            path="paperbaker/sources/<paper-id>/"
            desc="Extracted .tex source per paper — entry point main.tex. Grep it directly."
          />
          <FileRow
            icon={BookText}
            path="paperbaker/README.md"
            desc="A generated index of every paper in the project, regenerated on each change."
          />
          <FileRow
            icon={FileText}
            path="paperbaker/refs.bib"
            desc="A clean BibTeX bibliography, regenerated from the project's papers."
          />
          <FileRow
            icon={FileText}
            path="paperbaker/papers.json"
            desc="The manifest: the paper list plus cached metadata."
          />
        </ul>
      </section>
    </DocsChrome>
  );
}
