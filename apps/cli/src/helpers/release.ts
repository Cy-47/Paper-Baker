import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { verifyBinarySignature } from "./signature.js";

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

interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Prerelease tail (e.g. "beta.1"); "" for a final release. */
  pre: string;
}

function parseSemver(v: string): Semver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(normalizeVersion(v));
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ?? "" };
}

/**
 * True when `candidate` is a strictly newer release than `current` by semver.
 * Used to gate auto-update so a tampered or yanked "latest" pointer can't force
 * a DOWNGRADE to a known-vulnerable build — only forward moves install. An
 * unparseable version on either side returns false (never auto-upgrade blindly).
 */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  // Same x.y.z: a final release outranks any prerelease of it; two finals are
  // equal (not newer); otherwise compare prerelease identifiers lexically.
  if (a.pre === b.pre) return false;
  if (a.pre === "") return true; // current is a prerelease, candidate is final
  if (b.pre === "") return false; // candidate is a prerelease, current is final
  return a.pre > b.pre;
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

/**
 * Download the release binary for `tag` and atomically swap it in over `target`
 * (the running `pb` by default). Shared by the explicit `pb update` command and
 * the background auto-updater so the risky filesystem dance lives in one place.
 *
 * Safety: the download lands on a temp file in the SAME directory as the target
 * (so the final rename is an atomic same-filesystem swap), and is validated by
 * running `--version` on it before the swap — a truncated, unsigned, or wrong-
 * arch binary fails here and we abort with the current install untouched rather
 * than bricking the CLI. Returns `{ oldPath }` on Windows (which can't overwrite
 * a running .exe, so the live binary is renamed aside for the caller to mention).
 */
export async function downloadAndSwap(
  tag: string,
  opts: { target?: string; asset?: string } = {},
): Promise<{ oldPath?: string }> {
  const target = opts.target ?? process.execPath;
  const url = downloadUrl(tag, opts.asset ?? assetName());

  const res = await fetch(url, { headers: { "User-Agent": "paper-baker-cli" } });
  if (!res.ok) {
    throw new Error(`Download failed: ${res.status} ${res.statusText} (${url})`);
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // Fetch the detached Ed25519 signature (<asset>.sig, base64) and verify the
  // binary against the embedded public key BEFORE touching disk or executing it.
  // A missing signature or a verification failure aborts with nothing changed.
  const sigRes = await fetch(`${url}.sig`, { headers: { "User-Agent": "paper-baker-cli" } });
  if (!sigRes.ok) {
    throw new Error(
      `Signature download failed: ${sigRes.status} ${sigRes.statusText} (${url}.sig)`,
    );
  }
  const sig = Buffer.from((await sigRes.text()).trim(), "base64");
  verifyBinarySignature(buf, sig);

  // Bind the artifact to the version we asked for (see swapBinary): the
  // signature alone proves "we built this", not "this is THIS release", so a
  // download-channel attacker could otherwise serve an older signed build.
  return swapBinary(buf, target, { expectedVersion: normalizeVersion(tag) });
}

/**
 * Validate `buf` as a runnable binary and atomically swap it in over `target`.
 * Split out from downloadAndSwap so the risky filesystem dance is testable
 * without the network.
 *
 * The bytes are written into a private mkdtemp directory on the target's
 * filesystem — an unguessable, exclusive name (no symlink/race on a predictable
 * temp path) that keeps the final rename a same-fs atomic swap. The candidate is
 * validated by running `--version`; if `expectedVersion` is given, the reported
 * version must match it (blocks a signed DOWNGRADE — serving an old, validly
 * signed release at a newer tag's URL). Any failure leaves `target` untouched
 * and the temp dir removed. Returns `{ oldPath }` on Windows.
 */
export function swapBinary(
  buf: Buffer,
  target: string,
  opts: { expectedVersion?: string } = {},
): { oldPath?: string } {
  const dir = path.dirname(target);
  const tmpDir = fs.mkdtempSync(path.join(dir, ".pb-update-"));
  // Keep the target's extension (".exe" on Windows): Windows cannot execute an
  // extensionless file, so the validate-before-swap `--version` check would
  // otherwise fail with ENOENT and abort every update.
  const tmp = path.join(tmpDir, `pb${path.extname(target)}`);

  try {
    fs.writeFileSync(tmp, buf, { mode: 0o755 });

    let out: string;
    try {
      out = execFileSync(tmp, ["--version"], { encoding: "utf8" }).trim();
    } catch (err) {
      throw new Error(
        `Downloaded binary failed to run (${err instanceof Error ? err.message : String(err)}); keeping current install.`,
        { cause: err },
      );
    }
    if (!out) throw new Error("Downloaded binary produced no version output.");
    if (opts.expectedVersion && normalizeVersion(out) !== normalizeVersion(opts.expectedVersion)) {
      throw new Error(
        `Downloaded binary reports v${normalizeVersion(out)}, expected v${normalizeVersion(
          opts.expectedVersion,
        )}; refusing to install.`,
      );
    }

    if (process.platform === "win32") {
      // Windows refuses to overwrite a running .exe, but it WILL let you rename
      // it. Move the live binary aside, then drop the new one in its place.
      const old = `${target}.old`;
      fs.rmSync(old, { force: true });
      fs.renameSync(target, old);
      fs.renameSync(tmp, target);
      return { oldPath: old };
    }

    // POSIX: renaming over the running binary is fine — this process keeps
    // executing from the now-unlinked old inode until it exits.
    fs.renameSync(tmp, target);
    return {};
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
