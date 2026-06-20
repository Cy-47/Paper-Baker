import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import {
  type PaperMetadata,
  parseArxivId,
  renderBibtexFile,
} from "@paper-baker/core";
import { ArxivProvider } from "@paper-baker/providers";
import { PaperBakerClient } from "@paper-baker/api-client";
import {
  getApiUrl,
  loadProjectConfig,
  getProjectDir,
} from "../config.js";
import { resolveAuthToken } from "../helpers/auth.js";
import { downloadAndExtractSource } from "../helpers/download.js";
import { writeProjectReadme } from "../helpers/project-readme.js";
import { getSourceDir, ensureSourcesRepo } from "../helpers/sources.js";

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

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerPaperCommands(program: Command): void {
  // --- add ---
  program
    .command("add")
    .description("Add a paper by arxiv ID or URL")
    .argument("<id-or-url>", "arXiv ID (e.g. 2301.12345) or URL")
    .action(async (input: string) => {
      ensureProjectInit();

      const arxivId = parseArxivId(input);
      if (!arxivId) {
        console.error(`Error: Could not parse arXiv ID from: ${input}`);
        console.error("Expected format: 2301.12345 or https://arxiv.org/abs/2301.12345");
        process.exit(1);
      }

      const paperId = `arxiv:${arxivId}`;
      const papers = loadPapers();

      // Check if already added
      if (papers.some((p) => p.paperId === paperId)) {
        console.error(`Paper ${paperId} is already in this project.`);
        process.exit(1);
      }

      // Fetch metadata from arxiv
      console.log(`Fetching metadata for ${arxivId}...`);
      const provider = makeArxivProvider();
      const metadata = await provider.fetchMetadata(arxivId);
      if (!metadata) {
        console.error(`Error: Could not find paper ${arxivId} on arXiv.`);
        process.exit(1);
      }

      // Download and extract source
      ensureSourcesRepo();
      const sourceDir = getSourceDir(metadata);
      console.log(`Downloading source to ${path.relative(process.cwd(), sourceDir)}...`);
      try {
        await downloadAndExtractSource(arxivId, sourceDir);
        console.log("Source extracted.");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: Could not download source (${msg}).`);
        metadata.sourceStatus = "pdf_only";
      }

      // Update papers.json
      papers.push(metadata);
      savePapers(papers);

      // Regenerate refs.bib and paperbaker/README.md
      regenerateBib(papers);
      regenerateReadme(papers);

      // Mirror to the server when this project is synced. Local state is already
      // written, so a failure here isn't fatal — but surface it so the user knows
      // local and server have drifted.
      const client = await getApiClient();
      const stableId = loadProjectConfig()?.stableId;
      if (client && stableId) {
        try {
          // Resolve into the global papers/ cache first — addPaperToProject 404s
          // for a paper the backend hasn't seen yet. Idempotent once cached.
          await client.resolvePaper(metadata.source);
          await client.addPaperToProject(stableId, paperId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `Warning: added locally but could not update the server (${msg}). Run \`pb sync\` to retry.`,
          );
        }
      }

      console.log(`Added: ${metadata.title}`);
      console.log(`  ID: ${metadata.paperId}`);
      console.log(`  Authors: ${metadata.authors.map((a) => a.name).join(", ")}`);
    });

  // --- remove ---
  program
    .command("remove")
    .description("Remove a paper from the project")
    .argument("<paper-id>", "Paper ID (e.g. arxiv:2301.12345)")
    .action(async (paperId: string) => {
      ensureProjectInit();

      const papers = loadPapers();
      const idx = papers.findIndex((p) => p.paperId === paperId);
      if (idx === -1) {
        console.error(`Error: Paper ${paperId} not found in this project.`);
        process.exit(1);
      }

      const paper = papers[idx];

      // Remove source directory
      const sourceDir = getSourceDir(paper);
      if (fs.existsSync(sourceDir)) {
        fs.rmSync(sourceDir, { recursive: true, force: true });
      }

      // Update papers.json
      papers.splice(idx, 1);
      savePapers(papers);

      // Regenerate refs.bib and paperbaker/README.md
      regenerateBib(papers);
      regenerateReadme(papers);

      // Mirror to the server when synced. Surface failures: if the remote delete
      // doesn't land, the paper lives on and a later `pb sync` will re-add it
      // locally, silently undoing this removal.
      const client = await getApiClient();
      const stableId = loadProjectConfig()?.stableId;
      if (client && stableId) {
        try {
          await client.removePaperFromProject(stableId, paperId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `Warning: removed locally but could not update the server (${msg}). Re-run \`pb remove ${paperId}\` to retry.`,
          );
        }
      }

      console.log(`Removed: ${paper.title} (${paperId})`);
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
