import type {
  Source,
  PaperMetadata,
  Project,
  ProjectManifest,
} from "@paper-baker/core";

export interface ApiClientConfig {
  baseUrl: string;
  token?: string; // Firebase ID token or API key
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
      throw new Error(`${detail || "request failed"} (HTTP ${res.status})`);
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

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>("GET", "/projects");
  }

  /** Fetch a single project by its stable id or its slug. */
  async getProject(idOrSlug: string): Promise<Project> {
    return this.request<Project>(
      "GET",
      `/projects/${encodeURIComponent(idOrSlug)}`,
    );
  }

  async createProject(
    name: string,
    description?: string,
  ): Promise<Project> {
    return this.request<Project>("POST", "/projects", { name, description });
  }

  /**
   * Idempotent create-with-id: ensure a project with this client-owned stable id
   * exists under the caller's account, creating it (with a fresh unique slug) if
   * absent. Used by `pb sync` to publish an offline project and to mirror an
   * already-synced one onto a new account. Safe to call on every sync.
   */
  async putProject(
    projectId: string,
    name: string,
    description?: string,
  ): Promise<Project> {
    return this.request<Project>(
      "PUT",
      `/projects/${encodeURIComponent(projectId)}`,
      { name, description },
    );
  }

  async updateProject(
    projectId: string,
    updates: Partial<Pick<Project, "name" | "description">>,
  ): Promise<Project> {
    return this.request<Project>(
      "PATCH",
      `/projects/${encodeURIComponent(projectId)}`,
      updates,
    );
  }

  async deleteProject(projectId: string): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/projects/${encodeURIComponent(projectId)}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Project papers
  // ---------------------------------------------------------------------------

  async addPaperToProject(
    projectId: string,
    paperId: string,
  ): Promise<void> {
    return this.request<void>(
      "POST",
      `/projects/${encodeURIComponent(projectId)}/papers`,
      { paperId },
    );
  }

  async removePaperFromProject(
    projectId: string,
    paperId: string,
  ): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}`,
    );
  }

  async getProjectManifest(projectId: string): Promise<ProjectManifest> {
    return this.request<ProjectManifest>(
      "GET",
      `/projects/${encodeURIComponent(projectId)}/manifest`,
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
