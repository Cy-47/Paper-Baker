// The CLI documentation is the single source of truth shared with the in-repo
// guide: `generateProjectReadme` in @paper-baker/core generates both. Here we
// render it with no papers (the generic reference); the CLI writes the same text
// into each project's paperbaker/README.md with that project's papers appended.
import { generateProjectReadme } from "@paper-baker/core";
import { DocsChrome } from "../components/DocsChrome";
import { Markdown } from "../components/Markdown";

const cliDocs = generateProjectReadme([]);

export default function CliDocsPage() {
  return (
    <DocsChrome>
      <Markdown>{cliDocs}</Markdown>
    </DocsChrome>
  );
}
