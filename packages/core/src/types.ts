export type Source =
  | { type: "arxiv"; id: string }
  | { type: "doi"; id: string }
  | { type: "manual"; id: string };

export interface Author {
  name: string;
  affiliation?: string;
}

export interface PaperMetadata {
  paperId: string;
  source: Source;
  title: string;
  abstract: string;
  authors: Author[];
  publishedAt: string;
  updatedAt?: string;
  categories: string[];
  venue?: string;
  doi?: string;
  links: {
    pdf?: string;
    abs?: string;
    source?: string;
  };
  sourceStatus: "available" | "pdf_only" | "pending" | "failed";
}

/**
 * A user's public profile. The Firebase uid stays the internal key everywhere;
 * `handle` is the public, unique, user-specified alias (the `handle` in
 * `handle/id`) and `displayName` is the shown name. See DESIGN.md §3.2.
 */
export interface UserProfile {
  uid: string;
  handle: string;
  displayName: string;
  createdAt: string;
}

/** Project visibility. Only "private" exists today; sharing adds "public" later. */
export type ProjectVisibility = "private";

export interface Project {
  /**
   * Hidden, server-minted, globally-unique key — the durable Firestore doc id.
   * Plumbing: lives in the CLI's config.json and the doc id, never typed by users.
   */
  stableId: string;
  /**
   * User-facing, owner-unique, renamable identifier — the `id` in `handle/id`,
   * derived from `name`. This is what used to be called `slug`.
   */
  id: string;
  /** Free-form display label. */
  name: string;
  description: string;
  /** Sole source of truth for ownership. */
  ownerUid: string;
  /** Denormalized display copy of the owner's handle (kept in sync off ownerUid). */
  ownerHandle: string;
  /**
   * Everyone with access — just `[ownerUid]` today. Sharing appends member uids
   * here; reads and rules authorize on membership (array-contains), so enabling
   * sharing is additive with no rules change.
   */
  memberUids: string[];
  visibility: ProjectVisibility;
  createdAt: string;
  updatedAt: string;
  paperCount: number;
}

// A user's saved paper — a thin per-user record at
// users/{uid}/savedPapers/{paperId}. Metadata is NOT duplicated here; it lives
// once in the global papers/{paperId} cache, so this doc carries only the id and
// user-specific data (when it was saved). Every projectPaper membership implies a
// savedPapers entry: filing a paper into a project also saves it to the library.
export interface SavedPaper {
  paperId: string;
  savedAt: string;
}

// A paper filed into a project — the single source of truth for the
// project<->paper link. Stored at projects/{stableId}/projectPapers/{paperId}.
// `memberUids` mirrors the parent project's members so the web can read every
// membership in one collectionGroup("projectPapers") query (filtered
// where memberUids array-contains uid), across owned and (later) shared projects;
// `projectStableId` lets that query map each result back to its project without
// walking the doc path.
export interface ProjectPaper {
  paperId: string;
  projectStableId: string;
  memberUids: string[];
  addedAt: string;
}

export interface ProjectManifest {
  stableId: string;
  id: string;
  name: string;
  ownerHandle: string;
  papers: (PaperMetadata & { projectPaper: ProjectPaper })[];
}

export function makePaperId(source: Source): string {
  return `${source.type}:${source.id}`;
}

export function parseArxivId(input: string): string | null {
  const urlMatch = input.match(
    /arxiv\.org\/(?:abs|pdf|e-print)\/(\d{4}\.\d{4,5}(?:v\d+)?)/
  );
  if (urlMatch) return urlMatch[1];

  const bareMatch = input.match(/^(\d{4}\.\d{4,5}(?:v\d+)?)$/);
  if (bareMatch) return bareMatch[1];

  return null;
}
