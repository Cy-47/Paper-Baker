import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// GitHub Releases helpers, shared by `pb update` and `pb uninstall`.
//
// The asset naming here MUST stay in lockstep with scripts/build-binaries.mjs
// (which produces the assets) and install.sh (which maps `uname` to them):
// every binary is `pb-<os>-<arch>` with a `.exe` suffix on Windows.
// ---------------------------------------------------------------------------

// Overridable so tests can point at a fixture server instead of real GitHub.
export const RELEASE_REPO = process.env["PAPERBAKER_RELEASE_REPO"] ?? "Cy-47/Paper-Baker";
const GITHUB_API = process.env["PAPERBAKER_GITHUB_API"] ?? "https://api.github.com";
const GITHUB_DOWNLOAD = process.env["PAPERBAKER_GITHUB_DOWNLOAD"] ?? "https://github.com";

/**
 * True when running as a @yao-pkg/pkg standalone binary (the curl-installed
 * `pb`). pkg sets `process.pkg` and points `process.execPath` at the binary
 * itself. Under `node dist/index.js`, tsx, or an npm global install this is
 * false and `execPath` is the Node binary — which is exactly why update and
 * uninstall MUST guard on this before touching `process.execPath`.
 */
export function isPackaged(): boolean {
  return typeof (process as unknown as { pkg?: unknown }).pkg !== "undefined";
}

/** Strip a leading `v` so a release tag (`v0.1.0`) compares to VERSION (`0.1.0`). */
export function normalizeVersion(tag: string): string {
  return tag.replace(/^v/, "");
}

/** Release asset filename for the given platform/arch (defaults to this host). */
export function assetName(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): string {
  let os: string;
  switch (platform) {
    case "win32":
      os = "windows";
      break;
    case "darwin":
      os = "darwin";
      break;
    case "linux":
      os = "linux";
      break;
    default:
      throw new Error(`Unsupported OS for self-update: ${platform}`);
  }

  let cpu: string;
  switch (arch) {
    case "arm64":
      cpu = "arm64";
      break;
    case "x64":
      cpu = "x64";
      break;
    default:
      throw new Error(`Unsupported architecture for self-update: ${arch}`);
  }

  return `pb-${os}-${cpu}${os === "windows" ? ".exe" : ""}`;
}

/** Direct download URL for a release asset. */
export function downloadUrl(tag: string, asset: string): string {
  return `${GITHUB_DOWNLOAD}/${RELEASE_REPO}/releases/download/${tag}/${asset}`;
}

/** Fetch the latest release's tag from the GitHub API. */
export async function fetchLatestTag(): Promise<string> {
  const res = await fetch(`${GITHUB_API}/repos/${RELEASE_REPO}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "paper-baker-cli",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API returned ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as { tag_name?: string };
  if (!json.tag_name) throw new Error("No latest release found");
  return json.tag_name;
}

/** realpath if the path resolves on disk, else the input unchanged. */
function realpathSafe(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Remove the PATH source lines the installer added to a shell rc file. The
 * installer writes `. "<installDir>/env"` (and `source "<installDir>/env.fish"`
 * for fish); a line is dropped when it quotes a `.../env` or `.../env.fish`
 * path whose directory resolves to `installDir`.
 *
 * Matching is by realpath on BOTH sides, not raw string equality, because
 * `process.execPath` is canonicalized (e.g. macOS resolves /var -> /private/var
 * and a symlinked install dir) while the rc file holds whatever path the
 * installer saw — the two can spell the same directory differently. Returns the
 * content unchanged when nothing matched.
 */
export function stripEnvLines(content: string, installDir: string): string {
  const targetDir = realpathSafe(installDir);
  return content
    .split("\n")
    .filter((line) => {
      const m = line.match(/"([^"]+\/env(?:\.fish)?)"/);
      if (!m) return true; // not an env source line — keep it
      return realpathSafe(path.dirname(m[1])) !== targetDir;
    })
    .join("\n");
}
