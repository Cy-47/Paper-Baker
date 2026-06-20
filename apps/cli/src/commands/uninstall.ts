import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { Command } from "commander";
import { getGlobalConfigDir } from "../config.js";
import { isPackaged, stripEnvLines } from "../helpers/release.js";
import { isInteractive, promptChoice } from "../helpers/prompt.js";

/**
 * Remove the install dir from the Windows user PATH (HKCU\Environment), undoing
 * what install.ps1's SetEnvironmentVariable(..,"User") added. Done via PowerShell
 * so the same broadcast that install.ps1 triggered fires again — new shells see
 * the change without a reboot. Best-effort: a failure here shouldn't abort the
 * uninstall, so the binary still gets removed.
 */
function cleanupWindowsPath(installDir: string): void {
  // Rebuild the user PATH without any segment whose trimmed form equals our dir
  // (case-insensitive, trailing-slash-insensitive — matching install.ps1).
  const ps = [
    "$d = $env:PB_UNINSTALL_DIR;",
    "$p = [Environment]::GetEnvironmentVariable('Path','User');",
    "if ($p) {",
    "  $kept = $p.Split(';') | Where-Object { $_ -and ($_.TrimEnd('\\') -ine $d.TrimEnd('\\')) };",
    "  [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User');",
    "}",
  ].join(" ");
  try {
    execFileSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], {
      stdio: "ignore",
      env: { ...process.env, PB_UNINSTALL_DIR: installDir },
    });
    console.error("Removed PATH entry from your user environment.");
  } catch {
    console.error(`Could not auto-remove ${installDir} from your PATH; remove it by hand if needed.`);
  }
}

/**
 * Remove the PATH wiring the installer added: the `. "<dir>/env"` source lines
 * in the shell rc files, the fish drop-in, and the env scripts themselves.
 * Mirrors the file set written by install.sh. On Windows the wiring lives in the
 * registry instead, so defer to cleanupWindowsPath.
 */
function cleanupPath(installDir: string): void {
  if (process.platform === "win32") {
    cleanupWindowsPath(installDir);
    return;
  }
  const home = os.homedir();
  for (const name of [".profile", ".bashrc", ".zshrc", ".bash_profile"]) {
    const rc = path.join(home, name);
    if (!fs.existsSync(rc)) continue;
    const before = fs.readFileSync(rc, "utf8");
    const after = stripEnvLines(before, installDir);
    if (after !== before) {
      fs.writeFileSync(rc, after);
      console.error(`Removed PATH entry from ${rc}`);
    }
  }
  fs.rmSync(path.join(home, ".config", "fish", "conf.d", "pb.fish"), { force: true });
  fs.rmSync(path.join(installDir, "env"), { force: true });
  fs.rmSync(path.join(installDir, "env.fish"), { force: true });
}

/** Delete the running binary. POSIX can unlink itself; Windows must defer it. */
function removeSelf(target: string): void {
  if (process.platform === "win32") {
    // A running .exe can't be deleted, so hand the deletion to a detached shell
    // that waits a beat for us to exit, then removes the file.
    const child = spawn(
      "cmd",
      ["/c", `ping 127.0.0.1 -n 2 >nul & del /f /q "${target}"`],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.unref();
    console.error(`Scheduled removal of ${target}.`);
  } else {
    fs.rmSync(target, { force: true });
    console.error(`Removed ${target}.`);
  }
}

export function registerUninstallCommand(program: Command): void {
  program
    .command("uninstall")
    .description("Remove the pb binary, its PATH entries, and (optionally) your config")
    .option("--purge", "Also delete the stored login/config")
    .option("--keep-config", "Keep the stored login/config (skip the prompt)")
    .action(async (opts: { purge?: boolean; keepConfig?: boolean }) => {
      // Like update, this only operates on the standalone binary. Under npm/dev
      // `process.execPath` is Node — never delete that. Guide instead.
      if (!isPackaged()) {
        console.error(
          "`pb uninstall` removes the standalone binary install.\n" +
            "This looks like a dev or npm install — remove it with:\n" +
            "  npm uninstall -g @paper-baker/cli   (npm)\n" +
            `Your config dir (delete by hand if you want it gone): ${getGlobalConfigDir()}`,
        );
        return;
      }

      const target = process.execPath;
      const installDir = path.dirname(target);

      // Decide whether to also wipe the saved credential. Flags win; otherwise
      // ask interactively; in a non-TTY run default to KEEPING it (the safe,
      // non-destructive choice — a re-install picks the session back up).
      let purge: boolean;
      if (opts.purge) {
        purge = true;
      } else if (opts.keepConfig) {
        purge = false;
      } else if (isInteractive()) {
        purge = (await promptChoice("Also remove your saved login/config?", ["yes", "no"])) === "yes";
      } else {
        purge = false;
      }

      cleanupPath(installDir);

      const cfgDir = getGlobalConfigDir();
      if (purge) {
        fs.rmSync(cfgDir, { recursive: true, force: true });
        console.error(`Removed config: ${cfgDir}`);
      } else if (fs.existsSync(cfgDir)) {
        console.error(`Kept config: ${cfgDir} (rerun with --purge to remove).`);
      }

      // Remove the binary last — after this its file is gone (POSIX) or pending
      // deletion (Windows), but this process keeps running to completion.
      removeSelf(target);
      console.error("Uninstalled pb. Thanks for using Paper Baker!");
    });
}
