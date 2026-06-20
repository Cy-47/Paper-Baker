import { describe, it, expect } from "vitest";
import type { PaperMetadata } from "@paper-baker/core";
import { reconcilePapers, papersInSync } from "./reconcile.js";

function paper(id: string, title = id): PaperMetadata {
  return {
    paperId: id,
    source: { type: "arxiv", id: id.replace("arxiv:", "") },
    title,
    abstract: "",
    authors: [],
    publishedAt: "2020-01-01",
    categories: [],
    links: {},
    sourceStatus: "available",
  };
}

const A = paper("arxiv:1", "A");
const B = paper("arxiv:2", "B");
const C = paper("arxiv:3", "C");
const Bserver = paper("arxiv:2", "B (server title)");

describe("reconcilePapers — replace-local", () => {
  it("takes the remote set wholesale and pushes nothing", () => {
    const r = reconcilePapers([A, B], [B, C], "replace-local");
    expect(r.local).toEqual([B, C]);
    expect(r.toPushToRemote).toEqual([]);
  });
});

describe("reconcilePapers — merge", () => {
  it("unions both sides; remote wins on a shared id", () => {
    const r = reconcilePapers([A, B], [Bserver, C], "merge");
    // remote first (server metadata wins for shared arxiv:2), then local-only A
    expect(r.local.map((p) => p.paperId)).toEqual(["arxiv:2", "arxiv:3", "arxiv:1"]);
    expect(r.local.find((p) => p.paperId === "arxiv:2")!.title).toBe("B (server title)");
  });

  it("reports local-only papers as the push set", () => {
    const r = reconcilePapers([A, B], [B], "merge");
    expect(r.toPushToRemote).toEqual([A]);
  });

  it("pushes nothing when local is a subset of remote", () => {
    const r = reconcilePapers([B], [A, B, C], "merge");
    expect(r.toPushToRemote).toEqual([]);
    expect(r.local.map((p) => p.paperId)).toEqual(["arxiv:1", "arxiv:2", "arxiv:3"]);
  });
});

describe("papersInSync", () => {
  it("is true for the same id set regardless of order or metadata", () => {
    expect(papersInSync([A, B], [Bserver, A])).toBe(true);
  });
  it("is false when sets differ", () => {
    expect(papersInSync([A], [A, B])).toBe(false);
    expect(papersInSync([A, B], [A, C])).toBe(false);
  });
  it("is true for two empty sets", () => {
    expect(papersInSync([], [])).toBe(true);
  });
});
