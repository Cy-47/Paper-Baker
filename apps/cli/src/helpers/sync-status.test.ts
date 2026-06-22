import { describe, it, expect } from "vitest";
import { ApiError } from "@paper-baker/api-client";
import { classifyProjectSyncError, syncFailureMessage } from "./sync-status.js";

describe("classifyProjectSyncError", () => {
  it("maps 401 to auth", () => {
    expect(classifyProjectSyncError(new ApiError(401, "Invalid or expired token (HTTP 401)"))).toBe(
      "auth",
    );
  });

  it("maps a 404 'Project not found' to no-access", () => {
    expect(classifyProjectSyncError(new ApiError(404, "Project not found (HTTP 404)"))).toBe(
      "no-access",
    );
  });

  it("does NOT treat a 404 'Paper not found' as no-access (uncached paper / transient)", () => {
    expect(
      classifyProjectSyncError(
        new ApiError(404, "Paper not found. Resolve it first via the papers API. (HTTP 404)"),
      ),
    ).toBe("transient");
  });

  it("maps other server errors (5xx) to transient", () => {
    expect(classifyProjectSyncError(new ApiError(500, "Internal server error (HTTP 500)"))).toBe(
      "transient",
    );
  });

  it("maps non-ApiError failures (network, unknown) to transient", () => {
    expect(classifyProjectSyncError(new Error("fetch failed"))).toBe("transient");
    expect(classifyProjectSyncError("nope")).toBe("transient");
  });
});

describe("syncFailureMessage", () => {
  it("no-access states both possibilities and offers all three remedies, with no self-narration", () => {
    const msg = syncFailureMessage("no-access", "Added locally, but not synced");
    expect(msg).toContain("Added locally, but not synced");
    // The existence-hiding disjunction must be present (and identical regardless
    // of which case actually occurred).
    expect(msg).toContain("doesn't exist, or you");
    expect(msg).toContain("don't have access to it");
    // Three remedies.
    expect(msg).toContain("ask the owner to invite you");
    expect(msg).toContain("pb unbind && pb sync");
    expect(msg).toContain("pb bind <handle/id>");
    // No narration of the CLI's own knowledge.
    expect(msg).not.toMatch(/can't tell|cannot tell|Paper Baker (can't|cannot)/i);
  });

  it("auth points at pb login", () => {
    const msg = syncFailureMessage("auth", "Added locally, but not synced");
    expect(msg).toContain("pb login");
  });

  it("transient points at pb sync retry", () => {
    const msg = syncFailureMessage("transient", "Couldn't sync");
    expect(msg).toContain("pb sync");
  });

  it("uses the caller's lead verbatim", () => {
    expect(syncFailureMessage("transient", "Removed locally, but not synced")).toMatch(
      /^Removed locally, but not synced/,
    );
  });
});
