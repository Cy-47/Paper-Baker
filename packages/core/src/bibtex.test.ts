import { describe, it, expect } from "vitest";
import {
  generateCitationKey,
  renderBibtex,
  renderBibtexFile,
} from "./bibtex.js";
import type { PaperMetadata } from "./types.js";

function makePaper(overrides: Partial<PaperMetadata> = {}): PaperMetadata {
  return {
    paperId: "arxiv:1706.03762",
    source: { type: "arxiv", id: "1706.03762" },
    title: "Attention Is All You Need",
    abstract: "The dominant sequence transduction models...",
    authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
    publishedAt: "2017-06-12T00:00:00Z",
    categories: ["cs.CL", "cs.LG"],
    links: { abs: "https://arxiv.org/abs/1706.03762" },
    sourceStatus: "available",
    ...overrides,
  };
}

describe("generateCitationKey", () => {
  it("combines surname + year + first significant title word", () => {
    expect(generateCitationKey(makePaper())).toBe("vaswani2017attention");
  });

  it("skips stop words in the title", () => {
    const key = generateCitationKey(
      makePaper({ title: "On the Measure of Intelligence" })
    );
    expect(key).toBe("vaswani2017measure");
  });

  it("falls back to a sanitized id when there are no authors", () => {
    const key = generateCitationKey(makePaper({ authors: [] }));
    expect(key).toBe("arxiv170603762");
  });
});

describe("renderBibtex", () => {
  it("renders an article entry with arxiv eprint fields", () => {
    const bib = renderBibtex(makePaper());
    expect(bib).toContain("@article{vaswani2017attention,");
    expect(bib).toContain("title = {Attention Is All You Need}");
    expect(bib).toContain("author = {Ashish Vaswani and Noam Shazeer}");
    expect(bib).toContain("year = {2017}");
    expect(bib).toContain("eprint = {1706.03762}");
    expect(bib).toContain("archiveprefix = {arXiv}");
    expect(bib).toContain("primaryclass = {cs.CL}");
  });

  it("renders inproceedings when a venue is present", () => {
    const bib = renderBibtex(makePaper({ venue: "NeurIPS 2017" }));
    expect(bib).toContain("@inproceedings{");
    expect(bib).toContain("booktitle = {NeurIPS 2017}");
  });
});

describe("renderBibtexFile", () => {
  it("produces unique keys for papers that collide", () => {
    const a = makePaper();
    const b = makePaper({
      paperId: "arxiv:9999.99999",
      source: { type: "arxiv", id: "9999.99999" },
    });
    const file = renderBibtexFile([a, b]);
    const keys = [...file.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
