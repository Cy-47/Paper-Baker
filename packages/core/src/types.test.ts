import { describe, it, expect } from "vitest";
import { makePaperId, paperDocId, parseArxivId } from "./types.js";

describe("makePaperId", () => {
  it("builds canonical ids per source type", () => {
    expect(makePaperId({ type: "arxiv", id: "2301.12345" })).toBe(
      "arxiv:2301.12345"
    );
    expect(makePaperId({ type: "doi", id: "10.1/x" })).toBe("doi:10.1/x");
    expect(makePaperId({ type: "manual", id: "abc" })).toBe("manual:abc");
  });
});

describe("paperDocId", () => {
  it("leaves new-style ids untouched so existing cached docs keep their keys", () => {
    expect(paperDocId("arxiv:2301.12345")).toBe("arxiv:2301.12345");
    expect(paperDocId("arxiv:1706.03762v5")).toBe("arxiv:1706.03762v5");
  });

  it("replaces the slash in classic arXiv ids that Firestore reads as a path separator", () => {
    expect(paperDocId("arxiv:hep-ph/0607008")).toBe("arxiv:hep-ph_0607008");
    expect(paperDocId("arxiv:math.GT/0309136")).toBe("arxiv:math.GT_0309136");
  });

  it("keeps the `:` separator (unlike encodeURIComponent) so new-style keys are stable", () => {
    expect(paperDocId("arxiv:2301.12345")).not.toContain("%");
    expect(paperDocId("arxiv:2301.12345")).toContain(":");
  });

  it("replaces every slash (e.g. a doi id with multiple segments)", () => {
    expect(paperDocId("doi:10.1/a/b")).toBe("doi:10.1_a_b");
  });
});

describe("parseArxivId", () => {
  it("accepts a bare id", () => {
    expect(parseArxivId("2301.12345")).toBe("2301.12345");
  });

  it("accepts a bare id with version", () => {
    expect(parseArxivId("1706.03762v5")).toBe("1706.03762v5");
  });

  it("accepts an arxiv: prefixed id (as printed by `pb search`)", () => {
    expect(parseArxivId("arxiv:2602.21841")).toBe("2602.21841");
    expect(parseArxivId("arxiv:1706.03762v5")).toBe("1706.03762v5");
  });

  it("extracts from abs/pdf/e-print URLs", () => {
    expect(parseArxivId("https://arxiv.org/abs/2301.12345")).toBe("2301.12345");
    expect(parseArxivId("https://arxiv.org/pdf/2301.12345")).toBe("2301.12345");
    expect(parseArxivId("http://arxiv.org/e-print/1706.03762v2")).toBe(
      "1706.03762v2"
    );
  });

  it("returns null for non-arxiv input", () => {
    expect(parseArxivId("not an id")).toBeNull();
    expect(parseArxivId("10.1145/12345")).toBeNull();
    expect(parseArxivId("")).toBeNull();
  });
});
