import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import ErrorBoundary from "./ErrorBoundary";
import {
  Home,
  Search,
  Library,
  Plus,
  Sun,
  Moon,
  Monitor,
  LogOut,
  FlaskConical,
  Menu,
  X,
  FileText,
  Folder,
  TerminalSquare,
  BookOpen,
} from "lucide-react";
import { Button, Input } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import { useTheme } from "../hooks/useTheme";
import { useData } from "../hooks/useData";
import { createProject } from "../lib/library";
import PaperModal from "./PaperModal";

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm no-underline transition-colors",
    isActive
      ? "bg-[var(--accent-soft)] text-[var(--accent-soft-foreground)]"
      : "text-[var(--muted)] hover:bg-[var(--background-secondary)]",
  ].join(" ");

export default function AppShell() {
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { projects, library, countFor } = useData();
  const navigate = useNavigate();
  const location = useLocation();
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [openPaperId, setOpenPaperId] = useState<string | null>(null);

  // Close the mobile sidebar drawer whenever the route changes.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const openPaper = (paperId: string) => {
    setOpenPaperId(paperId);
    setSidebarOpen(false);
  };

  const themeOptions = [
    ["light", Sun],
    ["dark", Moon],
    ["system", Monitor],
  ] as const;
  const initials = (user?.displayName || user?.email || "?")
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("");

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/find${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`);
  };

  // Guards against a double create when blur fires right after Enter (or vice
  // versa) while the first request is still in flight.
  const creatingProject = useRef(false);
  const addProject = async () => {
    const name = newName.trim();
    if (!name || creatingProject.current) return;
    creatingProject.current = true;
    try {
      const project = await createProject(name);
      setNewName("");
      setCreating(false);
      navigate(`/projects/${project.slug}`);
    } finally {
      creatingProject.current = false;
    }
  };

  const sidebarNav = (
    <>
      <NavLink to="/home" end className={navClass}>
        <Home size={17} /> Home
      </NavLink>
      <NavLink to="/find" className={navClass}>
        <Search size={17} /> Find papers
      </NavLink>
      <NavLink to="/library" className={navClass}>
        <Library size={17} /> Library
      </NavLink>
      <NavLink to="/clis" className={navClass}>
        <TerminalSquare size={17} /> CLIs
      </NavLink>
      <NavLink to="/docs" className={navClass}>
        <BookOpen size={17} /> Docs
      </NavLink>

      <div className="mt-4 flex items-center justify-between px-2.5">
        <span className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
          <Folder size={15} /> Projects
        </span>
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          aria-label="New project"
          onPress={() => setCreating((v) => !v)}
        >
          <Plus size={15} />
        </Button>
      </div>

      {creating && (
        <Input
          autoFocus
          className="mb-1"
          placeholder="Project name…"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addProject();
            if (e.key === "Escape") setCreating(false);
          }}
          onBlur={() => (newName.trim() ? addProject() : setCreating(false))}
        />
      )}

      {projects.length === 0 && !creating && (
        <p className="px-2.5 py-1 text-xs text-[var(--muted)]">No projects yet</p>
      )}
      {projects.map((p) => (
        <NavLink key={p.projectId} to={`/projects/${p.slug}`} className={navClass}>
          <span className="flex-1 truncate">{p.name}</span>
          <span className="text-[11px] text-[var(--muted)]">{countFor(p.projectId)}</span>
        </NavLink>
      ))}

      <div className="mt-4 px-2.5">
        <span className="flex items-center gap-1.5 text-sm text-[var(--muted)]">
          <FileText size={15} /> Papers
        </span>
      </div>

      {library.length === 0 && (
        <p className="px-2.5 py-1 text-xs text-[var(--muted)]">No papers yet</p>
      )}
      {library.map((i) => (
        <button
          key={i.paperId}
          type="button"
          onClick={() => openPaper(i.paperId)}
          title={i.title}
          className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-[var(--muted)] transition-colors hover:bg-[var(--background-secondary)]"
        >
          <span className="flex-1 truncate">{i.title}</span>
        </button>
      ))}
    </>
  );

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 flex-none items-center gap-2 border-b border-solid border-[var(--border)] bg-[var(--surface)] px-3 sm:gap-4 sm:px-4">
        <Button
          isIconOnly
          variant="ghost"
          size="sm"
          className="flex-none md:hidden"
          aria-label="Open menu"
          onPress={() => setSidebarOpen(true)}
        >
          <Menu size={18} />
        </Button>

        <NavLink to="/home" className="flex flex-none items-center gap-2 no-underline">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
            <FlaskConical size={16} />
          </span>
          <span className="hidden font-medium text-[var(--foreground)] sm:inline">Paper Baker</span>
        </NavLink>

        <form onSubmit={submitSearch} className="search-inset mx-auto w-full min-w-0 max-w-md">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your papers or arxiv…"
            fullWidth
          />
        </form>

        <div className="ml-auto flex flex-none items-center gap-1 sm:gap-2">
          <div
            className="hidden items-center gap-0.5 rounded-lg p-0.5 sm:flex"
            style={{ background: "var(--background-secondary)" }}
            role="group"
            aria-label="Theme"
          >
            {themeOptions.map(([val, Icon]) => {
              const active = theme === val;
              return (
                <button
                  key={val}
                  type="button"
                  onClick={() => setTheme(val)}
                  aria-label={val}
                  aria-pressed={active}
                  title={val}
                  className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  style={
                    active
                      ? { background: "var(--surface)", color: "var(--accent)" }
                      : { color: "var(--muted)" }
                  }
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
          <span
            className="hidden h-7 w-7 items-center justify-center rounded-full bg-[var(--accent)] text-[11px] font-medium text-[var(--accent-foreground)] sm:flex"
            title={user?.displayName || user?.email || ""}
          >
            {initials}
          </span>
          <Button isIconOnly variant="ghost" size="sm" onPress={signOut} aria-label="Sign out">
            <LogOut size={17} />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 flex-none flex-col gap-1 overflow-y-auto border-r border-solid border-[var(--border)] bg-[var(--surface)] p-3 md:flex">
          {sidebarNav}
        </aside>

        {sidebarOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden">
            <div
              className="fixed inset-0 bg-black/40"
              aria-hidden="true"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="relative z-10 flex w-64 max-w-[80%] flex-col gap-1 overflow-y-auto border-r border-solid border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--accent-foreground)]">
                    <FlaskConical size={16} />
                  </span>
                  Paper Baker
                </span>
                <Button
                  isIconOnly
                  variant="ghost"
                  size="sm"
                  aria-label="Close menu"
                  onPress={() => setSidebarOpen(false)}
                >
                  <X size={18} />
                </Button>
              </div>
              {sidebarNav}
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-6xl flex-col px-4 py-5 sm:px-6 sm:py-7">
            {/* Key by route so a page error clears when navigating elsewhere,
                while the shell (nav/sidebar) stays usable. */}
            <ErrorBoundary key={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>

      {openPaperId && (
        <PaperModal paperId={openPaperId} onClose={() => setOpenPaperId(null)} />
      )}
    </div>
  );
}
