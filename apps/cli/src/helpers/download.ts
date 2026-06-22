import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { createThrottledFetch, type PaperMetadata } from "@paper-baker/core";
import { getSourceDir } from "./sources.js";

// Throttle e-print downloads too: same arXiv host, same "be nice" expectation.
// Separate instance from the metadata API throttle — different endpoint, and a
// download is a one-shot per `pb add`, so it never needs to share the API's slot.
const eprintFetch = createThrottledFetch();

/**
 * Download an arxiv e-print and extract it to `destDir`.
 *
 * The arxiv e-print endpoint returns one of:
 *   1. A gzipped tar archive (most papers)
 *   2. A single gzipped file (some older papers — just one .tex)
 *   3. A PDF (papers with no tex source)
 *
 * We detect which case and handle accordingly.
 */
export async function downloadAndExtractSource(
  arxivId: string,
  destDir: string,
): Promise<void> {
  // PAPERBAKER_ARXIV_EPRINT_URL points the e-print download at a fixture server
  // in tests (mirrors PAPERBAKER_API_URL for the backend); defaults to arxiv.
  const base = process.env["PAPERBAKER_ARXIV_EPRINT_URL"] ?? "https://arxiv.org/e-print";
  const url = `${base}/${arxivId}`;

  const res = await eprintFetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download e-print for ${arxivId}: ${res.status} ${res.statusText}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // Create a temp directory for the download
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperbaker-"));
  const tmpFile = path.join(tmpDir, "eprint");

  try {
    fs.writeFileSync(tmpFile, buffer);

    // Ensure destination exists
    fs.mkdirSync(destDir, { recursive: true });

    // Check if it's a PDF (starts with %PDF)
    if (buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "%PDF") {
      // No tex source available — just a PDF
      fs.copyFileSync(tmpFile, path.join(destDir, "paper.pdf"));
      return;
    }

    // Try extracting as a gzipped tar archive first
    try {
      execSync(`tar xzf ${tmpFile} -C ${destDir}`, {
        stdio: "pipe",
        timeout: 30_000,
      });
      return;
    } catch {
      // Not a tar archive — try as a single gzipped file
    }

    // Try as a single gzipped file
    try {
      execSync(`gunzip -c ${tmpFile} > ${path.join(destDir, "main.tex")}`, {
        stdio: "pipe",
        shell: "/bin/sh",
        timeout: 30_000,
      });
      return;
    } catch {
      // Not gzipped either — might be a plain tex file
    }

    // Last resort: treat as a plain file
    const content = buffer.toString("utf-8");
    if (content.includes("\\documentclass") || content.includes("\\begin{")) {
      fs.writeFileSync(path.join(destDir, "main.tex"), content);
    } else {
      throw new Error(
        `Could not determine format of e-print for ${arxivId}. The file may be a PDF-only submission.`,
      );
    }
  } finally {
    // Clean up temp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Batch source download — the ONE place that turns "papers missing sources" into
// downloads with progress. Shared by `pb add`, `pb sync`, and the post-bind
// hydration so a download looks identical everywhere (see DESIGN.md §5.2): a
// counted "Downloading sources… 12/70: arxiv:…" line per paper, a "Downloaded N
// source(s)." summary, and a uniform warning that marks the paper `pdf_only` and
// keeps going on failure.
// ---------------------------------------------------------------------------

export interface DownloadSourcesResult {
  /** Sources newly fetched this pass. */
  downloaded: number;
  /** paperIds whose download failed — left as metadata-only (`pdf_only`). */
  failed: string[];
}

export interface DownloadSourcesOptions {
  /**
   * Quiet auto-sync (the post-command hook). A no-work pass stays silent so a
   * command's stdout (notably `--json`) is untouched, but real work is still
   * reported — on stderr — so a cold hydration (e.g. 70 papers right after a
   * bind) shows progress instead of looking hung.
   */
  quiet?: boolean;
  /** Injectable for tests; defaults to the real throttled network fetch. */
  download?: (arxivId: string, destDir: string) => Promise<void>;
  /** Injectable for tests; defaults to "a source dir already exists on disk". */
  hasSource?: (paper: PaperMetadata) => boolean;
}

/**
 * Download the e-print source for every arxiv paper that's missing one. Papers
 * that already have a source dir (and non-arxiv sources) are skipped, so this is
 * safe to call on the whole project repeatedly. Mutates `sourceStatus` to
 * `pdf_only` in place for any paper whose download fails; never throws.
 */
export async function downloadSources(
  papers: PaperMetadata[],
  opts: DownloadSourcesOptions = {},
): Promise<DownloadSourcesResult> {
  const quiet = opts.quiet ?? false;
  const download = opts.download ?? downloadAndExtractSource;
  const hasSource = opts.hasSource ?? ((p) => fs.existsSync(getSourceDir(p)));

  const pending = papers.filter(
    (p) => p.source.type === "arxiv" && !hasSource(p),
  );
  // Non-quiet → stdout; quiet-with-work → stderr (keeps piped/--json stdout clean).
  const note = quiet
    ? (m: string) => console.error(m)
    : (m: string) => console.log(m);

  const failed: string[] = [];
  let downloaded = 0;
  for (let i = 0; i < pending.length; i++) {
    const paper = pending[i]!;
    if (paper.source.type !== "arxiv") continue; // narrows the union; always true here
    note(`Downloading sources… ${i + 1}/${pending.length}: ${paper.paperId}`);
    try {
      await download(paper.source.id, getSourceDir(paper));
      downloaded++;
    } catch (err) {
      // A failed download is recoverable but real: surface it (always, even when
      // quiet), keep the metadata, and move on.
      paper.sourceStatus = "pdf_only";
      failed.push(paper.paperId);
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Could not download ${paper.paperId}: ${msg}; keeping metadata only.`);
    }
  }
  if (downloaded > 0) note(`Downloaded ${downloaded} source(s).`);
  return { downloaded, failed };
}
