import { Command } from "commander";
import { VERSION } from "../version.js";
import { loadGlobalConfig, saveGlobalConfig } from "../config.js";
import {
  downloadAndSwap,
  fetchLatestTag,
  isNewer,
  isPackaged,
  normalizeVersion,
} from "../helpers/release.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update pb to the latest release")
    .option("--force", "Reinstall even if already on the latest version")
    .option(
      "--auto <state>",
      "Turn background auto-update on or off and exit (on|off)",
    )
    .action(async (opts: { force?: boolean; auto?: string }) => {
      // `pb update --auto on|off` is a pure config setter — flip the persisted
      // opt-out and return without touching the network or the binary.
      if (opts.auto !== undefined) {
        const want = opts.auto.toLowerCase();
        if (want !== "on" && want !== "off") {
          throw new Error("`--auto` takes `on` or `off`.");
        }
        saveGlobalConfig({ ...loadGlobalConfig(), autoUpdate: want === "on" });
        console.error(`Background auto-update is now ${want}.`);
        return;
      }

      // Self-update only makes sense for the standalone binary. For a dev build
      // or npm global install, `process.execPath` is Node — point the user at
      // the right tool instead of trying to overwrite their Node binary.
      if (!isPackaged()) {
        console.error(
          "`pb update` updates the standalone binary install.\n" +
            "This looks like a dev or npm install — update it with:\n" +
            "  npm install -g @paper-baker/cli@latest   (npm)\n" +
            "  git pull && pnpm build                   (from source)",
        );
        return;
      }

      console.error("Checking for updates…");
      const tag = await fetchLatestTag();
      const latest = normalizeVersion(tag);

      // Only move forward unless forced: a non-newer "latest" (already current,
      // or a yanked/tampered pointer to an older build) is a no-op, so an
      // attacker can't silently downgrade. `--force` still reinstalls/downgrades.
      if (!isNewer(tag, VERSION) && !opts.force) {
        console.error(`Already up to date (v${VERSION}).`);
        return;
      }

      console.error(
        opts.force && latest === VERSION
          ? `Reinstalling v${VERSION}…`
          : `Updating v${VERSION} → v${latest}…`,
      );

      const { oldPath } = await downloadAndSwap(tag);
      console.error(
        oldPath ? `Updated to v${latest}. You can delete ${oldPath}.` : `Updated to v${latest}.`,
      );
    });
}
