import { describe, it, expect } from "vitest";
import { createThrottledFetch } from "./arxiv-throttle.js";

// A virtual clock: sleep() and advance() move time forward instantly, so tests
// assert request *spacing* without waiting real seconds.
function makeClock() {
  let t = 0;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    sleep: (ms: number) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

describe("createThrottledFetch", () => {
  it("spaces request starts at least the min interval apart", async () => {
    const clock = makeClock();
    const starts: number[] = [];
    const fetchImpl = async () => {
      starts.push(clock.now());
      return new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 3000,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl,
    });

    await Promise.all([f("u1"), f("u2"), f("u3")]);

    // First fires immediately; each subsequent one waits a full interval.
    expect(starts).toEqual([0, 3000, 6000]);
  });

  it("runs a single connection at a time (no overlap)", async () => {
    const clock = makeClock();
    let active = 0;
    let maxActive = 0;
    const fetchImpl = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve(); // yield, simulating in-flight work
      active--;
      return new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 0,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl,
    });

    await Promise.all([f("a"), f("b"), f("c")]);
    expect(maxActive).toBe(1);
  });

  it("retries 503 with exponential backoff, then succeeds", async () => {
    const clock = makeClock();
    const slept: number[] = [];
    const sleep = (ms: number) => {
      if (ms > 0) slept.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    };
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls < 3
        ? new Response("busy", { status: 503 })
        : new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 3000,
      maxRetries: 3,
      now: clock.now,
      sleep,
      fetchImpl,
    });

    const res = await f("u");
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
    expect(slept).toEqual([3000, 6000]); // 3000*2^0, 3000*2^1
  });

  it("backs off on 503 even when minIntervalMs is 0 (backend config)", async () => {
    // The backend sets minIntervalMs: 0 (global spacing is enforced elsewhere by
    // a Firestore slot limiter). Retry backoff must NOT collapse to 0, or a 503
    // with no Retry-After would be retried instantly and immediately re-fail.
    const clock = makeClock();
    const slept: number[] = [];
    const sleep = (ms: number) => {
      if (ms > 0) slept.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    };
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls < 3
        ? new Response("Rate exceeded.", { status: 503 }) // no Retry-After header
        : new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 0,
      maxRetries: 3,
      now: clock.now,
      sleep,
      fetchImpl,
    });

    const res = await f("u");
    expect(res.status).toBe(200);
    expect(slept).toEqual([3000, 6000]); // default retry backoff, independent of minIntervalMs
  });

  it("honors a Retry-After header when longer than the backoff", async () => {
    const clock = makeClock();
    const slept: number[] = [];
    const sleep = (ms: number) => {
      if (ms > 0) slept.push(ms);
      clock.advance(ms);
      return Promise.resolve();
    };
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls < 2
        ? new Response("busy", { status: 503, headers: { "Retry-After": "30" } })
        : new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 3000,
      now: clock.now,
      sleep,
      fetchImpl,
    });

    await f("u");
    expect(slept).toEqual([30_000]); // 30s Retry-After beats the 3s backoff
  });

  it("returns the final 429 after exhausting retries", async () => {
    const clock = makeClock();
    const sleep = (ms: number) => {
      clock.advance(ms);
      return Promise.resolve();
    };
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return new Response("no", { status: 429 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 1000,
      maxRetries: 2,
      now: clock.now,
      sleep,
      fetchImpl,
    });

    const res = await f("u");
    expect(res.status).toBe(429);
    expect(calls).toBe(3); // initial attempt + 2 retries
  });

  it("sets a descriptive User-Agent header by default", async () => {
    let seen: string | null = null;
    const fetchImpl = async (_url: string, init?: RequestInit) => {
      seen = new Headers(init?.headers).get("user-agent");
      return new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({ minIntervalMs: 0, fetchImpl });
    await f("u");
    expect(seen).toMatch(/paper.?baker/i);
  });

  it("does not let one caller's rejection poison later requests", async () => {
    const clock = makeClock();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) throw new Error("network down");
      return new Response("ok", { status: 200 });
    };

    const f = createThrottledFetch({
      minIntervalMs: 0,
      now: clock.now,
      sleep: clock.sleep,
      fetchImpl,
    });

    await expect(f("u1")).rejects.toThrow("network down");
    const res = await f("u2");
    expect(res.status).toBe(200);
  });
});
