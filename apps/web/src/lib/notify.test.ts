import { describe, it, expect } from "vitest";
import { errorDetail } from "./notify";

describe("errorDetail", () => {
  it("uses an Error's message", () => {
    expect(errorDetail(new Error("request failed (HTTP 500)"))).toBe(
      "request failed (HTTP 500)"
    );
  });

  it("passes through a non-empty string", () => {
    expect(errorDetail("offline")).toBe("offline");
  });

  it("returns undefined for an empty message (nothing useful to show)", () => {
    expect(errorDetail(new Error(""))).toBeUndefined();
    expect(errorDetail("")).toBeUndefined();
  });

  it("returns undefined for non-Error, non-string values", () => {
    expect(errorDetail(undefined)).toBeUndefined();
    expect(errorDetail(null)).toBeUndefined();
    expect(errorDetail({ code: "x" })).toBeUndefined();
  });
});
