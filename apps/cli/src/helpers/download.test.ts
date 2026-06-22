import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PaperMetadata } from "@paper-baker/core";
import { downloadSources } from "./download.js";

function paper(id: string): PaperMetadata {
  return {
    paperId: `arxiv:${id}`,
    source: { type: "arxiv", id },
    title: id,
    abstract: "",
    authors: [],
    publishedAt: "2020-01-01",
    categories: [],
    links: {},
    sourceStatus: "available",
  };
}

describe("downloadSources", () => {
  let logs: string[];
  let errs: string[];
  let warns: string[];

  beforeEach(() => {
    logs = [];
    errs = [];
    warns = [];
    vi.spyOn(console, "log").mockImplementation((m) => void logs.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m) => void errs.push(String(m)));
    vi.spyOn(console, "warn").mockImplementation((m) => void warns.push(String(m)));
  });
  afterEach(() => vi.restoreAllMocks());

  it("downloads only the papers missing a source, with a counted progress line", async () => {
    const A = paper("1");
    const B = paper("2"); // already has a source
    const C = paper("3");
    const download = vi.fn(async () => {});
    const hasSource = (p: PaperMetadata) => p.paperId === "arxiv:2";

    const res = await downloadSources([A, B, C], { download, hasSource });

    expect(res).toEqual({ downloaded: 2, failed: [] });
    expect(download).toHaveBeenCalledTimes(2);
    // Counter is over the pending set (2), not the whole list (3).
    expect(logs).toContain("Downloading sources… 1/2: arxiv:1");
    expect(logs).toContain("Downloading sources… 2/2: arxiv:3");
    expect(logs).toContain("Downloaded 2 source(s).");
  });

  it("marks a failed paper pdf_only, warns, and keeps going", async () => {
    const A = paper("1");
    const B = paper("2");
    const download = vi.fn(async (id: string) => {
      if (id === "1") throw new Error("boom");
    });

    const res = await downloadSources([A, B], { download, hasSource: () => false });

    expect(res.downloaded).toBe(1);
    expect(res.failed).toEqual(["arxiv:1"]);
    expect(A.sourceStatus).toBe("pdf_only");
    expect(B.sourceStatus).toBe("available");
    expect(warns.some((w) => w.includes("arxiv:1") && w.includes("keeping metadata only"))).toBe(true);
  });

  it("skips non-arxiv sources entirely", async () => {
    const nonArxiv = { ...paper("x"), source: { type: "manual" as const, id: "x" } } as unknown as PaperMetadata;
    const download = vi.fn(async () => {});

    const res = await downloadSources([nonArxiv], { download, hasSource: () => false });

    expect(res).toEqual({ downloaded: 0, failed: [] });
    expect(download).not.toHaveBeenCalled();
  });

  it("is silent on a no-work pass", async () => {
    const A = paper("1");
    const download = vi.fn(async () => {});

    const res = await downloadSources([A], { download, hasSource: () => true });

    expect(res).toEqual({ downloaded: 0, failed: [] });
    expect(logs).toEqual([]);
    expect(errs).toEqual([]);
  });

  it("quiet mode routes progress to stderr, leaving stdout clean", async () => {
    const A = paper("1");
    const download = vi.fn(async () => {});

    await downloadSources([A], { quiet: true, download, hasSource: () => false });

    expect(logs).toEqual([]); // stdout stays clean for --json consumers
    expect(errs).toContain("Downloading sources… 1/1: arxiv:1");
    expect(errs).toContain("Downloaded 1 source(s).");
  });
});
