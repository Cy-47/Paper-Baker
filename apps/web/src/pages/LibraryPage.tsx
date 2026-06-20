import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search, BookOpenText, ArrowUpRight, FolderPlus, Trash2 } from "lucide-react";
import { Button, Input, Chip } from "@heroui/react";
import { useData } from "../hooks/useData";
import { useSavePanel } from "../hooks/useSavePanel";
import { removeFromLibrary } from "../lib/library";
import PaperRow from "../components/PaperRow";
import ProjectChips from "../components/ProjectChips";

const iconLink =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] no-underline hover:bg-[var(--background-secondary)] hover:text-[var(--accent)]";

export default function LibraryPage() {
  const { library, projects } = useData();
  const panel = useSavePanel();
  const [filter, setFilter] = useState("");
  const nameOf = useMemo(
    () => new Map(projects.map((p) => [p.projectId, p.name])),
    [projects]
  );

  const f = filter.trim().toLowerCase();
  const items = f
    ? library.filter(
        (i) =>
          i.title.toLowerCase().includes(f) ||
          i.authors.some((a) => a.name.toLowerCase().includes(f)) ||
          (i.projectIds ?? []).some((id) =>
            (nameOf.get(id) ?? "").toLowerCase().includes(f)
          )
      )
    : library;

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-medium text-[var(--foreground)]">Library</h1>
        <Chip size="sm" variant="soft">
          {library.length} saved
        </Chip>
      </div>

      <div className="mt-3">
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter library by title, author, or project…"
          fullWidth
        />
      </div>

      {library.length === 0 ? (
        <div className="mt-10 text-center">
          <p className="text-sm text-[var(--muted)]">Your library is empty.</p>
          <Link to="/find" className="mt-4 inline-block no-underline">
            <Button variant="primary">
              <Search size={15} /> Find papers
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-4 flex flex-col">
          {items.map((i) => (
            <PaperRow
              key={i.paperId}
              paper={i}
              meta={
                <>
                  {i.authors.slice(0, 3).map((a) => a.name).join(", ")}
                  {i.authors.length > 3 && " et al."}
                  {i.publishedAt && ` · ${i.publishedAt.slice(0, 4)}`}
                </>
              }
              chips={<ProjectChips projectIds={i.projectIds ?? []} showEmpty />}
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
                    aria-label="Add to project"
                    onPress={() => panel.open(i)}
                  >
                    <FolderPlus size={16} />
                  </Button>
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    aria-label="Remove"
                    onPress={() => removeFromLibrary(i.paperId)}
                  >
                    <Trash2 size={16} />
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
