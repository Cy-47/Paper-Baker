// The CLI documentation is authored as markdown in content/cli-docs.md and
// inlined at build time via Vite's `?raw` suffix, then rendered with our themed
// Markdown component.
import cliDocs from "../content/cli-docs.md?raw";
import { DocsChrome } from "../components/DocsChrome";
import { Markdown } from "../components/Markdown";

export default function CliDocsPage() {
  return (
    <DocsChrome>
      <Markdown>{cliDocs}</Markdown>
    </DocsChrome>
  );
}
