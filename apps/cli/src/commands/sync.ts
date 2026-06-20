import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import type { PaperMetadata } from "@paper-baker/core";
import { generateProjectId, renderBibtexFile } from "@paper-baker/core";
import { PaperBakerClient } from "@paper-baker/api-client";
import {
  getApiUrl,
  loadProjectConfig,
  saveProjectConfig,
  getProjectDir,
  type ProjectConfig,
} from "../config.js";
import { resolveAuthToken } from "../helpers/auth.js";
import { downloadAndExtractSource } from "../helpers/download.js";
import { writeAgentsMd } from "../helpers/agents-md.js";
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

      const cfg = loadProjectConfig()!;
      const token = await resolveAuthToken();
      let papers = loadPapers();

      if (token) {
        papers = await syncWithServer(token, cfg, papers);
      } else {
        console.log(
          "Not logged in — syncing local state only. Run `pb login` to publish to your account.",
        );
      }

      // Re-download any missing sources for the (possibly merged) paper set.
      ensureSourcesRepo();
      let downloaded = 0;
      for (const paper of papers) {
        const sourceDir = getSourceDir(paper);
        if (fs.existsSync(sourceDir)) continue;

        if (paper.source.type === "arxiv") {
          console.log(`Downloading source for ${paper.paperId}...`);
          try {
            await downloadAndExtractSource(paper.source.id, sourceDir);
            downloaded++;
          } catch (err) {
            console.warn(`  Failed: ${errMsg(err)}`);
          }
        }
      }
      if (downloaded > 0) {
        console.log(`Downloaded ${downloaded} source(s).`);
      }

      // Regenerate the derived artifacts from the final paper set.
      const projectDir = getProjectDir();
      fs.writeFileSync(path.join(projectDir, "refs.bib"), renderBibtexFile(papers));
      console.log("Regenerated refs.bib");
      writeAgentsMd(papers);
      console.log("Regenerated AGENTS.md");

      console.log("Sync complete.");
    });
}

/**
 * Publish + reconcile against the server. Mints a stable id on first sync,
 * upsert-creates the project under the account (which also covers syncing onto
 * a new account that doesn't have it yet), pushes local-only papers up, then
 * unions the server's papers back down. Persists the binding and returns the
 * merged paper set. A network failure degrades to local-only (returns local).
 */
async function syncWithServer(
  token: string,
  cfg: ProjectConfig,
  localPapers: PaperMetadata[],
): Promise<PaperMetadata[]> {
  const client = new PaperBakerClient({ baseUrl: getApiUrl(), token });
  // The id is client-owned, so it stays constant across accounts. Absent ⇒ this
  // is the first publish; mint one now.
  const stableId = cfg.stableId ?? generateProjectId();
  const firstPublish = cfg.stableId === undefined;

  let project;
  try {
    project = await client.putProject(
      stableId,
      cfg.name,
      "Synced from the Paper Baker CLI",
    );
  } catch (err) {
    console.warn(
      `Could not reach the server (${errMsg(err)}). Syncing local state only.`,
    );
    return localPapers;
  }

  // Union local with the server's papers; push the local-only ones up.
  const manifest = await client.getProjectManifest(stableId);
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
      await client.addPaperToProject(stableId, paper.paperId);
      pushed++;
    } catch (err) {
      console.warn(`  Could not push ${paper.paperId}: ${errMsg(err)}`);
    }
  }

  savePapers(merged);
  saveProjectConfig({ name: project.name, slug: project.slug, stableId });

  if (firstPublish) {
    console.log(
      `Published as "${project.name}" (slug: ${project.slug}); pushed ${pushed} paper(s).`,
    );
  } else {
    console.log(
      `Synced with server: pushed ${pushed}, ${merged.length} paper(s) total.`,
    );
  }
  return merged;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
