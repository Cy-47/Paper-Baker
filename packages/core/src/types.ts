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

export interface Project {
  projectId: string;
  /** URL-safe handle derived from `name`, unique within the owner. */
  slug: string;
  name: string;
  description: string;
  ownerUid: string;
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
// project<->paper link. Stored at users/{uid}/projects/{projectId}/projectPapers/
// {paperId}. `ownerUid` is denormalized so the web can read every membership in
// one collectionGroup("projectPapers") query (filtered where ownerUid == uid);
// `projectId` lets that query map each result back to its project without
// walking the doc path.
export interface ProjectPaper {
  paperId: string;
  projectId: string;
  ownerUid: string;
  addedAt: string;
}

export interface ProjectManifest {
  projectId: string;
  slug: string;
  name: string;
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
