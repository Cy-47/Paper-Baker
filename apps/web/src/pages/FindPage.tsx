import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BookOpenText, ArrowUpRight } from "lucide-react";
import { Input, Spinner } from "@heroui/react";
import { getApiClient } from "../lib/api";
import { saveToLibrary } from "../lib/library";
import { useData } from "../hooks/useData";
import { useSavePanel } from "../hooks/useSavePanel";
import { parseArxivId, type PaperMetadata } from "@paper-baker/core";
import ProjectChips from "../components/ProjectChips";
import PaperRow from "../components/PaperRow";
import SaveButton from "../components/SaveButton";

const iconLink =
  "inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted)] no-underline hover:bg-[var(--background-secondary)] hover:text-[var(--accent)]";

export default function FindPage() {
  const [params, setParams] = useSearchParams();
  const urlQ = params.get("q") ?? "";
  const [q, setQ] = useState(urlQ);
  const [results, setResults] = useState<PaperMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { isSaved, itemFor } = useData();
  const panel = useSavePanel();

  useEffect(() => {
    setQ(urlQ);
    if (!urlQ.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        // Both paths go through the backend: it has arXiv's User-Agent + the
        // global rate limiter, and warms the shared papers/ cache so a later
        // save/add is a pure cache hit. (The browser can't call arXiv directly —
        // no CORS — and there is no prod proxy for it.) Free text → search; an
        // ID/URL paste → resolve that single paper.
        const id = parseArxivId(urlQ);
        const client = await getApiClient();
        const res = id
          ? [await client.resolvePaper({ type: "arxiv", id })]
          : await client.searchPapers(urlQ, 20);
        if (cancelled) return;
        setResults(res);
        if (!res.length) setError("No papers found.");
      } catch (e) {
        if (!cancelled) setError(`Search failed: ${(e as Error).message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlQ]);

  const onSave = async (p: PaperMetadata) => {
    if (!isSaved(p.paperId)) await saveToLibrary(p);
    panel.open(p);
  };

  return (
    <div>
      <h1 className="text-xl font-medium text-[var(--foreground)]">Find papers</h1>
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(q.trim() ? { q: q.trim() } : {});
        }}
      >
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search arxiv, or paste an ID / URL / DOI"
          fullWidth
        />
      </form>

      {loading && (
        <p className="mt-6 flex items-center gap-2 text-sm text-[var(--muted)]">
          <Spinner size="sm" /> Searching arxiv…
        </p>
      )}
      {error && !loading && <p className="mt-6 text-sm text-[var(--muted)]">{error}</p>}

      <div className="mt-4 flex flex-col">
        {results.map((p) => (
          <PaperRow
            key={p.paperId}
            paper={p}
            abstract="preview"
            meta={
              <>
                {p.authors.slice(0, 4).map((a) => a.name).join(", ")}
                {p.authors.length > 4 && " et al."}
                {p.publishedAt && ` · ${p.publishedAt.slice(0, 4)}`}
                {p.categories[0] && ` · ${p.categories[0]}`}
              </>
            }
            chips={<ProjectChips projectIds={itemFor(p.paperId)?.projectIds ?? []} />}
            actions={
              <>
                {p.links.abs && (
                  <a className={iconLink} href={p.links.abs} target="_blank" rel="noreferrer" aria-label="arXiv">
                    <ArrowUpRight size={16} />
                  </a>
                )}
                {p.links.pdf && (
                  <a className={iconLink} href={p.links.pdf} target="_blank" rel="noreferrer" aria-label="Open PDF">
                    <BookOpenText size={16} />
                  </a>
                )}
                <SaveButton saved={isSaved(p.paperId)} onPress={() => onSave(p)} />
              </>
            }
          />
        ))}
      </div>
    </div>
  );
}
