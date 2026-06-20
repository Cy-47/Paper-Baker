import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { VERSION } from "../version.js";
import {
  assetName,
  downloadUrl,
  fetchLatestTag,
  isPackaged,
  normalizeVersion,
} from "../helpers/release.js";

export function registerUpdateCommand(program: Command): void {
  program
    .command("update")
    .description("Update pb to the latest release")
    .option("--force", "Reinstall even if already on the latest version")
    .action(async (opts: { force?: boolean }) => {
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

      const target = process.execPath; // the running pb binary
      const asset = assetName();

      console.error("Checking for updates…");
      const tag = await fetchLatestTag();
      const latest = normalizeVersion(tag);

      if (latest === VERSION && !opts.force) {
        console.error(`Already up to date (v${VERSION}).`);
        return;
      }

      console.error(
        opts.force && latest === VERSION
          ? `Reinstalling v${VERSION}…`
          : `Updating v${VERSION} → v${latest}…`,
      );

      const url = downloadUrl(tag, asset);
      const res = await fetch(url, { headers: { "User-Agent": "paper-baker-cli" } });
      if (!res.ok) {
        throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
      }
      const buf = Buffer.from(await res.arrayBuffer());

      // Write into the SAME directory as the target so the final rename is an
      // atomic same-filesystem swap — a crash or corrupt download never leaves a
      // half-written binary at the real path.
      const dir = path.dirname(target);
      const tmp = path.join(dir, `.pb-update-${process.pid}`);
      fs.writeFileSync(tmp, buf, { mode: 0o755 });

      // Validate the download before swapping it in: run `--version` on it. A
      // truncated/incompatible/unsigned binary fails here and we abort with the
      // current install untouched, instead of bricking the CLI.
      try {
        const out = execFileSync(tmp, ["--version"], { encoding: "utf8" }).trim();
        if (!out) throw new Error("no version output");
      } catch (err) {
        fs.rmSync(tmp, { force: true });
        throw new Error(
          `Downloaded binary failed to run (${err instanceof Error ? err.message : String(err)}); keeping v${VERSION}.`,
          { cause: err },
        );
      }

      if (process.platform === "win32") {
        // Windows refuses to replace a running .exe, but it WILL let you rename
        // it. Move the live binary aside, then drop the new one in its place.
        const old = `${target}.old`;
        fs.rmSync(old, { force: true });
        fs.renameSync(target, old);
        fs.renameSync(tmp, target);
        console.error(`Updated to v${latest}. You can delete ${old}.`);
      } else {
        // POSIX: renaming over the running binary is fine — this process keeps
        // executing from the now-unlinked old inode until it exits.
        fs.renameSync(tmp, target);
        console.error(`Updated to v${latest}.`);
      }
    });
}
