import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Global config — holds the auth token, in a platform-native config dir.
//
// The file can contain a credential, so it's written owner-only (0600) in an
// owner-only dir (0700), like ~/.aws/credentials or `gh`'s hosts.yml.
//
// Location precedence:
//   1. $PAPERBAKER_CONFIG_DIR  — explicit override (testing, CI, custom setups)
//   2. $XDG_CONFIG_HOME/paperbaker  — honored on every platform when set
//   3. platform-native: ~/Library/Application Support/paperbaker (macOS),
//      %APPDATA%\paperbaker (Windows), ~/.config/paperbaker (Linux)
// ---------------------------------------------------------------------------

// The backend lives behind Firebase Hosting rewrites at /api/* on the web host.
const DEFAULT_API_URL = "https://paper-baker.web.app/api";

// Local full-stack emulator: the hosting emulator (pnpm emulators:all) serves the
// same /api/* rewrites as production. Set PAPERBAKER_EMULATOR=1 to target it
// without remembering the URL — handy for manual end-to-end CLI testing.
const EMULATOR_API_URL = "http://127.0.0.1:5050/api";

export interface GlobalConfig {
  apiUrl?: string;
  // Device-link session: an opaque, server-issued access token (`pbk.…`) plus
  // the signed-in uid. Sent verbatim as the bearer credential; it is NOT a
  // Firebase identity, so it only works against the backend API and can be
  // revoked per-CLI from the web "CLI" tab. For headless/CI use, the same kind
  // of token can be supplied out-of-band via $PAPERBAKER_TOKEN.
  accessToken?: string;
  uid?: string;
}

export function getGlobalConfigDir(): string {
  const override = process.env["PAPERBAKER_CONFIG_DIR"];
  if (override) return override;

  const xdg = process.env["XDG_CONFIG_HOME"];
  if (xdg) return path.join(xdg, "paperbaker");

  const home = os.homedir();
  switch (process.platform) {
    case "win32":
      return path.join(
        process.env["APPDATA"] ?? path.join(home, "AppData", "Roaming"),
        "paperbaker",
      );
    case "darwin":
      return path.join(home, "Library", "Application Support", "paperbaker");
    default:
      return path.join(home, ".config", "paperbaker");
  }
}

function getGlobalConfigPath(): string {
  return path.join(getGlobalConfigDir(), "config.json");
}

export function loadGlobalConfig(): GlobalConfig {
  const configPath = getGlobalConfigPath();
  if (!fs.existsSync(configPath)) return {};

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return {};
  }
}

export function saveGlobalConfig(config: GlobalConfig): void {
  const dir = getGlobalConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  // mkdir/writeFile modes are masked by umask, and writeFile won't relax the
  // mode of an already-existing file — so chmod explicitly to guarantee the
  // credential file stays owner-only.
  fs.chmodSync(dir, 0o700);
  const file = getGlobalConfigPath();
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

/**
 * The effective API base URL:
 *   $PAPERBAKER_API_URL  (explicit override)
 *   > $PAPERBAKER_EMULATOR  (local full-stack emulator)
 *   > config file
 *   > default (production).
 */
export function getApiUrl(): string {
  if (process.env["PAPERBAKER_API_URL"]) return process.env["PAPERBAKER_API_URL"];
  if (process.env["PAPERBAKER_EMULATOR"]) return EMULATOR_API_URL;
  return loadGlobalConfig().apiUrl ?? DEFAULT_API_URL;
}

// ---------------------------------------------------------------------------
// Local project config — paperbaker/config.json in cwd
//
// The whole project lives in a single VISIBLE `paperbaker/` directory (not a
// hidden dot-dir) so coding-agent search tools can grep the metadata and the
// tex sources. The bulky, re-downloadable tex is sealed in a nested git repo at
// `paperbaker/sources/` so it stays out of the host repo's history. See
// helpers/sources.ts.
// ---------------------------------------------------------------------------

export const PROJECT_DIR = "paperbaker";

/**
 * A project is offline until it's first synced. Identity is split:
 *   - `name`      — always present; what the project is called locally.
 *   - `stableId`  — the durable, server-minted key the binding is keyed on. Its
 *                   mere presence is the binding: set ⇔ this project syncs with
 *                   the server. There is no offline-id sentinel.
 *   - `id`        — the project's user-facing, renamable identifier (the `id` in
 *                   `handle/id`), cached for display. Refreshed on sync.
 *   - `ownerHandle` — the owner's handle, cached for display so the directory can
 *                   show its `handle/id` remote. Refreshed on sync. The binding
 *                   never depends on `id`/`ownerHandle` — only on `stableId`.
 *   - `rootBrief` — records the one-time decision about the root agent brief (see
 *                   helpers/root-brief.ts): "added" once injected, "declined" if
 *                   the user opted out. Its presence means "don't ask again".
 */
export interface ProjectConfig {
  name: string;
  stableId?: string;
  id?: string;
  ownerHandle?: string;
  rootBrief?: "added" | "declined";
}

/** True once the project has been synced to the server (has a stable id). */
export function isSynced(cfg: ProjectConfig): boolean {
  return cfg.stableId !== undefined;
}

export function getProjectDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), PROJECT_DIR);
}

export function loadProjectConfig(cwd?: string): ProjectConfig | null {
  const configPath = path.join(getProjectDir(cwd), "config.json");
  if (!fs.existsSync(configPath)) return null;

  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return null;
  }
}

export function saveProjectConfig(config: ProjectConfig, cwd?: string): void {
  const dir = getProjectDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

/** Remove the binding (config.json), leaving the rest of paperbaker/ in place. */
export function removeProjectConfig(cwd?: string): void {
  fs.rmSync(path.join(getProjectDir(cwd), "config.json"), { force: true });
}
