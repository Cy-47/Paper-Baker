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
