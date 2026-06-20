#!/usr/bin/env node

import { Command } from "commander";
import { loadGlobalConfig } from "./config.js";
import { VERSION } from "./version.js";
import { registerLoginCommands } from "./commands/login.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerPaperCommands } from "./commands/papers.js";
import { registerReadCommands } from "./commands/read.js";
import { registerSyncCommand, syncProject } from "./commands/sync.js";
import { registerUpdateCommand } from "./commands/update.js";
import { registerUninstallCommand } from "./commands/uninstall.js";

const program = new Command();

program
  .name("pb")
  .description("AI-agent-facing CLI for managing research papers")
  .version(VERSION);

// Login is optional — every command works locally without an account. When not
// signed in, print a one-line nudge to stderr (so it never pollutes --json on
// stdout). Auth-management commands are exempt; PAPERBAKER_QUIET silences it.
const AUTH_COMMANDS = new Set([
  "login",
  "logout",
  "whoami",
  "help",
  "update",
  "uninstall",
]);
program.hook("preAction", (_thisCommand, actionCommand) => {
  if (AUTH_COMMANDS.has(actionCommand.name())) return;
  if (process.env["PAPERBAKER_QUIET"] || process.env["PAPERBAKER_TOKEN"]) return;
  const cfg = loadGlobalConfig();
  if (cfg.accessToken) return;
  console.error(
    "Not signed in — run `pb login` to sync to your account (set PAPERBAKER_QUIET=1 to hide).",
  );
});

// After any in-project command, quietly reconcile with the server: push local
// changes, pull remote ones, refresh derived files. Best-effort — it never
// changes a command's outcome or exit code, and routes output to stderr so
// --json stays clean. Exempt: auth/maintenance commands, the standalone arxiv
// `search`, the explicit `sync` (which runs the full, loud version itself), and
// `unbind` (a quiet sync would re-publish the project it just detached).
// PAPERBAKER_NO_SYNC turns the whole thing off for latency-sensitive callers.
const NO_AUTOSYNC = new Set([
  "login",
  "logout",
  "whoami",
  "update",
  "uninstall",
  "sync",
  "search",
  "unbind",
]);
program.hook("postAction", async (_thisCommand, actionCommand) => {
  if (NO_AUTOSYNC.has(actionCommand.name())) return;
  if (process.env["PAPERBAKER_NO_SYNC"]) return;
  try {
    await syncProject({ quiet: true });
  } catch {
    // Auto-sync is a best-effort convenience; never let it fail the command.
  }
});

registerLoginCommands(program);
registerProjectCommands(program);
registerPaperCommands(program);
registerReadCommands(program);
registerSyncCommand(program);
registerUpdateCommand(program);
registerUninstallCommand(program);

// Run async actions and turn any uncaught error (e.g. a backend API failure like
// a revoked token, or a network error) into a clean one-line message + exit 1,
// instead of an unhandled-rejection stack trace. Commands that handle their own
// errors (and call process.exit) are unaffected.
program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
