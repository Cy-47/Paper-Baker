import { createServer, type Server, type ServerResponse, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
} from "vitest";
import { loadGlobalConfig, saveGlobalConfig } from "./config.js";
import { deviceLogin, resolveAuthToken } from "./helpers/auth.js";

// Hermetic: a mock server stands in for the device endpoints. The device flow
// now returns an opaque access token directly — no Identity Toolkit exchange or
// secure-token refresh — so the CLI just stores and replays it.

let server: Server;
let port: number;
let pollCount = 0;
let configDir: string;
let lastCodeBody: Record<string, unknown> | null = null;

const ACCESS_TOKEN = "pbk.testconnid.testsecret";

function reply(res: ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
  });
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method !== "POST") return reply(res, 405, { error: "method" });

    if (url.startsWith("/device/code")) {
      void readBody(req).then((raw) => {
        lastCodeBody = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      });
      return reply(res, 201, {
        deviceCode: "dev-123",
        userCode: "ABCD-2FGH",
        verificationUri: "https://example.test/device",
        interval: 0, // no real wait between polls
        expiresIn: 600,
      });
    }
    if (url.startsWith("/device/token")) {
      pollCount++;
      // First poll: still pending. Second: approved with an access token.
      return pollCount < 2
        ? reply(res, 200, { status: "pending" })
        : reply(res, 200, {
            status: "approved",
            uid: "alice-uid",
            accessToken: ACCESS_TOKEN,
          });
    }
    reply(res, 404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  pollCount = 0;
  lastCodeBody = null;
  configDir = mkdtempSync(join(tmpdir(), "pb-auth-"));
  process.env["PAPERBAKER_CONFIG_DIR"] = configDir;
  process.env["PAPERBAKER_DEVICE_URL"] = `http://127.0.0.1:${port}/device`;
  delete process.env["PAPERBAKER_TOKEN"];
});

afterEach(() => {
  delete process.env["PAPERBAKER_CONFIG_DIR"];
  delete process.env["PAPERBAKER_DEVICE_URL"];
  delete process.env["PAPERBAKER_TOKEN"];
  rmSync(configDir, { recursive: true, force: true });
});

describe("device-link login", () => {
  it("polls through pending → approved and stores the access token", async () => {
    const logs: string[] = [];
    const result = await deviceLogin({ log: (m) => logs.push(m) });

    expect(result.uid).toBe("alice-uid");
    // It polled at least twice (pending, then approved).
    expect(pollCount).toBeGreaterThanOrEqual(2);

    // The user got the URL + code to approve.
    const out = logs.join("\n");
    expect(out).toContain("https://example.test/device");
    expect(out).toContain("ABCD-2FGH");

    // The access token is persisted.
    const cfg = loadGlobalConfig();
    expect(cfg.accessToken).toBe(ACCESS_TOKEN);
    expect(cfg.uid).toBe("alice-uid");
  });

  it("offers to open the verification URL, then honors the decision", async () => {
    let offered: string | undefined;
    // Decline (return false) so the test never actually spawns a browser.
    const result = await deviceLogin({
      log: () => {},
      openBrowser: (url) => {
        offered = url;
        return false;
      },
    });
    expect(offered).toBe("https://example.test/device");
    expect(result.uid).toBe("alice-uid");
  });

  it("reports device metadata so the web tab can label the connection", async () => {
    await deviceLogin({ log: () => {} });
    const device = (lastCodeBody?.device ?? {}) as Record<string, unknown>;
    expect(typeof device.hostname).toBe("string");
    expect(device.platform).toBe(process.platform);
  });
});

describe("resolveAuthToken precedence", () => {
  it("prefers PAPERBAKER_TOKEN (headless/CI) over the stored token", async () => {
    saveGlobalConfig({ accessToken: ACCESS_TOKEN, uid: "x" });
    process.env["PAPERBAKER_TOKEN"] = "env-token";
    expect(await resolveAuthToken()).toBe("env-token");
  });

  it("uses the stored access token from the device session when no env token", async () => {
    await deviceLogin({ log: () => {} });
    expect(await resolveAuthToken()).toBe(ACCESS_TOKEN);
  });

  it("is undefined with no credentials at all", async () => {
    expect(await resolveAuthToken()).toBeUndefined();
  });
});
