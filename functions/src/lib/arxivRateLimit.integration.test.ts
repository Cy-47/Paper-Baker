import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { acquireArxivSlot, RateLimitedError } from "./arxivRateLimit.js";

// Drives the Firestore-backed global arXiv slot limiter against the emulator.
// A virtual clock makes the 3s spacing assertable without real waits: now()
// advances only when our fake sleep() is called.
const PROJECT_ID = "paper-baker";

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
  }
  if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
});

beforeEach(async () => {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  await fetch(
    `http://${host}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: "DELETE" },
  );
});

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    slept: [] as number[],
    sleep(this: { slept: number[] }, ms: number) {
      this.slept.push(ms);
      t += ms;
      return Promise.resolve();
    },
  };
}

async function slotDoc() {
  return (await getFirestore().doc("rateLimits/arxiv").get()).data();
}

describe("acquireArxivSlot — global cross-instance spacing", () => {
  it("first acquire waits zero and records the slot", async () => {
    const c = makeClock();
    await acquireArxivSlot({ minIntervalMs: 3000, now: c.now, sleep: c.sleep.bind(c) });
    expect(c.slept).toEqual([]); // nothing pending, no wait
    expect((await slotDoc())?.lastRequestAtMs).toBe(c.now());
  });

  it("spaces consecutive acquires by the min interval", async () => {
    const c = makeClock();
    const sleep = c.sleep.bind(c);
    const start = c.now();

    await acquireArxivSlot({ minIntervalMs: 3000, now: c.now, sleep }); // slot @ start
    await acquireArxivSlot({ minIntervalMs: 3000, now: c.now, sleep }); // waits 3000
    await acquireArxivSlot({ minIntervalMs: 3000, now: c.now, sleep }); // waits 3000

    expect(c.slept).toEqual([3000, 3000]);
    // Third slot sits two intervals past the first.
    expect((await slotDoc())?.lastRequestAtMs).toBe(start + 6000);
  });

  it("sheds load (RateLimitedError) when the next slot is past maxWaitMs", async () => {
    const c = makeClock();
    const now = c.now;
    const start = now();

    // Pre-load the clock with a backlog: claim a far-future slot first.
    await getFirestore()
      .doc("rateLimits/arxiv")
      .set({ lastRequestAtMs: start + 100_000 });

    await expect(
      acquireArxivSlot({ minIntervalMs: 3000, maxWaitMs: 20_000, now, sleep: c.sleep.bind(c) }),
    ).rejects.toBeInstanceOf(RateLimitedError);

    // The rejected caller must NOT have claimed a slot.
    expect((await slotDoc())?.lastRequestAtMs).toBe(start + 100_000);
  });

  it("serializes concurrent acquires into distinct increasing slots", async () => {
    // Real clock here (transactions race for real); sleep is a no-op so the test
    // is fast. The assertion is that 5 concurrent claims advance the slot by
    // exactly 5 intervals — i.e. none collided onto the same slot.
    const noSleep = () => Promise.resolve();
    const base = Date.now();
    await getFirestore().doc("rateLimits/arxiv").set({ lastRequestAtMs: base });

    await Promise.all(
      Array.from({ length: 5 }, () =>
        acquireArxivSlot({ minIntervalMs: 3000, maxWaitMs: 60_000, sleep: noSleep }),
      ),
    );

    const last = (await slotDoc())?.lastRequestAtMs as number;
    expect(last).toBe(base + 5 * 3000);
  });
});
