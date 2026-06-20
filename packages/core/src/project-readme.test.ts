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
  it("renders the guide with the project layout (no papers)", () => {
    const md = generateProjectReadme([]);
    expect(md).toContain("# Paper Baker — Research Papers");
    expect(md).toContain("paperbaker/sources/");
    expect(md).not.toContain("## Papers in This Project");
  });

  it("lists each paper with its source path", () => {
    const md = generateProjectReadme([paper]);
    expect(md).toContain("## Papers in This Project");
    expect(md).toContain("### Attention Is All You Need");
    expect(md).toContain("Ashish Vaswani, Noam Shazeer");
    expect(md).toContain("paperbaker/sources/arxiv-1706.03762/");
    expect(md).toContain("2017-06-12");
  });
});
