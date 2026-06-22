import { describe, it, expect } from "vitest";
import type { PaperMetadata } from "./types.js";
import { generateProjectReadme, sourceDirName } from "./project-readme.js";

const paper: PaperMetadata = {
  paperId: "arxiv:1706.03762",
  source: { type: "arxiv", id: "1706.03762" },
  title: "Attention Is All You Need",
  abstract: "…",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  publishedAt: "2017-06-12T00:00:00Z",
  categories: ["cs.CL"],
  links: {},
  sourceStatus: "available",
};

describe("sourceDirName", () => {
  it("prefixes arxiv ids", () => {
    expect(sourceDirName(paper)).toBe("arxiv-1706.03762");
  });
  it("sanitizes the colon for non-arxiv ids", () => {
    expect(sourceDirName({ ...paper, source: { type: "manual", id: "x" }, paperId: "manual:x" })).toBe(
      "manual-x",
    );
  });
});

describe("generateProjectReadme", () => {
  it("renders the CLI guide; with no papers it's the generic website reference", () => {
    const md = generateProjectReadme([]);
    expect(md).toContain("# Paper Baker CLI");
    expect(md).toContain("paperbaker/sources/");
    // Reading guidance frames sources as code, not a single main.tex.
    expect(md).toContain("Read and search");
    expect(md).not.toMatch(/main\.tex.*entry point|entry point.*main\.tex/i);
    // Variadic + concat-only behaviors are documented.
    expect(md).toContain("pb add <id-or-url...>");
    expect(md).toContain("every `.tex` file");
    // No project-specific section when there are no papers.
    expect(md).not.toContain("## Papers in this project");
  });

  it("appends the project's own paper list when papers are present", () => {
    const md = generateProjectReadme([paper]);
    expect(md).toContain("## Papers in this project");
    expect(md).toContain("### Attention Is All You Need");
    expect(md).toContain("Ashish Vaswani, Noam Shazeer");
    expect(md).toContain("paperbaker/sources/arxiv-1706.03762/");
    expect(md).toContain("2017-06-12");
  });
});
