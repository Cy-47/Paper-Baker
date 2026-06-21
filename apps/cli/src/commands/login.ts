import { Command } from "commander";
import { loadGlobalConfig, saveGlobalConfig, getApiUrl } from "../config.js";
import { deviceLogin } from "../helpers/auth.js";
import { isInteractive, promptLine } from "../helpers/prompt.js";
import { bold, tick } from "../helpers/style.js";

function envTokenSet(): boolean {
  return !!process.env["PAPERBAKER_TOKEN"]?.trim();
}

export function registerLoginCommands(program: Command): void {
  program
    .command("login")
    .description("Sign in through your browser (device link)")
    .option("--open", "Open the verification URL immediately (skip the Enter prompt)")
    .action(async (opts: { open?: boolean }) => {
      // Idempotent re-auth: tell the user they're replacing an existing session
      // (non-blocking — no prompt, since this CLI is driven by agents too).
      const existing = loadGlobalConfig();
      if (existing.accessToken) {
        console.log(
          `Already signed in${existing.uid ? ` as ${existing.uid}` : ""}; re-authenticating.`,
        );
      }
      try {
        const { uid } = await deviceLogin({
          openBrowser: async (url) => {
            // --open: open straight away, no keypress. Agents/CI (no TTY): never
            // block on stdin and never open — just print the URL. Interactive
            // default (gh-style): offer to open on Enter so the user can eyeball
            // the URL (or Ctrl-C and visit it by hand) before a browser launches.
            if (opts.open === true) {
              console.log(`Opening ${url} in your browser...`);
              return true;
            }
            if (!isInteractive()) {
              console.log(`Open ${url} in your browser to finish signing in.`);
              return false;
            }
            await promptLine(`${bold("Press Enter")} to open ${url} in your browser... `);
            return true;
          },
        });
        console.log(tick(`Signed in as ${uid}.`));
        // A set PAPERBAKER_TOKEN silently overrides the token we just stored
        // (resolveAuthToken is env-first), so this login would have no effect.
        // Warn to stderr, mirroring `logout`.
        if (envTokenSet()) {
          console.warn(
            "Note: PAPERBAKER_TOKEN is set in your environment and overrides this login. " +
              "Unset it to use the account you just signed into.",
          );
        }
      } catch (err) {
        console.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });

  program
    .command("logout")
    .description("Remove the stored credential")
    .action(() => {
      const config = loadGlobalConfig();
      const had = !!config.accessToken;
      delete config.accessToken;
      delete config.uid;
      saveGlobalConfig(config);
      console.log(had ? "Logged out." : "No stored credential to remove.");
      if (envTokenSet()) {
        console.warn(
          "Note: PAPERBAKER_TOKEN is still set in your environment and remains in effect.",
        );
      }
    });

  program
    .command("whoami")
    .description("Show current authentication status")
    .action(() => {
      const cfg = loadGlobalConfig();
      if (envTokenSet()) {
        console.log("Authenticated via PAPERBAKER_TOKEN (environment).");
      } else if (cfg.accessToken) {
        console.log(`Signed in via device link${cfg.uid ? ` (uid: ${cfg.uid})` : ""}.`);
      } else {
        console.log("Not logged in. Run `pb login` to authenticate.");
        return;
      }
      console.log(`API URL: ${getApiUrl()}`);
    });
}
