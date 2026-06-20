#!/usr/bin/env node

import { Command } from "commander";
import { loadGlobalConfig } from "./config.js";
import { registerLoginCommands } from "./commands/login.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerPaperCommands } from "./commands/papers.js";
import { registerReadCommands } from "./commands/read.js";
import { registerSyncCommand } from "./commands/sync.js";

const program = new Command();

program
  .name("pb")
  .description("AI-agent-facing CLI for managing research papers")
  .version("0.1.0");

// Login is optional — every command works locally without an account. When not
// signed in, print a one-line nudge to stderr (so it never pollutes --json on
// stdout). Auth-management commands are exempt; PAPERBAKER_QUIET silences it.
const AUTH_COMMANDS = new Set(["login", "logout", "whoami", "help"]);
program.hook("preAction", (_thisCommand, actionCommand) => {
  if (AUTH_COMMANDS.has(actionCommand.name())) return;
  if (process.env["PAPERBAKER_QUIET"] || process.env["PAPERBAKER_TOKEN"]) return;
  const cfg = loadGlobalConfig();
  if (cfg.accessToken) return;
  console.error(
    "Not signed in — run `pb login` to sync to your account (set PAPERBAKER_QUIET=1 to hide).",
  );
});

registerLoginCommands(program);
registerProjectCommands(program);
registerPaperCommands(program);
registerReadCommands(program);
registerSyncCommand(program);

// Run async actions and turn any uncaught error (e.g. a backend API failure like
// a revoked token, or a network error) into a clean one-line message + exit 1,
// instead of an unhandled-rejection stack trace. Commands that handle their own
// errors (and call process.exit) are unaffected.
program.parseAsync().catch((err: unknown) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
