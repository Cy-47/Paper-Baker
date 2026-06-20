import { describe, it, expect } from "vitest";
import { ArxivProvider } from "./arxiv.js";

// Hits the live arxiv API — verifies search + metadata fetch + parsing as one
// pipeline (the exact path the web Add Paper modal and the CLI both use).
describe("ArxivProvider (live arxiv)", () => {
  const arxiv = new ArxivProvider();

  it("searches by keyword and returns parsed papers", async () => {
    const results = await arxiv.search("attention is all you need", 5);
    expect(results.length).toBeGreaterThan(0);
    for (const p of results) {
      expect(p.paperId).toMatch(/^arxiv:/);
      expect(p.title.length).toBeGreaterThan(0);
      expect(Array.isArray(p.authors)).toBe(true);
    }
  }, 30_000);

  it("ranks the matching paper into the results (relevance, not OR-of-words)", async () => {
    // Regression guard: an unquoted multi-word query made arxiv OR every term
    // and bury this paper. The exact title must appear for a title search.
    const results = await arxiv.search("attention is all you need", 10);
    const titles = results.map((p) => p.title.toLowerCase());
    expect(titles).toContain("attention is all you need");
  }, 30_000);

  it("fetches a known paper by id", async () => {
    const paper = await arxiv.fetchMetadata("1706.03762");
    expect(paper).not.toBeNull();
    expect(paper!.title).toMatch(/Attention Is All You Need/i);
    expect(paper!.authors[0].name).toMatch(/Vaswani/);
  }, 30_000);

  it("returns null for a nonexistent id", async () => {
    const paper = await arxiv.fetchMetadata("0000.00000");
    expect(paper).toBeNull();
  }, 30_000);
});
