import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Plus, BookOpenText, ArrowUpRight, FolderMinus, Pencil } from "lucide-react";
import { Button } from "@heroui/react";
import { useData } from "../hooks/useData";
import { removePaperFromProject, renameProject } from "../lib/library";
import AddPaperModal from "../components/AddPaperModal";
import PaperRow from "../components/PaperRow";
import ProjectChips from "../components/ProjectChips";

const iconLink =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] no-underline hover:bg-[var(--background-secondary)] hover:text-[var(--accent)]";

export default function ProjectPage() {
  const { id = "" } = useParams();
  const { projects, papersIn, loading } = useData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const project = projects.find((p) => p.projectId === id);
  const papers = papersIn(id);

  const startRename = () => {
    setDraft(project?.name ?? "");
    setEditing(true);
  };

  const saveRename = async () => {
    const name = draft.trim();
    if (name && name !== project?.name) await renameProject(id, name);
    setEditing(false);
  };

  if (!project && !loading) {
    return (
      <div className="mt-10 text-center">
        <p className="text-sm text-[var(--muted)]">Project not found.</p>
        <Link to="/" className="mt-4 inline-block no-underline">
          <Button variant="secondary">Back to Home</Button>
        </Link>
      </div>
    );
  }

  const removeFromProject = (paperId: string) => {
    removePaperFromProject(id, paperId);
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
        </div>
        <Button variant="primary" className="flex-none" onPress={() => setAdding(true)}>
          <Plus size={15} /> Add paper
        </Button>
      </div>

      {adding && <AddPaperModal projectId={id} onClose={() => setAdding(false)} />}

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
                <ProjectChips projectIds={(i.projectIds ?? []).filter((p) => p !== id)} />
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
                    onPress={() => removeFromProject(i.paperId)}
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
