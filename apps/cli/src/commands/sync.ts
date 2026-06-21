import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { PaperMetadata } from "@paper-baker/core";
import { renderBibtexFile } from "@paper-baker/core";
import { PaperBakerClient } from "@paper-baker/api-client";
import {
  getApiUrl,
  loadProjectConfig,
  saveProjectConfig,
  getProjectDir,
  isSynced,
  type ProjectConfig,
} from "../config.js";
import { resolveAuthToken } from "../helpers/auth.js";
import { downloadAndExtractSource } from "../helpers/download.js";
import { writeProjectReadme } from "../helpers/project-readme.js";
import { getSourceDir, ensureSourcesRepo } from "../helpers/sources.js";
import {
  projectConfigExists,
  loadPapers,
  savePapers,
} from "../helpers/project-files.js";
import { reconcilePapers } from "../helpers/reconcile.js";

// ---------------------------------------------------------------------------
// sync — the one verb that reconciles a project with the server.
//
// Offline projects have no stable id; their first `sync` while logged in mints
// one, creates the project under the account, and pushes papers up. There is no
// separate "push/promote" step. When not logged in, sync is purely local
// (re-download missing sources, regenerate artifacts).
// ---------------------------------------------------------------------------

export interface SyncOptions {
  /**
   * Quiet auto-sync — the mode used by the post-command hook. Routine progress
   * is suppressed and the few significant lines (first publish, push failures)
   * go to stderr, so a command's stdout (notably `--json`) stays clean. A
   * transient network failure degrades silently, and a pass with no credential
   * is a no-op rather than rewriting local files behind a read command.
   */
  quiet?: boolean;
}

export function registerSyncCommand(program: Command): void {
  program
    .command("sync")
    .description(
      "Reconcile with the server (publishes when logged in), re-download missing sources, regenerate refs.bib",
    )
    .action(async () => {
      if (!projectConfigExists()) {
        console.error("Error: No Paper Baker project found. Run `pb project create` first.");
        process.exit(1);
      }
      await syncProject();
    });
}

/**
 * Reconcile the current project with the server and rebuild derived files:
 * publish/push local changes, pull remote ones down, re-download missing
 * sources, regenerate refs.bib + README. Returns false when there's nothing to
 * do (not a project here, or a quiet pass with no credential). Never throws on a
 * network error — sync is best-effort, so callers (notably the post-command
 * auto-sync) can ignore the outcome.
 */
export async function syncProject(opts: SyncOptions = {}): Promise<boolean> {
  const quiet = opts.quiet ?? false;
  if (!projectConfigExists()) return false;

  const cfg = loadProjectConfig()!;

  // The automatic post-command sync only reconciles projects already bound to
  // the server. It never mints an id or publishes an offline (no stableId)
  // project — that promotion stays reserved for an explicit `pb sync` (or
  // `pb project create` while logged in), so a routine command can't silently
  // put a local-only project online.
  if (quiet && !isSynced(cfg)) return false;

  const token = await resolveAuthToken();

  if (!token) {
    // A quiet auto-sync has no server to reconcile against, and we don't want a
    // read command silently rewriting local files — so it's a no-op. The
    // explicit `pb sync` still does a local-only re-download + regenerate pass.
    if (quiet) return false;
    console.log(
      "Not logged in — syncing local state only. Run `pb login` to publish to your account.",
    );
    await ensureSourcesAndArtifacts(loadPapers(), quiet);
    console.log("Sync complete.");
    return true;
  }

  const papers = await syncWithServer(token, cfg, loadPapers(), quiet);
  await ensureSourcesAndArtifacts(papers, quiet);
  if (!quiet) console.log("Sync complete.");
  return true;
}

/** Re-download any missing tex sources, then regenerate refs.bib + README. */
async function ensureSourcesAndArtifacts(
  papers: PaperMetadata[],
  quiet: boolean,
): Promise<void> {
  const info = quiet ? () => {} : (m: string) => console.log(m);

  ensureSourcesRepo();
  let downloaded = 0;
  for (const paper of papers) {
    const sourceDir = getSourceDir(paper);
    if (fs.existsSync(sourceDir)) continue;

    if (paper.source.type === "arxiv") {
      info(`Downloading source for ${paper.paperId}...`);
      try {
        await downloadAndExtractSource(paper.source.id, sourceDir);
        downloaded++;
      } catch (err) {
        // A missing source is a real (recoverable) problem — surface it on
        // stderr even in quiet mode.
        console.warn(`  Could not download ${paper.paperId}: ${errMsg(err)}`);
      }
    }
  }
  if (downloaded > 0) info(`Downloaded ${downloaded} source(s).`);

  const projectDir = getProjectDir();
  fs.writeFileSync(path.join(projectDir, "refs.bib"), renderBibtexFile(papers));
  writeProjectReadme(papers);
  if (!quiet) {
    console.log("Regenerated refs.bib");
    console.log("Regenerated paperbaker/README.md");
  }
}

/**
 * Publish + reconcile against the server. On first publish the server creates the
 * project (minting its stableId + id); thereafter we reconcile the bound project.
 * Pushes local-only papers up, then unions the server's papers back down. Persists
 * the binding and returns the merged paper set. A network failure (or a project
 * the caller can't reach) degrades to local-only (returns local).
 */
async function syncWithServer(
  token: string,
  cfg: ProjectConfig,
  localPapers: PaperMetadata[],
  quiet: boolean,
): Promise<PaperMetadata[]> {
  const info = quiet ? () => {} : (m: string) => console.log(m);
  // Significant/error lines always go to stderr so a command's stdout (--json)
  // stays clean even when the auto-sync has something to say.
  const notify = (m: string) => console.warn(m);

  const client = new PaperBakerClient({ baseUrl: getApiUrl(), token });
  const firstPublish = cfg.stableId === undefined;

  // First publish creates the server project (server-minted stableId + id).
  let stableId = cfg.stableId;
  if (firstPublish) {
    try {
      const created = await client.createProject(
        cfg.name,
        "Synced from the Paper Baker CLI",
      );
      stableId = created.stableId;
    } catch (err) {
      if (!quiet) {
        console.warn(
          `Could not reach the server (${errMsg(err)}). Syncing local state only.`,
        );
      }
      return localPapers;
    }
  }

  // The manifest carries the project's current name/id/ownerHandle plus its
  // papers — one round-trip to read everything we reconcile against.
  let manifest;
  try {
    manifest = await client.getProjectManifest(stableId!);
  } catch (err) {
    if (!quiet) {
      console.warn(
        `Could not reach the server (${errMsg(err)}). Syncing local state only.`,
      );
    }
    return localPapers;
  }

  // Union local with the server's papers; push the local-only ones up.
  const remotePapers: PaperMetadata[] = manifest.papers.map(
    ({ projectPaper: _projectPaper, ...paper }) => paper,
  );
  const { local: merged, toPushToRemote } = reconcilePapers(
    localPapers,
    remotePapers,
    "merge",
  );

  let pushed = 0;
  for (const paper of toPushToRemote) {
    try {
      // Resolve into the global papers/ cache first — addPaperToProject 404s for
      // a paper the backend hasn't seen yet. Idempotent once cached.
      await client.resolvePaper(paper.source);
      await client.addPaperToProject(stableId!, paper.paperId);
      pushed++;
    } catch (err) {
      // A failed push is real drift — surface it even in quiet mode.
      notify(`  Could not push ${paper.paperId}: ${errMsg(err)}`);
    }
  }

  savePapers(merged);
  // Preserve the one-time root-brief decision across the re-save.
  saveProjectConfig({
    ...cfg,
    name: manifest.name,
    id: manifest.id,
    stableId,
    ownerHandle: manifest.ownerHandle,
  });

  const coord = manifest.ownerHandle ? `${manifest.ownerHandle}/${manifest.id}` : manifest.id;
  // A first publish only ever happens through an explicit `pb sync` — the quiet
  // auto-sync bails on unbound projects before reaching here.
  if (firstPublish) {
    info(`Published as "${manifest.name}" (id: ${coord}); pushed ${pushed} paper(s).`);
  } else {
    info(`Synced with server: pushed ${pushed}, ${merged.length} paper(s) total.`);
  }
  return merged;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
