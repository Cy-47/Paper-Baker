import { Link, NavLink } from "react-router-dom";
import { FlaskConical, Home } from "lucide-react";
import { Button } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import { OnThisPage } from "./OnThisPage";

const GITHUB_URL = "https://github.com/Cy-47/Paper-Baker";

/** The doc pages, listed in the left sidebar. */
const DOC_PAGES = [
  { to: "/docs/quickstart", label: "Quickstart", end: false },
  { to: "/docs", label: "Agent integration", end: true },
  { to: "/docs/cli", label: "CLI Documentation", end: false },
];

/** GitHub mark — lucide dropped brand icons, so we inline the official glyph. */
function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "block rounded-lg px-3 py-1.5 text-sm no-underline transition-colors",
    isActive
      ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-soft-foreground)]"
      : "text-[var(--muted)] hover:bg-[var(--background-secondary)] hover:text-[var(--foreground)]",
  ].join(" ");

/**
 * Shared shell for the documentation pages. Top bar matches the landing page
 * (wide frame); the doc-page nav lives in a left sidebar, the conventional docs
 * layout.
 */
export function DocsChrome({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const navLinks = DOC_PAGES.map((p) => (
    <NavLink key={p.to} to={p.to} end={p.end} className={navClass}>
      {p.label}
    </NavLink>
  ));

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="sticky top-0 z-20 border-b border-solid border-[var(--border)] bg-[var(--background)]/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/site"
            className="flex items-center gap-2 font-medium text-[var(--foreground)] no-underline"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
              <FlaskConical size={16} />
            </span>
            Paper Baker
          </Link>
          <div className="flex items-center gap-2">
            <a href={GITHUB_URL} target="_blank" rel="noreferrer" className="no-underline">
              <Button variant="secondary" size="sm">
                <Github size={16} /> GitHub
              </Button>
            </a>
            <Link to={user ? "/home" : "/login"} className="no-underline">
              <Button variant="ghost" size="sm">
                {user ? (
                  <>
                    <Home size={16} /> Home
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 sm:px-6">
        {/* left sidebar — doc page nav (desktop) */}
        <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-52 flex-none flex-col gap-0.5 self-start py-10 md:flex">
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            Documentation
          </p>
          {navLinks}
        </aside>

        <main className="min-w-0 flex-1 py-10 sm:py-12">
          {/* horizontal doc nav (mobile) */}
          <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-solid border-[var(--border)] pb-3 md:hidden">
            {navLinks}
          </nav>
          {/* content capped at a readable measure; left-aligned once the TOC shows */}
          <div data-docs-content className="mx-auto max-w-4xl xl:mx-0">
            {children}
          </div>
        </main>

        {/* right rail — on-this-page TOC (xl) */}
        <OnThisPage />
      </div>

      <footer className="border-t border-solid border-[var(--border)]">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-8 text-xs text-[var(--muted)] sm:flex-row sm:px-6">
          <span className="flex items-center gap-1.5">
            <FlaskConical size={13} /> Paper Baker — Agent native reference manager
          </span>
          <div className="flex items-center gap-4">
            <Link to="/site" className="text-[var(--muted)] no-underline hover:text-[var(--accent)]">
              Home
            </Link>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-[var(--muted)] no-underline hover:text-[var(--accent)]"
            >
              <Github size={13} /> GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
