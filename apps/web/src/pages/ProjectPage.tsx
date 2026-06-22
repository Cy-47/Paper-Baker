import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Plus, BookOpenText, ArrowUpRight, FolderMinus, Pencil, Copy, Check } from "lucide-react";
import { Button } from "@heroui/react";
import { useData } from "../hooks/useData";
import { removePaperFromProject, renameProject } from "../lib/library";
import AddPaperModal from "../components/AddPaperModal";
import ConfirmModal from "../components/ConfirmModal";
import PaperRow from "../components/PaperRow";
import ProjectChips from "../components/ProjectChips";

const iconLink =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] no-underline hover:bg-[var(--background-secondary)] hover:text-[var(--accent)]";

export default function ProjectPage() {
  const { stableId: routeStableId = "" } = useParams();
  const { projects, papersIn, loading } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [copied, setCopied] = useState(false);
  const [pendingRemoval, setPendingRemoval] = useState<{ paperId: string; title: string } | null>(
    null,
  );

  // The URL path carries the immutable `stableId` (the human `id` is re-derived
  // from the name on every rename, so it can't be the route key). Resolve it to
  // the project and use `stableId` for every data op.
  const project = projects.find((p) => p.stableId === routeStableId);
  const stableId = project?.stableId ?? "";
  const papers = papersIn(stableId);

  // A bare id binds under the caller's own account (DESIGN §5.2).
  const bindCmd = project ? `pb project bind ${project.id}` : "";
  const copyBindCmd = () => {
    navigator.clipboard?.writeText(bindCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const startRename = () => {
    setDraft(project?.name ?? "");
    setEditing(true);
  };

  const saveRename = async () => {
    const name = draft.trim();
    if (name && name !== project?.name) await renameProject(stableId, name);
    setEditing(false);
  };

  if (!project && !loading) {
    return (
      <div className="mt-10 text-center">
        <p className="text-sm text-[var(--muted)]">Project not found.</p>
        <Link to="/home" className="mt-4 inline-block no-underline">
          <Button variant="secondary">Back to Home</Button>
        </Link>
      </div>
    );
  }

  const removeFromProject = (paperId: string) => {
    removePaperFromProject(stableId, paperId);
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                aria-label="Project name"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveRename();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="rounded-md border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xl font-medium text-[var(--foreground)]"
              />
              <Button variant="primary" size="sm" onPress={() => void saveRename()}>
                Save
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-medium text-[var(--foreground)]">{project?.name}</h1>
              <Button
                isIconOnly
                variant="ghost"
                size="sm"
                aria-label="Rename project"
                onPress={startRename}
              >
                <Pencil size={15} className="text-[var(--muted)]" />
              </Button>
            </div>
          )}
          {project?.description && (
            <p className="mt-1 text-sm text-[var(--muted)]">{project.description}</p>
          )}
          <p className="mt-1 text-xs text-[var(--muted)]">
            {papers.length} {papers.length === 1 ? "paper" : "papers"}
          </p>
          <button
            type="button"
            onClick={copyBindCmd}
            aria-label="Copy bind command"
            title="Bind a local directory to this project"
            className="group mt-3 inline-flex items-center gap-2 rounded-lg border border-solid border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-left font-mono text-[13px] text-[var(--foreground)] transition-colors hover:border-[var(--accent)]"
          >
            <span className="select-none text-[var(--accent)]">$</span>
            <span className="truncate">{bindCmd}</span>
            <span className="flex-none text-[var(--muted)] group-hover:text-[var(--accent)]">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </span>
          </button>
        </div>
        <Button variant="primary" className="flex-none" onPress={() => setAdding(true)}>
          <Plus size={15} /> Add paper
        </Button>
      </div>

      {adding && <AddPaperModal stableId={stableId} onClose={() => setAdding(false)} />}

      {pendingRemoval && (
        <ConfirmModal
          title="Remove paper from project?"
          message={
            <>
              “{pendingRemoval.title}” will be removed from{" "}
              <span className="text-[var(--foreground)]">{project?.name}</span>. It stays in your
              library and any other projects.
            </>
          }
          confirmLabel="Remove"
          onConfirm={() => removeFromProject(pendingRemoval.paperId)}
          onClose={() => setPendingRemoval(null)}
        />
      )}

      {papers.length === 0 ? (
        <p className="mt-8 text-sm text-[var(--muted)]">
          No papers yet. Use “Add paper” to pull from your library or arxiv.
        </p>
      ) : (
        <div className="mt-4 flex flex-col">
          {papers.map((i) => (
            <PaperRow
              key={i.paperId}
              paper={i}
              meta={
                <>
                  {i.authors.slice(0, 3).map((a) => a.name).join(", ")}
                  {i.authors.length > 3 && " et al."}
                  {i.publishedAt && ` · ${i.publishedAt.slice(0, 4)}`}
                  {i.categories[0] && ` · ${i.categories[0]}`}
                </>
              }
              chips={
                <ProjectChips projectIds={(i.projectIds ?? []).filter((p) => p !== stableId)} />
              }
              actions={
                <>
                  {i.links.abs && (
                    <a className={iconLink} href={i.links.abs} target="_blank" rel="noreferrer" aria-label="arXiv">
                      <ArrowUpRight size={16} />
                    </a>
                  )}
                  {i.links.pdf && (
                    <a className={iconLink} href={i.links.pdf} target="_blank" rel="noreferrer" aria-label="Open PDF">
                      <BookOpenText size={16} />
                    </a>
                  )}
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    aria-label="Remove from this project"
                    onPress={() => setPendingRemoval({ paperId: i.paperId, title: i.title })}
                  >
                    <FolderMinus size={16} />
                  </Button>
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
