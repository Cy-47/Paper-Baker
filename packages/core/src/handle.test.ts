import { describe, it, expect } from "vitest";
import {
  normalizeHandle,
  isValidHandle,
  isReservedHandle,
  HANDLE_MAX_LENGTH,
} from "./handle.js";

describe("normalizeHandle", () => {
  it("lowercases and trims", () => {
    expect(normalizeHandle("  Alice ")).toBe("alice");
    expect(normalizeHandle("CY-47")).toBe("cy-47");
  });
});

describe("isValidHandle", () => {
  it("accepts alphanumerics and single internal hyphens", () => {
    expect(isValidHandle("alice")).toBe(true);
    expect(isValidHandle("cy-47")).toBe(true);
    expect(isValidHandle("a1b2c3")).toBe(true);
  });

  it("rejects leading/trailing/consecutive hyphens", () => {
    expect(isValidHandle("-alice")).toBe(false);
    expect(isValidHandle("alice-")).toBe(false);
    expect(isValidHandle("al--ice")).toBe(false);
  });

  it("rejects out-of-charset characters (incl. non-normalized input)", () => {
    expect(isValidHandle("alice_b")).toBe(false);
    expect(isValidHandle("alice.b")).toBe(false);
    expect(isValidHandle("Alice")).toBe(false); // must be normalized (lowercase) first
    expect(isValidHandle("café")).toBe(false);
    expect(isValidHandle("a b")).toBe(false);
  });

  it("enforces length bounds", () => {
    expect(isValidHandle("ab")).toBe(false); // < 3
    expect(isValidHandle("abc")).toBe(true);
    expect(isValidHandle("a".repeat(HANDLE_MAX_LENGTH))).toBe(true);
    expect(isValidHandle("a".repeat(HANDLE_MAX_LENGTH + 1))).toBe(false);
  });
});

describe("isReservedHandle", () => {
  it("flags reserved route-colliding handles (normalizing first)", () => {
    expect(isReservedHandle("api")).toBe(true);
    expect(isReservedHandle("Settings")).toBe(true);
    expect(isReservedHandle(" home ")).toBe(true);
  });

  it("allows ordinary handles", () => {
    expect(isReservedHandle("alice")).toBe(false);
    expect(isReservedHandle("cy-47")).toBe(false);
  });
});
