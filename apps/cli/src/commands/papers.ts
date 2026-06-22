import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  type PaperMetadata,
  parseArxivId,
  renderBibtexFile,
} from "@paper-baker/core";
import { ArxivProvider } from "@paper-baker/providers";
import { PaperBakerClient, ApiError } from "@paper-baker/api-client";
import {
  getApiUrl,
  loadProjectConfig,
  getProjectDir,
} from "../config.js";
import { resolveAuthToken } from "../helpers/auth.js";
import { downloadSources } from "../helpers/download.js";
import { writeProjectReadme } from "../helpers/project-readme.js";
import { getSourceDir, ensureSourcesRepo } from "../helpers/sources.js";
import { classifyProjectSyncError, syncFailureMessage } from "../helpers/sync-status.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadPapers(cwd?: string): PaperMetadata[] {
  const papersPath = path.join(getProjectDir(cwd), "papers.json");
  if (!fs.existsSync(papersPath)) return [];

  try {
    return JSON.parse(fs.readFileSync(papersPath, "utf-8")) as PaperMetadata[];
  } catch {
    return [];
  }
}

function savePapers(papers: PaperMetadata[], cwd?: string): void {
  const dir = getProjectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "papers.json"), JSON.stringify(papers, null, 2) + "\n");
}

function regenerateBib(papers: PaperMetadata[], cwd?: string): void {
  const dir = getProjectDir(cwd);
  fs.writeFileSync(path.join(dir, "refs.bib"), renderBibtexFile(papers));
}

function regenerateReadme(papers: PaperMetadata[], cwd?: string): void {
  writeProjectReadme(papers, cwd);
}

function ensureProjectInit(): void {
  const dir = getProjectDir();
  if (!fs.existsSync(path.join(dir, "config.json"))) {
    console.error("Error: No Paper Baker project found. Run `pb project create` first.");
    process.exit(1);
  }
}

/**
 * An ArxivProvider for the CLI. PAPERBAKER_ARXIV_API_URL points the metadata
 * fetch at a fixture server in tests (mirrors PAPERBAKER_API_URL for the
 * backend); falls back to the public arxiv API.
 */
function makeArxivProvider(): ArxivProvider {
  return new ArxivProvider(process.env["PAPERBAKER_ARXIV_API_URL"] || undefined);
}

async function getApiClient(): Promise<PaperBakerClient | null> {
  const token = await resolveAuthToken();
  const projectConfig = loadProjectConfig();
  if (!token || !projectConfig) return null;

  return new PaperBakerClient({
    baseUrl: getApiUrl(),
    token,
  });
}

/**
 * Run a server-mirroring step for a bound, logged-in project, after local state
 * is already written. A no-op when offline or unbound. On failure the local
 * change stands; the deferred-sync guidance is shown once (classified into
 * no-access / auth / transient — see helpers/sync-status.ts), never throwing.
 */
async function mirrorToServer(
  run: (client: PaperBakerClient, stableId: string) => Promise<void>,
  lead: string,
): Promise<void> {
  const client = await getApiClient();
  const stableId = loadProjectConfig()?.stableId;
  if (!client || !stableId) return;
  try {
    await run(client, stableId);
  } catch (err) {
    console.warn(syncFailureMessage(classifyProjectSyncError(err), lead));
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerPaperCommands(program: Command): void {
  // --- add ---
  program
    .command("add")
    .description("Add one or more papers by arXiv ID or URL")
    .argument("<id-or-url...>", "arXiv IDs or URLs (e.g. 2301.12345)")
    .action(async (inputs: string[]) => {
      ensureProjectInit();

      const papers = loadPapers();
      const present = new Set(papers.map((p) => p.paperId));
      const provider = makeArxivProvider();
      ensureSourcesRepo();

      // Process every input (don't stop on the first bad one), accumulating the
      // successfully-added papers. papers.json / refs.bib / README and the server
      // mirror are touched ONCE at the end, so a bulk add is one file rewrite and
      // one sync pass, not N. Throttling is handled in the arXiv provider.
      const added: PaperMetadata[] = [];
      let failed = 0;
      let skipped = 0;

      for (const input of inputs) {
        const arxivId = parseArxivId(input);
        if (!arxivId) {
          console.error(`Failed: ${input} — not a recognizable arXiv ID or URL.`);
          failed++;
          continue;
        }

        const paperId = `arxiv:${arxivId}`;
        if (present.has(paperId)) {
          console.log(`Skipped (already present): ${paperId}`);
          skipped++;
          continue;
        }

        const metadata = await provider.fetchMetadata(arxivId);
        if (!metadata) {
          console.error(`Failed: ${arxivId} — not found on arXiv.`);
          failed++;
          continue;
        }

        papers.push(metadata);
        present.add(paperId);
        added.push(metadata);
        console.log(`Added: ${metadata.title} (${paperId})`);
      }

      if (added.length > 0) {
        // Fetch the e-print sources through the shared, counted download UI so an
        // add looks the same as a sync; a failure marks the paper pdf_only in place.
        await downloadSources(added);
        savePapers(papers);
        regenerateBib(papers);
        regenerateReadme(papers);
        await mirrorToServer(async (client, stableId) => {
          // Resolve into the global papers/ cache first — addPaperToProject 404s
          // for a paper the backend hasn't seen yet. Idempotent once cached. The
          // first failure throws out of the loop; mirrorToServer classifies it
          // once (a no-access/auth failure applies to the whole batch, and any
          // not-yet-pushed papers are already local for the next `pb sync`).
          for (const p of added) {
            await client.resolvePaper(p.source);
            await client.addPaperToProject(stableId, p.paperId);
          }
        }, added.length === 1 ? "Added locally, but not synced" : `Added ${added.length} locally, but not synced`);
      }

      if (inputs.length > 1) {
        console.log(`\n${added.length} added, ${skipped} skipped, ${failed} failed.`);
      }
      // Exit non-zero if any requested id couldn't be added locally, so a caller
      // (e.g. a migration loop) can detect failure from $? rather than parsing
      // stdout. A source-download miss is a partial success, not a failure; a
      // sync miss is reported above but doesn't fail the command (it landed locally).
      if (failed > 0) process.exit(1);
    });

  // --- remove ---
  program
    .command("remove")
    .description("Remove one or more papers from the project")
    .argument("<paper-id...>", "Paper IDs (e.g. arxiv:2301.12345)")
    .action(async (paperIds: string[]) => {
      ensureProjectInit();

      const papers = loadPapers();
      const removed: PaperMetadata[] = [];
      let failed = 0;

      for (const paperId of paperIds) {
        const idx = papers.findIndex((p) => p.paperId === paperId);
        if (idx === -1) {
          console.error(`Failed: ${paperId} — not in this project.`);
          failed++;
          continue;
        }

        const paper = papers[idx];
        const sourceDir = getSourceDir(paper);
        if (fs.existsSync(sourceDir)) {
          fs.rmSync(sourceDir, { recursive: true, force: true });
        }
        papers.splice(idx, 1);
        removed.push(paper);
        console.log(`Removed: ${paper.title} (${paperId})`);
      }

      if (removed.length > 0) {
        savePapers(papers);
        regenerateBib(papers);
        regenerateReadme(papers);
        // Mirror once. A 404 "Paper not in project" means the server is already in
        // the desired state — skip it, the local removal stands.
        await mirrorToServer(async (client, stableId) => {
          for (const p of removed) {
            try {
              await client.removePaperFromProject(stableId, p.paperId);
            } catch (err) {
              if (
                err instanceof ApiError &&
                err.status === 404 &&
                /Paper not in project/i.test(err.message)
              ) {
                continue;
              }
              throw err;
            }
          }
        }, removed.length === 1 ? "Removed locally, but not synced" : `Removed ${removed.length} locally, but not synced`);
      }

      if (paperIds.length > 1) {
        console.log(`\n${removed.length} removed, ${failed} failed.`);
      }
      if (failed > 0) process.exit(1);
    });

  // --- search ---
  program
    .command("search")
    .description("Search for papers on arXiv")
    .argument("<query>", "Search query")
    .option("-n, --max-results <n>", "Maximum number of results", "10")
    .option("--json", "Output as JSON")
    .action(async (query: string, opts: { maxResults: string; json?: boolean }) => {
      const provider = makeArxivProvider();
      const results = await provider.search(query, parseInt(opts.maxResults, 10));

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No results found.");
        return;
      }

      console.log(`Found ${results.length} result(s):\n`);
      for (const paper of results) {
        const authors = paper.authors.map((a) => a.name).join(", ");
        const date = paper.publishedAt.slice(0, 10);
        const abstract = paper.abstract.replace(/\s+/g, " ").trim();
        const snippet =
          abstract.length > 2000 ? `${abstract.slice(0, 2000)}…` : abstract;
        console.log(`  ${paper.paperId}`);
        console.log(`  ${paper.title}`);
        console.log(`  ${authors}`);
        console.log(`  ${date}  ${paper.categories.join(", ")}`);
        if (snippet) console.log(`  ${snippet}`);
        console.log();
      }
    });

  // --- list ---
  program
    .command("list")
    .description("List papers in this project")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }) => {
      ensureProjectInit();

      const papers = loadPapers();

      if (opts.json) {
        console.log(JSON.stringify(papers, null, 2));
        return;
      }

      if (papers.length === 0) {
        console.log("No papers in this project. Use `pb add <id>` to add one.");
        return;
      }

      console.log(`${papers.length} paper(s):\n`);
      for (const paper of papers) {
        const authors = paper.authors.slice(0, 3).map((a) => a.name).join(", ");
        const extra = paper.authors.length > 3 ? ` +${paper.authors.length - 3}` : "";
        const date = paper.publishedAt.slice(0, 10);
        console.log(`  ${paper.paperId}`);
        console.log(`  ${paper.title}`);
        console.log(`  ${authors}${extra}  (${date})`);
        console.log();
      }
    });

  // --- show ---
  program
    .command("show")
    .description("Show detailed metadata for a paper")
    .argument("<paper-id>", "Paper ID (e.g. arxiv:2301.12345)")
    .option("--json", "Output as JSON")
    .action((paperId: string, opts: { json?: boolean }) => {
      ensureProjectInit();

      const papers = loadPapers();
      const paper = papers.find((p) => p.paperId === paperId);
      if (!paper) {
        console.error(`Error: Paper ${paperId} not found in this project.`);
        process.exit(1);
      }

      if (opts.json) {
        console.log(JSON.stringify(paper, null, 2));
        return;
      }

      console.log(`Title:      ${paper.title}`);
      console.log(`ID:         ${paper.paperId}`);
      console.log(`Authors:    ${paper.authors.map((a) => a.name).join(", ")}`);
      console.log(`Published:  ${paper.publishedAt.slice(0, 10)}`);
      if (paper.updatedAt) {
        console.log(`Updated:    ${paper.updatedAt.slice(0, 10)}`);
      }
      console.log(`Categories: ${paper.categories.join(", ")}`);
      if (paper.doi) {
        console.log(`DOI:        ${paper.doi}`);
      }
      if (paper.venue) {
        console.log(`Venue:      ${paper.venue}`);
      }
      console.log(`Source:     ${paper.sourceStatus}`);
      console.log();
      console.log("Abstract:");
      console.log(paper.abstract);
    });
}
