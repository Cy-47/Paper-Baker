import type { PaperMetadata } from "@paper-baker/core";

export interface PaperProvider {
  name: string;
  search(query: string, maxResults?: number): Promise<PaperMetadata[]>;
  fetchMetadata(id: string): Promise<PaperMetadata | null>;
}
