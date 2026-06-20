import { describe, it, expect } from "vitest";
import { makePaperId, parseArxivId } from "./types.js";

describe("makePaperId", () => {
  it("builds canonical ids per source type", () => {
    expect(makePaperId({ type: "arxiv", id: "2301.12345" })).toBe(
      "arxiv:2301.12345"
    );
    expect(makePaperId({ type: "doi", id: "10.1/x" })).toBe("doi:10.1/x");
    expect(makePaperId({ type: "manual", id: "abc" })).toBe("manual:abc");
  });
});

describe("parseArxivId", () => {
  it("accepts a bare id", () => {
    expect(parseArxivId("2301.12345")).toBe("2301.12345");
  });

  it("accepts a bare id with version", () => {
    expect(parseArxivId("1706.03762v5")).toBe("1706.03762v5");
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
