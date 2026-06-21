import { Link } from "react-router-dom";
import { Search, BookOpenText, ArrowUpRight, LayoutGrid, Bookmark } from "lucide-react";
import { Button, Card } from "@heroui/react";
import { useAuth } from "../hooks/useAuth";
import { useData } from "../hooks/useData";
import PaperRow from "../components/PaperRow";
import ProjectChips from "../components/ProjectChips";

const iconLink =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] no-underline hover:bg-[var(--background-secondary)] hover:text-[var(--accent)]";

export default function HomePage() {
  const { user } = useAuth();
  const { projects, library, countFor } = useData();

  const recentProjects = projects.slice(0, 6);
  const recentPapers = [...library]
    .sort((a, b) => (b.savedAt ?? "").localeCompare(a.savedAt ?? ""))
    .slice(0, 6);

  return (
    <div>
      <h1 className="text-2xl font-medium text-[var(--foreground)]">Home</h1>
      <p className="mt-1 text-sm text-[var(--muted)]">
        Welcome back{user?.displayName ? `, ${user.displayName.split(" ")[0]}` : ""}
      </p>

      <div className="mt-7 flex items-center gap-2 text-xs text-[var(--muted)]">
        <LayoutGrid size={14} /> Projects
      </div>
      {recentProjects.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--muted)]">
          No projects yet — create one from the sidebar.
        </p>
      ) : (
        <div
          className="mt-3 grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))" }}
        >
          {recentProjects.map((p) => (
            <Link key={p.stableId} to={`/projects/${p.stableId}`} className="no-underline">
              <Card>
                <Card.Header>
                  <Card.Title>{p.name}</Card.Title>
                  <Card.Description>{countFor(p.stableId)} papers</Card.Description>
                </Card.Header>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <div className="mt-8 flex items-center gap-2 text-xs text-[var(--muted)]">
        <Bookmark size={14} /> Recently saved
      </div>
      {recentPapers.length === 0 ? (
        <div className="mt-2">
          <p className="text-sm text-[var(--muted)]">Nothing saved yet.</p>
          <Link to="/find" className="mt-3 inline-block no-underline">
            <Button variant="primary">
              <Search size={15} /> Find papers
            </Button>
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex flex-col">
          {recentPapers.map((i) => (
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
              chips={<ProjectChips projectIds={i.projectIds} showEmpty />}
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
                </>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
