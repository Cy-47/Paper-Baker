import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FlaskConical,
  Search,
  FolderTree,
  TerminalSquare,
  FileText,
  RefreshCw,
  BookMarked,
  ArrowRight,
  ArrowUpRight,
  Check,
  Bot,
  Home,
  Library,
  Folder,
  Plus,
  Sun,
  Moon,
  Monitor,
  BookOpenText,
  GitBranch,
  X,
} from "lucide-react";
import { Button, Card } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import { InstallCommand } from "../components/InstallCommand";

const GITHUB_URL = "https://github.com/Cy-47/Paper-Baker";

/** GitHub mark — lucide dropped brand icons, so we inline the official glyph. */
function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

/** macOS-style window chrome wrapper used for both previews. */
function Window({
  label,
  children,
  className = "",
  handleProps,
  handleClassName = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  handleProps?: React.HTMLAttributes<HTMLDivElement>;
  handleClassName?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-solid border-[var(--border)] bg-[var(--surface)] shadow-xl ${className}`}
    >
      <div
        {...handleProps}
        className={`flex items-center gap-2 border-b border-solid border-[var(--border)] bg-[var(--surface-secondary)] px-3.5 py-2.5 ${handleClassName}`}
      >
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ec6a5e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#f4bf4f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#61c554]" />
        </span>
        <span className="ml-2 truncate text-xs text-[var(--muted)]">{label}</span>
      </div>
      {children}
    </div>
  );
}

const features = [
  {
    icon: GitBranch,
    title: "Git, undisturbed",
    body: "Sources sit in paperbaker/sources/ — visible for agents to grep, but sealed in a nested git repo so the bulky TeX never lands in your project's history or diffs.",
  },
  {
    icon: Search,
    title: "Grep-able references",
    body: "`pb context` concatenates every paper's body into one file your agent can grep, embed, or feed straight into context.",
  },
  {
    icon: FolderTree,
    title: "Organized by project",
    body: "Bind a project to a codebase directory. The papers that matter for this line of work live right next to the code.",
  },
  {
    icon: RefreshCw,
    title: "Web ↔ CLI in sync",
    body: "Add a paper on the website, run `pb sync` in your repo. Human and agent stay grounded on the exact same set of references.",
  },
  {
    icon: BookMarked,
    title: "Bibliography on tap",
    body: "`pb bib` regenerates a clean refs.bib from your project so citations never drift out of date.",
  },
  {
    icon: Bot,
    title: "Built for coding agents",
    body: "Every command is scriptable, quiet, and JSON-friendly — designed to be driven by Claude, Cursor, or any agent in your loop.",
  },
];

// ---------------------------------------------------------------------------
// Web app preview — a faithful mini-mockup of the signed-in shell
// ---------------------------------------------------------------------------

const PROJECTS = [
  ["transformers", 5, true],
  ["rl-from-feedback", 3, false],
  ["diffusion-models", 8, false],
] as const;

const PAPERS = [
  ["Attention Is All You Need", "Vaswani et al.", "2017", "1706.03762"],
  ["BERT: Pre-training of Deep Bidirectional Transformers", "Devlin et al.", "2019", "1810.04805"],
  ["An Image is Worth 16×16 Words: Transformers for Image Recognition", "Dosovitskiy et al.", "2021", "2010.11929"],
  ["Language Models are Few-Shot Learners", "Brown et al.", "2020", "2005.14165"],
  ["RoBERTa: A Robustly Optimized BERT Pretraining Approach", "Liu et al.", "2019", "1907.11692"],
] as const;

function WebPreview() {
  // Mirror the page's actual theme so the mockup never shows "light" selected
  // while the site is in dark mode (HeroUI sets data-theme on <html>).
  const [isDark, setIsDark] = useState(false);
  useEffect(() => {
    const read = () =>
      setIsDark(document.documentElement.getAttribute("data-theme") === "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  const themeIcons = [
    { Icon: Sun, active: !isDark },
    { Icon: Moon, active: isDark },
    { Icon: Monitor, active: false },
  ];

  const navRow = (icon: React.ReactNode, label: string, active = false) => (
    <span
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm ${
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"
          : "text-[var(--muted)]"
      }`}
    >
      {icon}
      {label}
    </span>
  );

  return (
    <Window label="paper-baker.web.app" className="w-full text-left">
      {/* top bar */}
      <div className="flex items-center gap-3 border-b border-solid border-[var(--border)] px-3.5 py-2.5">
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
          <FlaskConical size={15} />
        </span>
        <span className="hidden flex-none text-sm font-medium text-[var(--foreground)] md:inline">
          Paper Baker
        </span>
        <span className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-[var(--background-secondary)] px-3 py-1.5 text-xs text-[var(--muted)] shadow-inner">
          <Search size={13} /> Search your papers or arXiv…
        </span>
        <span className="hidden items-center gap-0.5 rounded-lg bg-[var(--background-secondary)] p-0.5 sm:flex">
          {themeIcons.map(({ Icon, active }, i) => (
            <span
              key={i}
              className={`flex h-6 w-6 items-center justify-center rounded-md ${
                active ? "bg-[var(--surface)] text-[var(--accent)]" : "text-[var(--muted)]"
              }`}
            >
              <Icon size={13} />
            </span>
          ))}
        </span>
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-medium text-[var(--accent-foreground)]">
          AR
        </span>
      </div>

      <div className="flex">
        {/* sidebar */}
        <div className="hidden w-52 flex-none flex-col gap-0.5 border-r border-solid border-[var(--border)] p-3 sm:flex">
          {navRow(<Home size={16} />, "Home")}
          {navRow(<Search size={16} />, "Find papers")}
          {navRow(<Library size={16} />, "Library")}
          {navRow(<TerminalSquare size={16} />, "CLIs")}
          <div className="mt-3 flex items-center justify-between px-2.5 py-1">
            <span className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
              <Folder size={14} /> Projects
            </span>
            <Plus size={14} className="text-[var(--muted)]" />
          </div>
          {PROJECTS.map(([name, count, active]) => (
            <span
              key={name}
              className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                active
                  ? "bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"
                  : "text-[var(--muted)]"
              }`}
            >
              <span className="flex-1 truncate">{name}</span>
              <span className="text-[11px] text-[var(--muted)]">{count}</span>
            </span>
          ))}
        </div>

        {/* main */}
        <div className="min-w-0 flex-1 px-4 py-4 sm:px-5">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs text-[var(--muted)]">Project</p>
              <h4 className="truncate text-lg font-semibold text-[var(--foreground)]">
                transformers
              </h4>
            </div>
            <span className="flex flex-none items-center gap-1.5 rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-foreground)]">
              <Plus size={13} /> Add paper
            </span>
          </div>

          <div className="mt-2">
            {PAPERS.map(([title, authors, year, arxiv]) => (
              <div
                key={arxiv}
                className="flex items-center gap-3 border-b border-solid border-[var(--border)] py-3"
              >
                <FileText size={15} className="flex-none text-[var(--accent)]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-[var(--foreground)]">{title}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-[var(--muted)]">
                    <span className="truncate">
                      {authors} · {year}
                    </span>
                    <span className="flex-none rounded bg-[var(--background-secondary)] px-1.5 py-0.5 font-mono text-[10px]">
                      arXiv:{arxiv}
                    </span>
                  </p>
                </div>
                <span className="flex-none rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-soft-foreground)]">
                  tex
                </span>
                <span className="hidden flex-none items-center gap-0.5 text-[var(--muted)] md:flex">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md">
                    <BookOpenText size={15} />
                  </span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-md">
                    <ArrowUpRight size={15} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------
// CLI preview — a terminal session using the real pb commands
// ---------------------------------------------------------------------------

function CliPreview() {
  const Prompt = ({ children }: { children: React.ReactNode }) => (
    <div className="flex gap-2">
      <span className="select-none text-[var(--accent)]">$</span>
      <span className="text-[var(--foreground)]">{children}</span>
    </div>
  );
  const Out = ({ children }: { children: React.ReactNode }) => (
    <div className="pl-4 text-[var(--muted)]">{children}</div>
  );

  return (
    <Window label="agent — pb" className="w-full">
      <div className="space-y-1.5 px-4 py-3.5 font-mono text-[12px] leading-relaxed">
        <Prompt>
          pb add <span className="text-[var(--accent-soft-foreground)]">1706.03762</span>
        </Prompt>
        <Out>
          <span className="text-[#61c554]">✓</span> Added “Attention Is All You Need” — tex
          source downloaded
        </Out>
        <Prompt>
          pb context <span className="text-[var(--muted)]">&gt; papers.txt</span>
        </Prompt>
        <Out>wrote 7 papers · 312 figures indexed</Out>
        <Prompt>
          grep -n <span className="text-[var(--accent-soft-foreground)]">"multi-head"</span>{" "}
          papers.txt
        </Prompt>
        <Out>1402: We employ h = 8 parallel multi-head attention layers…</Out>
        <Prompt>pb bib &gt; refs.bib</Prompt>
        <Out>
          <span className="text-[#61c554]">✓</span> regenerated 7 BibTeX entries
        </Out>
        <div className="flex gap-2">
          <span className="select-none text-[var(--accent)]">$</span>
          <span className="inline-block h-4 w-2 animate-pulse bg-[var(--foreground)]" />
        </div>
      </div>
    </Window>
  );
}

// ---------------------------------------------------------------------------
// "The gap" visuals — one equation, three representations + the sync hub
// ---------------------------------------------------------------------------

// The scaled-dot-product attention formula, typeset the way a human sees it.
function Equation() {
  return (
    <span className="inline-flex items-center gap-1 font-serif text-[var(--foreground)]">
      <span className="italic">softmax</span>
      <span>(</span>
      <span className="inline-flex flex-col items-center leading-none">
        <span className="px-1.5 pb-0.5 italic">
          QK<sup className="text-[0.65em]">T</sup>
        </span>
        <span className="h-px w-full bg-current" />
        <span className="flex items-start px-1.5 pt-0.5">
          <span className="text-[1.15em] leading-none">√</span>
          <span className="border-t border-solid border-current italic leading-none">
            d<sub className="text-[0.65em]">k</sub>
          </span>
        </span>
      </span>
      <span>)</span>
      <span className="italic">V</span>
    </span>
  );
}

// One row of the "your agent reads" column: a representation plus a verdict.
function Repr({
  title,
  ok = false,
  note,
  children,
}: {
  title: string;
  ok?: boolean;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-solid p-3 ${
        ok
          ? "border-[var(--accent)] bg-[var(--accent-soft)]"
          : "border-[var(--border)] bg-[var(--background-secondary)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--foreground)]">{title}</span>
        <span
          className={`flex items-center gap-1 text-[11px] font-medium ${
            ok ? "text-[var(--accent-soft-foreground)]" : "text-[var(--muted)]"
          }`}
        >
          {ok ? <Check size={12} /> : <X size={12} />}
          {ok ? "native" : "unreadable"}
        </span>
      </div>
      <div className="mt-2">{children}</div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">{note}</p>
    </div>
  );
}

// The sync hub shown between the web and CLI previews.
function SyncBadge() {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-solid border-[var(--border)] bg-[var(--surface)] text-[var(--accent)] shadow-lg">
        <RefreshCw size={20} className="[animation-duration:4s] motion-safe:animate-spin" />
      </span>
      <span className="rounded-full border border-solid border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)] shadow-sm">
        pb sync
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero showpiece — the web app behind, a coding agent driving the CLI on top
// ---------------------------------------------------------------------------

function AgentWindow({
  handleProps,
  dragging,
}: {
  handleProps?: React.HTMLAttributes<HTMLDivElement>;
  dragging?: boolean;
}) {
  const Tool = ({ cmd, out }: { cmd: string; out: string }) => (
    <div className="flex items-center gap-2 font-mono text-[11.5px]">
      <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)]" />
      <span className="truncate text-[var(--foreground)]">{cmd}</span>
      <span className="ml-auto flex-none text-[var(--muted)]">{out}</span>
    </div>
  );
  return (
    <Window
      label="coding-agent — Paper Baker"
      className="text-left"
      handleProps={handleProps}
      handleClassName={`touch-none select-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <div className="space-y-2.5 p-3.5 sm:p-4">
        {/* the researcher's ask */}
        <div className="flex items-start gap-2 text-[12.5px]">
          <span className="select-none font-mono text-[var(--accent)]">&gt;</span>
          <p className="text-[var(--foreground)]">
            Compare DistilBERT with our method and add it as a baseline.
          </p>
        </div>

        {/* the CLI finds the paper and pulls its source into the repo */}
        <div className="space-y-1.5 rounded-lg border border-solid border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-2.5">
          <Tool cmd={'pb search "DistilBERT"'} out="arXiv:1910.01108" />
          <Tool cmd="pb add 1910.01108" out="papers/distilbert/" />
        </div>

        {/* now the agent reads the .tex with its own native tools */}
        <div className="rounded-lg border border-solid border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-2.5 font-mono text-[11px] leading-relaxed">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)]" />
            <span className="text-[var(--foreground)]">Grep</span>
            <span className="truncate text-[var(--muted)]">{"\\mathcal{L} · papers/distilbert"}</span>
            <span className="ml-auto flex-none text-[var(--muted)]">2 matches</span>
          </div>
          <div className="ml-[3px] mt-1.5 space-y-1 border-l border-solid border-[var(--border)] pl-3">
            <div className="truncate text-[var(--muted)]">
              <span className="text-[var(--accent)]">distilbert.tex:255</span>{" "}
              <span className="text-[var(--foreground)]">{"$\\mathcal{L}_{ce} = -\\sum_i t_i \\log s_i$"}</span>
            </div>
            <div className="truncate text-[var(--muted)]">
              <span className="text-[var(--accent)]">distilbert.tex:258</span>{" "}
              <span className="text-[var(--foreground)]">{"$\\mathcal{L} = \\alpha\\mathcal{L}_{ce} + \\mathcal{L}_{cos}$"}</span>
            </div>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--accent)]" />
            <span className="text-[var(--foreground)]">Read</span>
            <span className="truncate text-[var(--muted)]">papers/distilbert/main.tex</span>
            <span className="ml-auto flex-none text-[var(--muted)]">§5.1</span>
          </div>
        </div>

        {/* grounded result */}
        <div className="flex items-start gap-2 text-[12.5px]">
          <span className="mt-0.5 flex-none text-[var(--accent)]">
            <Check size={14} />
          </span>
          <p className="leading-relaxed text-[var(--muted)]">
            Wrote <span className="font-mono text-[var(--foreground)]">baselines/distilbert.py</span>{" "}
            — replicates the triple loss at{" "}
            <span className="font-mono text-[var(--foreground)]">T=2</span> and benchmarks it
            against <span className="text-[var(--foreground)]">our method</span>. Read from the
            source, <span className="text-[var(--foreground)]">not guessed</span>.
          </p>
        </div>
      </div>
    </Window>
  );
}

// Makes an element draggable by pointer. Returns the live offset and the
// handlers to spread onto the drag surface. Pointer capture keeps the drag
// alive even if the cursor outruns the element.
function useDraggable() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const origin = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    origin.current = { px: e.clientX, py: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const o = origin.current;
    if (!o) return;
    setPos({ x: o.ox + (e.clientX - o.px), y: o.oy + (e.clientY - o.py) });
  };
  const stop = () => {
    origin.current = null;
    setDragging(false);
  };

  return {
    pos,
    dragging,
    handlers: { onPointerDown, onPointerMove, onPointerUp: stop, onPointerCancel: stop },
  };
}

function HeroVisual() {
  const { pos, dragging, handlers } = useDraggable();

  return (
    <div className="relative mx-auto mt-8 w-full max-w-4xl pb-2 sm:pb-20">
      {/* soft accent glow */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-8 -top-10 bottom-8 -z-10 blur-3xl"
        style={{
          background:
            "radial-gradient(50% 55% at 50% 0%, var(--accent-soft) 0%, transparent 70%)",
        }}
      />
      {/* background: the web library the researcher curates */}
      <div className="pointer-events-none select-none opacity-90 sm:[mask-image:linear-gradient(to_bottom,black_72%,transparent_100%)]">
        <WebPreview />
      </div>
      {/* foreground: a coding agent using the CLI — floats over the app,
          dragged by its title bar (handlers live inside AgentWindow) */}
      <div
        style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
        className="relative z-10 mt-5 sm:absolute sm:-right-4 sm:top-40 sm:mt-0 sm:w-[58%] sm:[filter:drop-shadow(0_24px_45px_rgba(0,0,0,0.4))]"
      >
        <AgentWindow handleProps={handlers} dragging={dragging} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LandingPage() {
  const { user, signIn } = useAuth();

  const githubButton = (
    <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="no-underline">
      <Button variant="secondary" size="sm">
        <Github size={16} /> GitHub
      </Button>
    </a>
  );

  // The primary "sign up" CTAs become a "Home" shortcut once the visitor is
  // signed in — there's nothing left to sign up for.
  const primaryCta = (signedOutLabel: React.ReactNode) =>
    user ? (
      <Link to="/home" className="no-underline">
        <Button variant="primary">
          <Home size={16} /> Home
        </Button>
      </Link>
    ) : (
      <Button variant="primary" onPress={signIn}>
        {signedOutLabel}
      </Button>
    );

  return (
    <div className="min-h-screen bg-[var(--background)]">
      {/* ---------- nav ---------- */}
      <header className="sticky top-0 z-20 border-b border-solid border-[var(--border)] bg-[var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
              <FlaskConical size={16} />
            </span>
            Paper Baker
          </span>
          <div className="flex items-center gap-2">
            {githubButton}
            {user ? (
              <Link to="/home" className="no-underline">
                <Button variant="ghost" size="sm">
                  <Home size={16} /> Home
                </Button>
              </Link>
            ) : (
              <Button variant="ghost" size="sm" onPress={signIn}>
                Sign in
              </Button>
            )}
          </div>
        </div>
      </header>

      <main>
        {/* ---------- hero ---------- */}
        <section
          className="relative overflow-hidden border-b border-solid border-[var(--border)]"
          style={{
            backgroundImage:
              "radial-gradient(70% 55% at 50% -5%, var(--accent-soft) 0%, transparent 65%)",
          }}
        >
          <div className="mx-auto max-w-5xl px-4 pb-20 pt-10 text-center sm:px-6 sm:pt-12">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-solid border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--muted)] no-underline transition-colors hover:text-[var(--accent)]"
            >
              <Github size={13} /> Open source
            </a>

            <h1 className="mx-auto mt-6 max-w-3xl text-[2.75rem] font-semibold leading-[1.0] tracking-tight text-[var(--foreground)] sm:text-7xl">
              PDF for you,
              <br />
              <span className="font-mono text-[var(--accent)]">.tex</span> for your agent.
            </h1>

            <p className="mx-auto mt-6 max-w-lg text-base text-[var(--muted)] sm:text-lg">
              Paper Baker drops the LaTeX source of every paper into your codebase — so your
              agent can <span className="font-mono text-[var(--foreground)]">grep</span> the
              literature like code.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {primaryCta(
                <>
                  Get started — it's free <ArrowRight size={16} />
                </>,
              )}
              {githubButton}
            </div>

            <div className="mx-auto mt-5 w-full max-w-md">
              <InstallCommand size="sm" align="center" />
            </div>

            <HeroVisual />
          </div>
        </section>

        {/* ---------- the gap: one equation, three representations ---------- */}
        <section className="mx-auto max-w-5xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold text-[var(--foreground)] sm:text-3xl">
              You see the math. Your agent needs the source.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-[var(--muted)]">
              Equations, tables, and notation only survive in the source. Paper Baker hands your
              agent the LaTeX behind every paper.
            </p>
          </div>

          <div className="mt-12 grid gap-5 lg:grid-cols-2">
            {/* you read */}
            <Card>
              <Card.Content className="flex h-full flex-col">
                <p className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <BookOpenText size={15} className="text-[var(--accent)]" /> You read
                </p>
                <div className="mt-4 flex flex-1 items-center justify-center rounded-lg bg-[var(--background-secondary)] px-4 py-12 text-2xl sm:text-3xl">
                  <Equation />
                </div>
                <p className="mt-3 text-center text-xs text-[var(--muted)]">
                  A typeset equation, rendered in a PDF.
                </p>
              </Card.Content>
            </Card>

            {/* your agent reads */}
            <Card>
              <Card.Content className="flex h-full flex-col">
                <p className="flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <Bot size={15} className="text-[var(--accent)]" /> Your agent reads
                </p>
                <div className="mt-4 flex flex-1 flex-col justify-center gap-2.5">
                  <Repr
                    title="The PDF"
                    note="A flat image of the math — nothing for text tools to read."
                  >
                    <div className="flex items-center justify-center rounded bg-[var(--background-tertiary)] py-2.5 text-lg">
                      <span className="select-none opacity-60 blur-[2.5px]">
                        <Equation />
                      </span>
                    </div>
                  </Repr>
                  <Repr
                    title="Copied as plain text"
                    note="The √, the fraction, the subscript — all flattened away."
                  >
                    <p className="font-mono text-[12px] text-[var(--muted)]">softmaxQKTdkV</p>
                  </Repr>
                  <Repr
                    ok
                    title="LaTeX source"
                    note="Exactly what you wrote — grep it, diff it, reason over it."
                  >
                    <p className="font-mono text-[12px] text-[var(--foreground)]">
                      <span className="text-[var(--accent)]">{"\\mathrm"}</span>
                      {"{softmax}"}
                      <span className="text-[var(--accent)]">{"\\left"}</span>
                      {"(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V"}
                    </p>
                  </Repr>
                </div>
              </Card.Content>
            </Card>
          </div>
        </section>

        {/* ---------- two surfaces preview ---------- */}
        <section className="border-y border-solid border-[var(--border)] bg-[var(--surface-secondary)]">
          <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-medium text-[var(--accent)]">One library, two surfaces</p>
              <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)] sm:text-3xl">
                You browse on the web. Your agent works in the terminal.
              </h2>
              <p className="mt-4 text-[var(--muted)]">
                Curate papers into projects on the website. Run the CLI in your repo to pull them
                down. <span className="font-mono text-[var(--foreground)]">pb sync</span> keeps both
                in lockstep.
              </p>
            </div>

            <div className="relative mt-12 grid items-stretch gap-5 lg:grid-cols-2">
              <div className="flex flex-col">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <FlaskConical size={15} className="text-[var(--accent)]" /> Web app — for you
                </p>
                <div className="flex-1 [&>div]:h-full">
                  <WebPreview />
                </div>
              </div>

              {/* sync hub — centered between the two windows on desktop */}
              <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
                <SyncBadge />
              </div>
              {/* sync hub — stacked between them on mobile */}
              <div className="flex justify-center lg:hidden">
                <SyncBadge />
              </div>

              <div className="flex flex-col">
                <p className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--foreground)]">
                  <TerminalSquare size={15} className="text-[var(--accent)]" /> CLI — for your agent
                </p>
                <div className="flex-1 [&>div]:h-full">
                  <CliPreview />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- features ---------- */}
        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold text-[var(--foreground)] sm:text-3xl">
              Everything the agent needs, nothing it doesn't
            </h2>
            <p className="mt-4 text-[var(--muted)]">
              A small, scriptable toolkit that turns a reading list into agent-readable context.
            </p>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <Card key={f.title}>
                <Card.Content>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]">
                    <f.icon size={18} />
                  </span>
                  <h3 className="mt-3 font-medium text-[var(--foreground)]">{f.title}</h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">{f.body}</p>
                </Card.Content>
              </Card>
            ))}
          </div>
        </section>

        {/* ---------- install ---------- */}
        <section className="border-t border-solid border-[var(--border)] bg-[var(--surface-secondary)]">
          <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--accent)] text-[var(--accent-foreground)] mx-auto">
              <TerminalSquare size={22} />
            </span>
            <h2 className="mt-5 text-2xl font-semibold text-[var(--foreground)] sm:text-3xl">
              Install the CLI in one line
            </h2>
            <p className="mt-3 text-[var(--muted)]">
              Then sign in to sync, or use it fully offline. Three commands to first paper.
            </p>

            <div className="mx-auto mt-8 w-full max-w-xl">
              <InstallCommand size="md" align="center" />
            </div>

            <div className="mx-auto mt-4 max-w-xl rounded-lg border border-solid border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-left font-mono text-[13px] leading-relaxed text-[var(--muted)]">
              <div>
                <span className="text-[var(--accent)]">$</span> pb login
              </div>
              <div>
                <span className="text-[var(--accent)]">$</span> pb project create
              </div>
              <div>
                <span className="text-[var(--accent)]">$</span> pb add 1706.03762
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {primaryCta(
                <>
                  Create an account <ArrowRight size={16} />
                </>,
              )}
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="no-underline">
                <Button variant="secondary">
                  <Github size={16} /> View source
                </Button>
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ---------- footer ---------- */}
      <footer className="border-t border-solid border-[var(--border)]">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-[var(--muted)] sm:flex-row sm:px-6">
          <span className="flex items-center gap-1.5">
            <FlaskConical size={13} /> Paper Baker — Agent native reference manager
          </span>
          <div className="flex items-center gap-4">
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[var(--muted)] no-underline hover:text-[var(--accent)]"
            >
              <Github size={13} /> GitHub
            </a>
            <Link
              to={user ? "/home" : "/login"}
              className="text-[var(--muted)] no-underline hover:text-[var(--accent)]"
            >
              {user ? "Home" : "Sign in"}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
