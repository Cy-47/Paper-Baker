import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { PaperMetadata } from "@paper-baker/core";
import {
  findMainTexFileByContent,
  extractTexBody,
  stripTexComments,
  collectFigurePaths,
  renderBibtexFile,
} from "@paper-baker/core";
import { getProjectDir } from "../config.js";
import { getSourceDir } from "../helpers/sources.js";

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

function ensureProjectInit(): void {
  const dir = getProjectDir();
  if (!fs.existsSync(path.join(dir, "config.json"))) {
    console.error("Error: No Paper Baker project found. Run `pb project create` first.");
    process.exit(1);
  }
}

function listTexFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".tex")) {
      files.push(full);
    } else if (entry.isDirectory()) {
      files.push(...listTexFiles(full));
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export function registerReadCommands(program: Command): void {
  // --- read ---
  program
    .command("read")
    .description("Print tex source for a paper to stdout")
    .argument("<paper-id>", "Paper ID (e.g. arxiv:2301.12345)")
    .option("--concat", "Concatenate all .tex files instead of just main.tex")
    .action((paperId: string, opts: { concat?: boolean }) => {
      ensureProjectInit();

      const papers = loadPapers();
      const paper = papers.find((p) => p.paperId === paperId);
      if (!paper) {
        console.error(`Error: Paper ${paperId} not found in this project.`);
        process.exit(1);
      }

      const sourceDir = getSourceDir(paper);
      if (!fs.existsSync(sourceDir)) {
        console.error(`Error: Source directory not found at ${sourceDir}`);
        console.error("Try running `pb sync` to re-download sources.");
        process.exit(1);
      }

      const texFiles = listTexFiles(sourceDir);
      if (texFiles.length === 0) {
        console.error("Error: No .tex files found in source directory.");
        process.exit(1);
      }

      if (opts.concat) {
        // Concatenate all .tex files
        for (const file of texFiles) {
          const rel = path.relative(sourceDir, file);
          console.log(`%% --- ${rel} ---`);
          console.log(fs.readFileSync(file, "utf-8"));
          console.log();
        }
      } else {
        // Find and print the main tex file. Use content-based detection (looks
        // for \documentclass) so papers whose entry point isn't named main.tex
        // — e.g. ms.tex, root.tex — still resolve correctly.
        const contents = new Map<string, string>();
        for (const f of texFiles) {
          contents.set(path.relative(sourceDir, f), fs.readFileSync(f, "utf-8"));
        }
        const mainFile = findMainTexFileByContent(contents);
        if (!mainFile) {
          console.error("Error: Could not determine the main .tex file.");
          console.error("Available .tex files:");
          for (const f of contents.keys()) {
            console.error(`  ${f}`);
          }
          console.error("Use --concat to print all files.");
          process.exit(1);
        }
        console.log(contents.get(mainFile));
      }
    });

  // --- context ---
  program
    .command("context")
    .description("Output concatenated tex bodies and figure list for all papers")
    .action(() => {
      ensureProjectInit();

      const papers = loadPapers();
      if (papers.length === 0) {
        console.error("No papers in this project.");
        process.exit(1);
      }

      for (const paper of papers) {
        const sourceDir = getSourceDir(paper);
        if (!fs.existsSync(sourceDir)) continue;

        const texFiles = listTexFiles(sourceDir);
        if (texFiles.length === 0) continue;

        console.log(`%% ============================================================`);
        console.log(`%% Paper: ${paper.title}`);
        console.log(`%% ID: ${paper.paperId}`);
        console.log(`%% ============================================================`);
        console.log();

        const allFigures: string[] = [];

        for (const file of texFiles) {
          const raw = fs.readFileSync(file, "utf-8");
          const stripped = stripTexComments(raw);
          const body = extractTexBody(stripped);
          const rel = path.relative(sourceDir, file);

          console.log(`%% --- ${rel} ---`);
          console.log(body);
          console.log();

          allFigures.push(...collectFigurePaths(raw));
        }

        if (allFigures.length > 0) {
          console.log(`%% Figures:`);
          for (const fig of allFigures) {
            console.log(`%%   ${fig}`);
          }
          console.log();
        }
      }
    });

  // --- bib ---
  program
    .command("bib")
    .description("Regenerate refs.bib and print to stdout")
    .action(() => {
      ensureProjectInit();

      const papers = loadPapers();
      const bib = renderBibtexFile(papers);

      // Also write to file
      const bibPath = path.join(getProjectDir(), "refs.bib");
      fs.writeFileSync(bibPath, bib);

      console.log(bib);
    });
}
