import { describe, it, expect, vi, afterEach } from "vitest";
import { PaperBakerClient, ApiError } from "./index.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
      }),
    ),
  );
}

describe("PaperBakerClient error handling", () => {
  const client = new PaperBakerClient({ baseUrl: "/api", token: "t" });

  it("throws ApiError carrying the HTTP status (so callers can tell 404 apart)", async () => {
    // A 404 from resolvePaper means arXiv has no such paper — callers render that
    // as an empty result, not a failure, by checking err.status.
    stubFetch(404, { error: "Paper not found on arxiv: 0000.00000" });
    const err = await client
      .resolvePaper({ type: "arxiv", id: "0000.00000" })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });

  it("surfaces the backend's { error } message plus the status code", async () => {
    stubFetch(401, { error: "This CLI connection has been revoked" });
    await expect(client.listProjects()).rejects.toThrow(
      "This CLI connection has been revoked (HTTP 401)",
    );
  });

  it("is an Error subclass, so existing catch (e: Error) handlers still work", async () => {
    stubFetch(500, "boom");
    const err = await client.listProjects().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as ApiError).status).toBe(500);
  });
});
