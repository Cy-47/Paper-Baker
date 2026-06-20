import { setTimeout as sleep } from "node:timers/promises";
import { execFile } from "node:child_process";
import { hostname } from "node:os";
import { loadGlobalConfig, saveGlobalConfig, getApiUrl } from "../config.js";

// ---------------------------------------------------------------------------
// Device-link login (client side of the RFC 8628 flow).
//
//   1. POST {device}/code      → deviceCode + userCode + verificationUri
//   2. user approves in any browser (any Firebase provider)
//   3. poll POST {device}/token → an opaque access token, once approved
//
// The access token is server-issued and NOT a Firebase identity — the CLI sends
// it verbatim as the bearer credential, and it only resolves against the backend
// API. There is no client-side token exchange or refresh: the token is long-
// lived and revoked server-side (per-CLI, from the web "CLI" tab).
//
// Endpoints are env-overridable so this is testable against a mock server.
// ---------------------------------------------------------------------------

// Device-link endpoints sit under the API base (/api/device via hosting
// rewrite). Overridable for the functions emulator or self-hosting.
function deviceBase(): string {
  return process.env["PAPERBAKER_DEVICE_URL"] ?? `${getApiUrl()}/device`;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}

async function postJson(url: string, body: unknown): Promise<JsonResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* non-JSON body */
  }
  return { ok: res.ok, status: res.status, json };
}

interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  interval: number;
  expiresIn: number;
}

interface DeviceInfo {
  hostname?: string;
  platform?: string;
  cliVersion?: string;
}

/**
 * Best-effort, non-identifying device labels so the web "CLI" tab can show a
 * recognizable connection ("my-laptop · darwin"). Purely cosmetic — the backend
 * never trusts it for any decision.
 */
function localDeviceInfo(): DeviceInfo {
  return {
    hostname: hostname(),
    platform: process.platform,
    cliVersion: process.env["npm_package_version"],
  };
}

async function requestDeviceCode(
  device: DeviceInfo = localDeviceInfo(),
): Promise<DeviceCodeResponse> {
  const { ok, status, json } = await postJson(`${deviceBase()}/code`, { device });
  if (!ok) {
    throw new Error(`Could not start login (${status}): ${json["error"] ?? "unknown error"}`);
  }
  return json as unknown as DeviceCodeResponse;
}

async function pollForToken(
  deviceCode: string,
  intervalS: number,
  expiresInS: number,
): Promise<{ accessToken: string; uid: string }> {
  // Nullish (not ||): a server-sent interval/expiry of 0 is a valid value and
  // must not fall back to the default.
  const deadline = Date.now() + (expiresInS ?? 600) * 1000;
  const intervalMs = Math.max(0, (intervalS ?? 5) * 1000);

  while (Date.now() < deadline) {
    const { ok, status, json } = await postJson(`${deviceBase()}/token`, { deviceCode });
    if (ok && json["status"] === "approved") {
      return { accessToken: json["accessToken"] as string, uid: json["uid"] as string };
    }
    if (ok && json["status"] === "pending") {
      await sleep(intervalMs);
      continue;
    }
    throw new Error(`Login failed (${status}): ${json["error"] ?? "unknown error"}`);
  }
  throw new Error("Login timed out. Run `pb login` again.");
}

function tryOpenBrowser(url: string): void {
  try {
    if (process.platform === "darwin") execFile("open", [url], () => {});
    else if (process.platform === "win32") execFile("cmd", ["/c", "start", "", url], () => {});
    else execFile("xdg-open", [url], () => {});
  } catch {
    /* best-effort; the URL is printed regardless */
  }
}

export interface DeviceLoginOptions {
  log?: (message: string) => void;
  openBrowser?: boolean;
}

/**
 * Run the full device-link login and persist the resulting access token + uid
 * to the global config. Prints the verification URL + user code via `log` so a
 * human — or an agent relaying to a human — can approve.
 */
export async function deviceLogin(
  opts: DeviceLoginOptions = {},
): Promise<{ uid: string }> {
  const log = opts.log ?? ((m: string) => console.log(m));

  const start = await requestDeviceCode();
  log("");
  log("To finish signing in, open this URL in a browser and enter the code:");
  log(`  ${start.verificationUri}`);
  log(`  code: ${start.userCode}`);
  log("");
  log("Waiting for approval…");
  if (opts.openBrowser) tryOpenBrowser(start.verificationUri);

  const { accessToken, uid } = await pollForToken(
    start.deviceCode,
    start.interval,
    start.expiresIn,
  );

  const cfg = loadGlobalConfig();
  cfg.accessToken = accessToken;
  cfg.uid = uid;
  saveGlobalConfig(cfg);

  return { uid };
}

/**
 * The bearer token for authenticating backend (api-client) calls:
 *   1. $PAPERBAKER_TOKEN   (headless / CI — supply an access token out-of-band)
 *   2. the stored device-link access token
 * Returns undefined when there's no credential at all.
 */
export async function resolveAuthToken(): Promise<string | undefined> {
  const env = process.env["PAPERBAKER_TOKEN"]?.trim();
  if (env) return env;

  return loadGlobalConfig().accessToken;
}
