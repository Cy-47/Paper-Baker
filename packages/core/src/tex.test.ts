import { describe, it, expect } from "vitest";
import {
  findMainTexFileByContent,
  stripTexComments,
  extractTexBody,
  collectFigurePaths,
} from "./tex.js";

describe("findMainTexFileByContent", () => {
  it("picks the file containing documentclass", () => {
    const files = new Map([
      ["intro.tex", "Some intro text"],
      ["root.tex", "\\documentclass{article}\\begin{document}hi\\end{document}"],
    ]);
    expect(findMainTexFileByContent(files)).toBe("root.tex");
  });

  it("falls back to main.tex by name when no documentclass", () => {
    const files = new Map([
      ["a.tex", "no class here"],
      ["main.tex", "also no class"],
    ]);
    expect(findMainTexFileByContent(files)).toBe("main.tex");
  });
});

describe("stripTexComments", () => {
  it("removes full and trailing comments but keeps escaped percent", () => {
    const input = "% a comment\nreal text % trailing\n50\\% done";
    expect(stripTexComments(input)).toBe("real text \n50\\% done");
  });
});

describe("extractTexBody", () => {
  it("returns content between document tags", () => {
    const tex =
      "\\documentclass{article}\n\\begin{document}\nHello world\n\\end{document}";
    expect(extractTexBody(tex)).toBe("Hello world");
  });

  it("returns whole content when there is no begin document", () => {
    expect(extractTexBody("\\input{chapter1}")).toBe("\\input{chapter1}");
  });
});

describe("collectFigurePaths", () => {
  it("collects includegraphics targets with and without options", () => {
    const tex =
      "\\includegraphics[width=0.5\\textwidth]{fig1.pdf}\ntext\n\\includegraphics{plots/fig2.png}";
    expect(collectFigurePaths(tex)).toEqual(["fig1.pdf", "plots/fig2.png"]);
  });
});
