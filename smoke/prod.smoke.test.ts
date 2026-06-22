import { describe, it, expect } from "vitest";

// Production smoke test — hits the LIVE deployment over real HTTPS (no emulator).
// This is the only layer that exercises what emulators can't: the actual deployed
// bundle, the real Firebase Hosting rewrites, and Cloud Run's invoker/IAM. Every
// outage this project has had was prod-only and would have been caught here:
//   - a same-origin path with no Hosting rewrite → SPA index.html instead of JSON
//   - a function not publicly invokable → 403 from Cloud Run, not the handler
//   - a broken functions bundle → the whole /api surface down
//   - a bad web deploy → the app shell doesn't load
//
// Deliberately UNAUTHENTICATED and (almost) side-effect-free: it asserts each
// route is *reached and enforces auth*, not that authed flows work — so it needs
// no test user and never touches real user data. Run via `pnpm test:prod`
// (also runs automatically after `pnpm deploy:prod`). Override the target with
// PAPERBAKER_PROD_URL to smoke a preview channel.

const BASE = (process.env.PAPERBAKER_PROD_URL ?? "https://paper-baker.web.app").replace(
  /\/+$/,
  "",
);

async function get(path: string) {
  const res = await fetch(`${BASE}${path}`);
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    body: await res.text(),
  };
}

describe(`production smoke (${BASE})`, () => {
  it("serves the app shell at /", async () => {
    const res = await get("/");
    expect(res.status).toBe(200);
    expect(res.contentType).toContain("text/html");
    expect(res.body).toContain('<div id="root">');
  });

  it("serves the install scripts (real files ahead of the SPA rewrite)", async () => {
    const sh = await get("/install.sh");
    expect(sh.status).toBe(200);
    expect(sh.body).toContain("#!/"); // a real shell script, not index.html
    const ps1 = await get("/install.ps1");
    expect(ps1.status).toBe(200);
    expect(ps1.body).not.toContain("<!doctype html>");
  });

  // Each authed route, unauthenticated, must return the HANDLER's 401 JSON. A
  // 200/HTML means the path fell through to the SPA (missing rewrite); a 403 means
  // the function isn't publicly invokable; a non-JSON body means it didn't reach
  // our code. This single check covers the whole deploy + routing + IAM chain.
  it.each(["/api/papers/search?q=x", "/api/projects", "/api/library", "/api/me", "/api/users/x"])(
    "%s reaches the api function and enforces auth (401 JSON)",
    async (path) => {
      const res = await get(path);
      expect(res.status, `${path} should be 401, got ${res.status}: ${res.body.slice(0, 120)}`).toBe(401);
      expect(res.contentType).toContain("application/json");
      expect(JSON.parse(res.body)).toHaveProperty("error");
    },
  );

  it("unknown /api routes return the gateway's 404 JSON, not the SPA", async () => {
    const res = await get("/api/this-route-does-not-exist");
    expect(res.status).toBe(404);
    expect(res.contentType).toContain("application/json");
    expect(JSON.parse(res.body)).toMatchObject({ error: expect.any(String) });
  });
});
