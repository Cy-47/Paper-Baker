import { describe, it, expect } from "vitest";
import { arxivSearchParams } from "./arxiv-query.js";

describe("arxivSearchParams", () => {
  it("quotes the whole query as a phrase under all:", () => {
    // Without the quotes arXiv ORs every term and returns hundreds of thousands
    // of loose matches, burying the intended paper. This is the regression guard.
    const p = arxivSearchParams("attention is all you need", 10);
    expect(p.get("search_query")).toBe('all:"attention is all you need"');
  });

  it("sorts by relevance, descending", () => {
    const p = arxivSearchParams("x", 10);
    expect(p.get("sortBy")).toBe("relevance");
    expect(p.get("sortOrder")).toBe("descending");
    expect(p.get("start")).toBe("0");
  });

  it("strips embedded quotes so the phrase stays a valid query", () => {
    const p = arxivSearchParams('foo "bar" baz', 10);
    expect(p.get("search_query")).toBe('all:"foo  bar  baz"');
  });

  it("caps max_results at 50 and floors it at 1", () => {
    expect(arxivSearchParams("x", 1000).get("max_results")).toBe("50");
    expect(arxivSearchParams("x", 0).get("max_results")).toBe("1");
    expect(arxivSearchParams("x", 8).get("max_results")).toBe("8");
  });
});
