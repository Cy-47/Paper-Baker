import { describe, it, expect } from "vitest";
import { generateRootBrief, ROOT_BRIEF_BEGIN, ROOT_BRIEF_END } from "./agent-brief.js";

describe("generateRootBrief", () => {
  const block = generateRootBrief();

  it("is wrapped in the BEGIN/END markers", () => {
    expect(block.startsWith(ROOT_BRIEF_BEGIN)).toBe(true);
    expect(block.trimEnd().endsWith(ROOT_BRIEF_END)).toBe(true);
  });

  it("points at the project layout the CLI writes", () => {
    expect(block).toContain("paperbaker/sources/");
    expect(block).toContain("paperbaker/README.md");
    expect(block).toContain("paper-baker.web.app");
  });
});
