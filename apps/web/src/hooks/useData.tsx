import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./useAuth";
import type { PaperMetadata } from "@paper-baker/core";
import {
  subscribeSavedPapers,
  subscribeProjects,
  subscribeMemberships,
  getPaperMeta,
  type LibraryItem,
  type SavedRecord,
  type ProjectDoc,
  type Membership,
} from "../lib/library";
import { notifyError } from "../lib/notify";

interface DataCtx {
  library: LibraryItem[];
  projects: ProjectDoc[];
  loading: boolean;
  isSaved: (paperId: string) => boolean;
  itemFor: (paperId: string) => LibraryItem | undefined;
  countFor: (stableId: string) => number;
  papersIn: (stableId: string) => LibraryItem[];
}

const Ctx = createContext<DataCtx | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [saved, setSaved] = useState<SavedRecord[]>([]);
  const [projects, setProjects] = useState<ProjectDoc[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [meta, setMeta] = useState<Map<string, PaperMetadata>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    let got = 0;
    const done = () => {
      got += 1;
      if (got >= 3) setLoading(false);
    };
    // A listener error (e.g. a missing index or revoked access) must surface AND
    // release the loading gate — otherwise one failed subscription wedges the app
    // on "Loading…" forever, which is exactly how the prod index bug presented.
    const onErr = (what: string) => (e: Error) => {
      notifyError(`Couldn't load your ${what}`, e);
      done();
    };
    const unsubSaved = subscribeSavedPapers((s) => {
      setSaved(s);
      done();
    }, onErr("library"));
    const unsubProj = subscribeProjects((p) => {
      setProjects(p);
      done();
    }, onErr("projects"));
    const unsubMembers = subscribeMemberships((m) => {
      setMemberships(m);
      done();
    }, onErr("projects"));
    return () => {
      unsubSaved();
      unsubProj();
      unsubMembers();
    };
  }, [user]);

  // The paperIds we need metadata for: everything saved, plus any membership's
  // paper (the projectPaper ⊆ savedPapers invariant means these usually overlap).
  const neededIds = useMemo(() => {
    const ids = new Set<string>();
    saved.forEach((s) => ids.add(s.paperId));
    memberships.forEach((m) => ids.add(m.paperId));
    return ids;
  }, [saved, memberships]);

  // Lazily fetch metadata from the global papers/ cache for ids we haven't seen.
  // papers/{id} is effectively immutable once resolved, so a one-shot fetch per
  // id (cached) is enough — no need to keep a live listener on each.
  useEffect(() => {
    const missing = [...neededIds].filter((id) => !meta.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      // A single failed metadata read shouldn't reject the whole batch (and
      // become an unhandled rejection); degrade that one row to null instead.
      missing.map(
        async (id) =>
          [id, await getPaperMeta(id).catch(() => null)] as const
      )
    ).then((pairs) => {
      if (cancelled) return;
      setMeta((prev) => {
        const next = new Map(prev);
        for (const [id, m] of pairs) if (m) next.set(id, m);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [neededIds, meta]);

  const value = useMemo<DataCtx>(() => {
    // projectPapers memberships are the source of truth; fold them into a
    // paperId -> project stableIds map and attach to each library item, so the
    // rest of the app reads item.projectIds (stableIds) without any stored
    // (divergeable) array.
    const projectIdsByPaper = new Map<string, string[]>();
    for (const m of memberships) {
      const list = projectIdsByPaper.get(m.paperId);
      if (list) list.push(m.projectStableId);
      else projectIdsByPaper.set(m.paperId, [m.projectStableId]);
    }
    // Compose each saved record with its metadata. Items whose metadata hasn't
    // loaded yet are held back (rather than rendering a blank row).
    const library: LibraryItem[] = [];
    for (const s of saved) {
      const m = meta.get(s.paperId);
      if (!m) continue;
      library.push({
        ...m,
        paperId: s.paperId,
        savedAt: s.savedAt,
        projectIds: projectIdsByPaper.get(s.paperId) ?? [],
      });
    }

    // `isSaved` reflects the saved set directly, so it's correct even before a
    // paper's metadata has finished loading.
    const savedIds = new Set(saved.map((s) => s.paperId));
    const byId = new Map(library.map((i) => [i.paperId, i]));
    return {
      library,
      projects,
      loading,
      isSaved: (id) => savedIds.has(id),
      itemFor: (id) => byId.get(id),
      countFor: (stableId) =>
        library.filter((i) => i.projectIds.includes(stableId)).length,
      papersIn: (stableId) =>
        library.filter((i) => i.projectIds.includes(stableId)),
    };
  }, [saved, projects, memberships, meta, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useData(): DataCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
