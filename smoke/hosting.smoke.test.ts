import { describe, it, expect } from "vitest";

// Full-stack hosting smoke test — hits the HOSTING emulator (PAPERBAKER_HOSTING_URL,
// the isolated :5150 via the test:smoke script; defaults to :5050) over real
// HTTP, so it exercises the firebase.json rewrites AND the tsup-built functions
// bundle in plain Node: the deployment wiring the handler-level integration
// tests bypass (those mount handlers from source behind their own server). This
// is the exact layer where the three latent PROD bugs lived:
//   1. a broken bundle      → ZERO functions loaded (source-only import fails in Node)
//   2. a missing bare rewrite → /api/projects falls through to the SPA index.html
//   3. verificationUri        → defaulted to the prod host instead of the env value
// A handful of black-box checks, not exhaustive coverage. Run via `pnpm test:smoke`.

const HOST = process.env.PAPERBAKER_HOSTING_URL ?? "http://127.0.0.1:5050";

async function get(path: string): Promise<{ status: number; contentType: string; body: string }> {
  const res = await fetch(`${HOST}${path}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

async function postJson(
  path: string,
  payload: unknown,
): Promise<{ status: number; contentType: string; json: Record<string, unknown> }> {
  const res = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    /* leave json empty; the assertions below will surface a non-JSON body */
  }
  return { status: res.status, contentType: res.headers.get("content-type") ?? "", json };
}

describe("hosting smoke (rewrites + built functions bundle)", () => {
  it("POST /api/device/code reaches deviceApi — proves the bundle loaded and the rewrite resolves", async () => {
    const res = await postJson("/api/device/code", {
      device: { hostname: "smoke", platform: "test" },
    });
    expect(res.status).toBe(201);
    expect(res.contentType).toContain("application/json");
    expect(typeof res.json.deviceCode).toBe("string");
    // verificationUri reflects PAPERBAKER_WEB_URL forwarded into the function
    // runtime (set by the test:smoke script) — never the prod default.
    expect(res.json.verificationUri).toBe("http://localhost:5173/device");
  });

  it("GET /api/projects (bare path) hits the function, not the SPA fallback", async () => {
    // The glob /api/projects/** does NOT match a bare /api/projects; without the
    // explicit bare rewrite this falls through to ** → index.html. Unauthenticated,
    // the real function returns 401 JSON — proving a function, not the SPA, served it.
    const res = await get("/api/projects");
    expect(res.status).toBe(401);
    expect(res.contentType).toContain("application/json");
    expect(res.body.toLowerCase()).not.toContain("<html");
  });

  it("GET /api/library (bare path) likewise reaches the function", async () => {
    const res = await get("/api/library");
    expect(res.status).toBe(401);
    expect(res.contentType).toContain("application/json");
    expect(res.body.toLowerCase()).not.toContain("<html");
  });

  it("GET /install.sh serves the CLI installer, not the SPA fallback", async () => {
    // install.sh is copied into the web build by a Vite plugin so Hosting serves
    // it at /install.sh (curl … paper-baker.web.app/install.sh | sh). A real
    // static file must win over the ** -> index.html rewrite — otherwise the
    // pipe would feed HTML into a shell.
    const res = await get("/install.sh");
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/^#!\/bin\/sh/);
    expect(res.body).toContain("Paper Baker CLI installer");
    expect(res.body.toLowerCase()).not.toContain("<html");
  });
});
