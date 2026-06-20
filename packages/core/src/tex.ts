// Pure basename so `core` stays isomorphic (no node:path) — it's imported by
// the browser web app as well as the CLI.
function basename(p: string): string {
  const normalized = p.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

export function findMainTexFileByContent(
  files: Map<string, string>
): string | null {
  const texEntries = [...files.entries()].filter(([name]) =>
    name.endsWith(".tex")
  );
  if (texEntries.length === 0) return null;
  if (texEntries.length === 1) return texEntries[0][0];

  for (const [name, content] of texEntries) {
    if (content.includes("\\documentclass")) return name;
  }

  const mainByName = texEntries.find(
    ([name]) => basename(name).toLowerCase() === "main.tex"
  );
  if (mainByName) return mainByName[0];

  return texEntries[0][0];
}

export function stripTexComments(content: string): string {
  return content
    .split("\n")
    .map((line) => {
      const idx = line.search(/(?<!\\)%/);
      if (idx === -1) return line;
      if (idx === 0) return "";
      return line.slice(0, idx);
    })
    .filter((line) => line.trim() !== "")
    .join("\n");
}

export function extractTexBody(content: string): string {
  const beginIdx = content.indexOf("\\begin{document}");
  const endIdx = content.lastIndexOf("\\end{document}");

  if (beginIdx === -1) return content;

  const start = beginIdx + "\\begin{document}".length;
  const end = endIdx === -1 ? content.length : endIdx;

  return content.slice(start, end).trim();
}

export function collectFigurePaths(content: string): string[] {
  const figures: string[] = [];
  const regex = /\\includegraphics(?:\[.*?\])?\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    figures.push(match[1]);
  }
  return figures;
}
