import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";
import { createThrottledFetch } from "@paper-baker/core";

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
