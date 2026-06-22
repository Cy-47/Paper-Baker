import type {
  Source,
  PaperMetadata,
  Project,
  ProjectManifest,
  UserProfile,
} from "@paper-baker/core";

/** The caller's profile; `handle`/`displayName` are null before onboarding. */
export type Me =
  | UserProfile
  | { uid: string; handle: null; displayName: null };

export interface ApiClientConfig {
  baseUrl: string;
  token?: string; // Firebase ID token or API key
}

/**
 * Thrown for any non-2xx response. Carries the HTTP `status` so callers can
 * distinguish expected outcomes from real failures — e.g. a 404 from
 * resolvePaper means "arXiv has no such paper" (an empty result), not an error
 * to surface. `message` keeps the backend's `{ error }` text plus "(HTTP NNN)".
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export class PaperBakerClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: ApiClientConfig) {
    // Strip trailing slash for consistent URL joining
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.token = config.token;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const url = `${this.baseUrl}${path}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Surface the backend's `{ error }` message when present (e.g. "This CLI
      // connection has been revoked"); fall back to the raw body or status.
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === "string") detail = parsed.error;
      } catch {
        /* non-JSON body — keep the raw text */
      }
      throw new ApiError(res.status, `${detail || "request failed"} (HTTP ${res.status})`);
    }

    // 204 No Content — nothing to parse
    if (res.status === 204) {
      return undefined as T;
    }

    return (await res.json()) as T;
  }

  // ---------------------------------------------------------------------------
  // Papers
  // ---------------------------------------------------------------------------

  async resolvePaper(source: Source): Promise<PaperMetadata> {
    return this.request<PaperMetadata>("POST", "/papers", { source });
  }

  async getPaper(paperId: string): Promise<PaperMetadata> {
    return this.request<PaperMetadata>(
      "GET",
      `/papers/${encodeURIComponent(paperId)}`,
    );
  }

  async searchPapers(
    query: string,
    maxResults?: number,
  ): Promise<PaperMetadata[]> {
    const params = new URLSearchParams({ q: query });
    if (maxResults !== undefined) {
      params.set("maxResults", String(maxResults));
    }
    return this.request<PaperMetadata[]>(
      "GET",
      `/papers/search?${params.toString()}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  /** List the projects the caller is a member of (owned + shared). */
  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/projects");
  }

  /** Fetch a single project by its global stable key. */
  async getProject(stableId: string): Promise<Project> {
    return this.request<Project>(
      "GET",
      `/projects/${encodeURIComponent(stableId)}`,
    );
  }

  /** Resolve one of the caller's own projects by its user-facing id. */
  async getMyProjectById(id: string): Promise<Project> {
    return this.request<Project>(
      "GET",
      `/projects/lookup/${encodeURIComponent(id)}`,
    );
  }

  /** Resolve a project by its `handle/id` remote coordinate (membership-gated). */
  async getProjectByHandle(handle: string, id: string): Promise<Project> {
    return this.request<Project>(
      "GET",
      `/projects/lookup/${encodeURIComponent(handle)}/${encodeURIComponent(id)}`,
    );
  }

  /** Create a project; the server mints the global stableId + an owner-unique id. */
  async createProject(name: string, description?: string): Promise<Project> {
    return this.request<Project>("POST", "/projects", { name, description });
  }

  async updateProject(
    stableId: string,
    updates: Partial<Pick<Project, "name" | "description">>,
  ): Promise<Project> {
    return this.request<Project>(
      "PATCH",
      `/projects/${encodeURIComponent(stableId)}`,
      updates,
    );
  }

  async deleteProject(stableId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/projects/${encodeURIComponent(stableId)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Identity (the caller's profile + public handle lookup)
  // ---------------------------------------------------------------------------

  /** The caller's profile (handle/displayName are null before onboarding). */
  async getMe(): Promise<Me> {
    return this.request<Me>("GET", "/me");
  }

  /** Claim/update the caller's handle and/or display name. */
  async updateMe(updates: { handle?: string; displayName?: string }): Promise<UserProfile> {
    return this.request<UserProfile>("PUT", "/me", updates);
  }

  /** Public profile lookup by handle. */
  async getUserByHandle(handle: string): Promise<UserProfile> {
    return this.request<UserProfile>(
      "GET",
      `/users/${encodeURIComponent(handle)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Project papers
  // ---------------------------------------------------------------------------

  async addPaperToProject(stableId: string, paperId: string): Promise<void> {
    return this.request<void>(
      "POST",
      `/projects/${encodeURIComponent(stableId)}/papers`,
      { paperId },
    );
  }

  async removePaperFromProject(stableId: string, paperId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/projects/${encodeURIComponent(stableId)}/papers/${encodeURIComponent(paperId)}`,
    );
  }

  async getProjectManifest(stableId: string): Promise<ProjectManifest> {
    return this.request<ProjectManifest>(
      "GET",
      `/projects/${encodeURIComponent(stableId)}/manifest`,
    );
  }

  // ---------------------------------------------------------------------------
  // Library (a user's saved papers)
  // ---------------------------------------------------------------------------

  /** Save a paper to the library: resolves its metadata into papers/, then the thin record. */
  async saveToLibrary(source: Source): Promise<{ paperId: string; savedAt: string }> {
    return this.request("POST", "/library", { source });
  }

  /** Unsave a paper (also unfiles it from every project). */
  async removeFromLibrary(paperId: string): Promise<void> {
    return this.request<void>("DELETE", `/library/${encodeURIComponent(paperId)}`);
  }

  // ---------------------------------------------------------------------------
  // Connected CLIs (the web "CLI" tab)
  // ---------------------------------------------------------------------------

  /** Delete a connection: forgets it and rejects the CLI's next call. */
  async deleteConnection(connectionId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/device/connections/${encodeURIComponent(connectionId)}`,
    );
  }
}
