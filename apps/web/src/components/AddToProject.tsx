import { useState } from "react";
import { Plus } from "lucide-react";
import { Button, Card, Input, Spinner } from "@heroui/react";
import { arxiv } from "../lib/arxiv";
import { getApiClient } from "../lib/api";
import { useData } from "../hooks/useData";
import { addPaperToProject } from "../lib/library";
import { parseArxivId, type PaperMetadata } from "@paper-baker/core";
import ProjectChips from "./ProjectChips";
import PaperRow from "./PaperRow";
import SaveButton from "./SaveButton";

export default function AddToProject({ stableId }: { stableId: string }) {
  const { library, itemFor, isSaved } = useData();
  const [q, setQ] = useState("");
  const [arxivResults, setArxivResults] = useState<PaperMetadata[]>([]);
  const [searching, setSearching] = useState(false);

  const f = q.trim().toLowerCase();
  const libMatches = f
    ? library
        .filter((i) => !(i.projectIds ?? []).includes(stableId))
        .filter(
          (i) =>
            i.title.toLowerCase().includes(f) ||
            i.authors.some((a) => a.name.toLowerCase().includes(f))
        )
        .slice(0, 5)
    : [];

  const runArxiv = async () => {
    const query = q.trim();
    if (!query) return;
    setSearching(true);
    try {
      // Free-text search via the backend so results warm the papers/ cache; an
      // ID/URL paste stays direct (single paper, cached on save anyway).
      const id = parseArxivId(query);
      const res = id
        ? ([await arxiv.fetchMetadata(id)].filter(Boolean) as PaperMetadata[])
        : await (await getApiClient()).searchPapers(query, 8);
      setArxivResults(res);
    } finally {
      setSearching(false);
    }
  };

  const addExisting = (paperId: string) => {
    const item = itemFor(paperId);
    if (item) addPaperToProject(stableId, item);
  };
  const saveAndAdd = (p: PaperMetadata) => {
    addPaperToProject(stableId, p);
  };

  return (
    <Card className="mt-3">
      <Card.Content>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runArxiv();
          }}
        >
          <Input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search your library or arxiv…"
            fullWidth
          />
        </form>

        {libMatches.length > 0 && (
          <>
            <p className="mb-1 mt-3 text-[11px] text-[var(--muted)]">In your library</p>
            {libMatches.map((i) => (
              <PaperRow
                key={i.paperId}
                paper={i}
                abstract="preview"
                meta={metaLine(i)}
                chips={<ProjectChips projectIds={itemFor(i.paperId)?.projectIds ?? []} />}
                actions={
                  <Button variant="secondary" size="sm" onPress={() => addExisting(i.paperId)}>
                    <Plus size={14} /> Add
                  </Button>
                }
              />
            ))}
          </>
        )}

        {f && (
          <>
            <p className="mb-1 mt-3 flex items-center gap-2 text-[11px] text-[var(--muted)]">
              {searching ? (
                <>
                  <Spinner size="sm" /> Searching arxiv…
                </>
              ) : (
                "From arxiv"
              )}
            </p>
            {arxivResults.map((p) => (
              <PaperRow
                key={p.paperId}
                paper={p}
                abstract="preview"
                meta={metaLine(p)}
                chips={<ProjectChips projectIds={itemFor(p.paperId)?.projectIds ?? []} />}
                actions={<SaveButton saved={isSaved(p.paperId)} onPress={() => saveAndAdd(p)} />}
              />
            ))}
          </>
        )}
      </Card.Content>
    </Card>
  );
}

function metaLine(p: PaperMetadata): string {
  const yr = p.publishedAt ? ` · ${p.publishedAt.slice(0, 4)}` : "";
  return `${p.authors.slice(0, 3).map((a) => a.name).join(", ")}${yr}`;
}
