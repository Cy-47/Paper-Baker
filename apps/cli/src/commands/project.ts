import * as path from "node:path";
import { Command } from "commander";
import { PaperBakerClient } from "@paper-baker/api-client";
import { generateProjectId, type PaperMetadata } from "@paper-baker/core";
import {
  getApiUrl,
  loadProjectConfig,
  saveProjectConfig,
  removeProjectConfig,
  isSynced,
  type ProjectConfig,
} from "../config.js";
import { resolveAuthToken } from "../helpers/auth.js";
import {
  projectConfigExists,
  scaffoldProjectFiles,
  loadPapers,
  savePapers,
  rebuildArtifacts,
} from "../helpers/project-files.js";
import { reconcilePapers, papersInSync, type BindMode } from "../helpers/reconcile.js";
import { isInteractive, promptLine, promptChoice } from "../helpers/prompt.js";

// ---------------------------------------------------------------------------
// Small command-layer helpers
// ---------------------------------------------------------------------------

function makeClient(token: string): PaperBakerClient {
  return new PaperBakerClient({ baseUrl: getApiUrl(), token });
}

/** A client for commands that require auth, or exit(1) with guidance. */
async function requireClientOrExit(): Promise<PaperBakerClient> {
  const token = await resolveAuthToken();
  if (!token) {
    console.error(
      "Error: not logged in. Run `pb login`, or set PAPERBAKER_TOKEN.",
    );
    process.exit(1);
  }
  return makeClient(token);
}

/** The current directory's binding, or exit(1) if it isn't a project. */
function loadConfigOrExit(): ProjectConfig {
  const cfg = loadProjectConfig();
  if (!cfg) {
    console.error(
      "Error: no Paper Baker project here. Run `pb project create` first.",
    );
    process.exit(1);
  }
  return cfg;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// create
//
// Online-first: when logged in, `create` mints a stable id and creates the
// project on the server right away, so it's synced from birth and every later
// mutation (add/remove/rename/delete) mirrors automatically. With no credential
// it stays a local-only project; `pb sync` publishes it later.
// ---------------------------------------------------------------------------

export async function runCreate(name: string | undefined): Promise<void> {
  if (projectConfigExists()) {
    console.error("Error: a Paper Baker project already exists in this directory.");
    process.exit(1);
  }

  const projectName = name ?? path.basename(process.cwd());
  scaffoldProjectFiles();

  const token = await resolveAuthToken();
  if (token) {
    try {
      const project = await makeClient(token).putProject(
        generateProjectId(),
        projectName,
        "Created from the Paper Baker CLI",
      );
      saveProjectConfig({
        name: project.name,
        slug: project.slug,
        stableId: project.projectId,
      });
      console.log(
        `Created "${project.name}" (slug: ${project.slug}) on the server.`,
      );
      return;
    } catch (err) {
      // Don't lose the project over a network blip: fall through to a local
      // binding that `pb sync` can publish once connectivity returns.
      console.warn(
        `Warning: created locally but could not reach the server (${errMsg(err)}). Run \`pb sync\` to publish.`,
      );
    }
  }

  saveProjectConfig({ name: projectName });
  console.log(
    `Created local project "${projectName}". Run \`pb sync\` to put it on the server.`,
  );
}

// ---------------------------------------------------------------------------
// bind
// ---------------------------------------------------------------------------

async function runBind(
  slug: string,
  opts: { merge?: boolean; replaceLocal?: boolean },
): Promise<void> {
  if (opts.merge && opts.replaceLocal) {
    console.error("Error: pass at most one of --merge / --replace-local.");
    process.exit(1);
  }

  // Refuse to silently re-bind a directory that's already tied to a remote.
  if (projectConfigExists()) {
    const cfg = loadProjectConfig()!;
    if (isSynced(cfg)) {
      console.error(
        "Error: this directory is already bound to a remote project. Run `pb project unbind` first.",
      );
      process.exit(1);
    }
  }

  const client = await requireClientOrExit();

  let project;
  try {
    project = await client.getProject(slug);
  } catch {
    console.error(`Error: no project '${slug}' found on the server.`);
    process.exit(1);
  }

  const manifest = await client.getProjectManifest(project.projectId);
  const remotePapers: PaperMetadata[] = manifest.papers.map(
    ({ projectPaper: _projectPaper, ...paper }) => paper,
  );

  if (!projectConfigExists()) scaffoldProjectFiles();
  const localPapers = loadPapers();

  // Pick a reconciliation mode: explicit flag → as told; otherwise no-drift adopts
  // remote, drift prompts (TTY) or hard-errors (CI).
  let mode: BindMode | null = opts.replaceLocal
    ? "replace-local"
    : opts.merge
      ? "merge"
      : null;
  if (mode === null) {
    if (papersInSync(localPapers, remotePapers)) {
      mode = "replace-local";
    } else if (isInteractive()) {
      mode = (await promptChoice(
        `Local (${localPapers.length}) and remote (${remotePapers.length}) papers differ. Merge or replace local?`,
        ["merge", "replace-local"],
      )) as BindMode;
    } else {
      console.error(
        "Error: local state differs from the remote project. Re-run with --merge or --replace-local.",
      );
      process.exit(1);
    }
  }

  const { local, toPushToRemote } = reconcilePapers(localPapers, remotePapers, mode);

  let pushed = 0;
  for (const paper of toPushToRemote) {
    try {
      await client.resolvePaper(paper.source);
      await client.addPaperToProject(project.projectId, paper.paperId);
      pushed++;
    } catch (err) {
      console.warn(`  Could not push ${paper.paperId} to remote: ${errMsg(err)}`);
    }
  }

  savePapers(local);
  saveProjectConfig({
    name: project.name,
    slug: project.slug,
    stableId: project.projectId,
  });
  rebuildArtifacts(local);

  console.log(
    `Bound to "${project.name}" (slug: ${project.slug}) via ${mode}.` +
      (pushed > 0 ? ` Pushed ${pushed} local paper(s) up.` : ""),
  );
  console.log("Run `pb sync` to download any missing tex sources.");
}

// ---------------------------------------------------------------------------
// rename / delete / unbind
// ---------------------------------------------------------------------------

async function runRename(name: string): Promise<void> {
  const cfg = loadConfigOrExit();

  if (!isSynced(cfg)) {
    saveProjectConfig({ ...cfg, name });
    console.log(`Renamed offline project to "${name}".`);
    return;
  }

  const client = await requireClientOrExit();
  // The stable id never changes, so the binding stays valid — we only rewrite
  // the cached name/slug. If the remote update fails we throw before touching
  // anything local, keeping rename effectively atomic.
  const updated = await client.updateProject(cfg.stableId!, { name });
  saveProjectConfig({ ...cfg, name: updated.name, slug: updated.slug });
  console.log(`Renamed to "${updated.name}" (slug: ${updated.slug}).`);
}

async function runDelete(opts: { yes?: boolean }): Promise<void> {
  const cfg = loadConfigOrExit();

  if (!opts.yes) {
    if (!isInteractive()) {
      console.error(
        "Error: refusing to delete without --yes in a non-interactive shell.",
      );
      process.exit(1);
    }
    const ans = (
      await promptLine(
        `Delete project ${cfg.name} from the server? [y/N]: `,
      )
    ).toLowerCase();
    if (ans !== "y" && ans !== "yes") {
      console.log("Aborted.");
      return;
    }
  }

  if (isSynced(cfg)) {
    await (await requireClientOrExit()).deleteProject(cfg.stableId!);
  }
  removeProjectConfig();
  console.log(
    "Deleted and unbound. Local files in paperbaker/ were left in place.",
  );
}

function runUnbind(): void {
  const cfg = loadConfigOrExit();
  if (!isSynced(cfg)) {
    console.log("This directory is already a local-only project; nothing to unbind.");
    return;
  }
  // Keep the papers/files; sever the remote link by dropping the stable id.
  // The project reverts to offline and a later `pb sync` would re-publish it
  // (minting a fresh id), rather than touching the remote we just detached from.
  saveProjectConfig({ name: cfg.name });
  console.log(
    "Unbound. This directory is now a local-only project; the remote was left intact.",
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerProjectCommands(program: Command): void {
  const project = program
    .command("project")
    .description("Create, list, bind, and manage Paper Baker projects");

  project
    .command("create")
    .description("Create a project here (publishes to the server when logged in)")
    .argument("[name]", "Project name (defaults to the directory name)")
    .action(async (name: string | undefined) => {
      await runCreate(name);
    });

  project
    .command("list")
    .description("List your projects on the server")
    .option("--json", "Output raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const client = await requireClientOrExit();
      const projects = await client.listProjects();
      const boundId = loadProjectConfig()?.stableId;

      if (opts.json) {
        console.log(JSON.stringify(projects, null, 2));
        return;
      }
      if (projects.length === 0) {
        console.log("No projects yet. Create one with `pb project create`.");
        return;
      }
      for (const p of projects) {
        const marker = p.projectId === boundId ? "*" : " ";
        console.log(`${marker} ${p.slug}\t${p.name}\t${p.paperCount} paper(s)`);
      }
    });

  project
    .command("bind")
    .description("Bind this directory to an existing remote project")
    .argument("<slug>", "Slug (or id) of the project to bind")
    .option("--merge", "On drift, union local and remote papers")
    .option("--replace-local", "On drift, replace local state with the remote")
    .action(async (slug: string, opts: { merge?: boolean; replaceLocal?: boolean }) => {
      await runBind(slug, opts);
    });

  project
    .command("rename")
    .description("Rename the bound project (updates the server when bound)")
    .argument("<name>", "New project name")
    .action(async (name: string) => {
      await runRename(name);
    });

  project
    .command("delete")
    .description("Delete the bound remote project and unbind this directory")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (opts: { yes?: boolean }) => {
      await runDelete(opts);
    });

  project
    .command("unbind")
    .description("Detach this directory from its remote project (keeps both)")
    .action(() => {
      runUnbind();
    });
}
