import { Link } from "react-router-dom";
import { ArrowRight, Bot, BookText } from "lucide-react";
import { Button } from "@heroui/react";
import { DocsChrome } from "../components/DocsChrome";
import { InstallCommand } from "../components/InstallCommand";
import { CommandBlock } from "../components/CommandBlock";

/** A copyable command block, spaced for use inside a step. */
function Cmd({ lines }: { lines: string[] }) {
  return <CommandBlock lines={lines} size="sm" className="mt-3" />;
}

/** One numbered step in the walkthrough, with a connector line to the next. */
function Step({
  n,
  title,
  last,
  children,
}: {
  n: number;
  title: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="relative pb-9 pl-12 last:pb-0">
      {!last && (
        <span
          aria-hidden="true"
          className="absolute left-[15px] top-9 bottom-1 w-px bg-[var(--border)]"
        />
      )}
      <span className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full bg-[var(--accent-soft)] text-sm font-semibold text-[var(--accent-soft-foreground)]">
        {n}
      </span>
      <h2
        id={title.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-")}
        className="text-lg font-semibold leading-8 text-[var(--foreground)]"
      >
        {title}
      </h2>
      <div className="mt-1 text-[var(--muted)]">{children}</div>
    </li>
  );
}

export default function QuickstartPage() {
  return (
    <DocsChrome>
      <p className="text-sm font-medium text-[var(--accent)]">Documentation</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl">
        Quickstart
      </h1>
      <p className="mt-4 max-w-2xl text-[var(--muted)]">
        From zero to your agent reading a paper's LaTeX source, in five steps. The CLI works
        fully offline — signing in is only needed to sync with the web app.
      </p>

      <ol className="mt-10">
        <Step n={1} title="Install the CLI">
          <div className="mt-1">
            <InstallCommand size="sm" />
          </div>
        </Step>

        <Step n={2} title="Sign in (optional)">
          <p>
            Links this machine to your account so projects and papers sync with the web app.
            Skip it to work entirely offline.
          </p>
          <Cmd lines={["pb login"]} />
        </Step>

        <Step n={3} title="Create a project">
          <p>
            Run this in your codebase. It scaffolds a visible{" "}
            <code className="font-mono">paperbaker/</code> directory and binds it to a project
            (published to the server when you're signed in).
          </p>
          <Cmd lines={["cd your-project", "pb project create"]} />
        </Step>

        <Step n={4} title="Add a paper">
          <p>
            Pass an arXiv ID or URL. Paper Baker downloads the paper's{" "}
            <code className="font-mono">.tex</code> source into{" "}
            <code className="font-mono">paperbaker/sources/</code> and updates{" "}
            <code className="font-mono">refs.bib</code>.
          </p>
          <Cmd lines={["pb add 1706.03762"]} />
          <p className="mt-3">
            You can also add papers from the web app, and then run this in your codebase to
            download them:
          </p>
          <Cmd lines={["pb sync"]} />
        </Step>

        <Step n={5} title="Point your agent at it" last>
          <p>
            The source is now in your repo — your coding agent reads and greps it with its own
            native tools. No PDF parsing, no lost math.
          </p>
        </Step>
      </ol>

      {/* next steps */}
      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <Link
          to="/docs"
          className="group rounded-xl border border-solid border-[var(--border)] bg-[var(--surface)] p-5 no-underline transition-colors hover:border-[var(--accent)]"
        >
          <Bot size={18} className="text-[var(--accent)]" />
          <h3 className="mt-2 font-medium text-[var(--foreground)]">Agent integration</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            What Paper Baker writes into your repo so agents discover the papers on their own.
          </p>
        </Link>
        <Link
          to="/docs/cli"
          className="group rounded-xl border border-solid border-[var(--border)] bg-[var(--surface)] p-5 no-underline transition-colors hover:border-[var(--accent)]"
        >
          <BookText size={18} className="text-[var(--accent)]" />
          <h3 className="mt-2 font-medium text-[var(--foreground)]">CLI Documentation</h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Every command in detail, plus the <code className="font-mono">paperbaker/</code>{" "}
            file structure.
          </p>
        </Link>
      </div>

      <div className="mt-8">
        <a
          href="https://github.com/Cy-47/Paper-Baker"
          target="_blank"
          rel="noreferrer"
          className="no-underline"
        >
          <Button variant="secondary" size="sm">
            View source on GitHub <ArrowRight size={15} />
          </Button>
        </a>
      </div>
    </DocsChrome>
  );
}
