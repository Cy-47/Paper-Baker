import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collectionGroup,
  query,
  where,
} from "firebase/firestore";

const here = dirname(fileURLToPath(import.meta.url));
let testEnv: RulesTestEnvironment;
const ALICE = "alice-uid";
const BOB = "bob-uid";

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "paper-baker",
    firestore: { rules: readFileSync(join(here, "firestore.rules"), "utf8") },
  });
});
afterAll(async () => {
  await testEnv?.cleanup();
});
beforeEach(async () => {
  await testEnv.clearFirestore();
});

function authed(uid: string) {
  return testEnv.authenticatedContext(uid).firestore();
}

describe("papers/* — shared cache, client read-only / backend write-only", () => {
  it("lets an authenticated user read cached metadata", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "papers", "arxiv:1706.03762"), {
        title: "Attention Is All You Need",
        sourceStatus: "available",
      });
    });
    await assertSucceeds(getDoc(doc(authed(ALICE), "papers", "arxiv:1706.03762")));
  });
  it("blocks unauthenticated reads", async () => {
    await assertFails(
      getDoc(doc(testEnv.unauthenticatedContext().firestore(), "papers", "arxiv:1706.03762"))
    );
  });
  it("blocks client writes (cache poisoning) — even when authenticated", async () => {
    // Create: a signed-in client cannot seed the shared cache.
    await assertFails(
      setDoc(doc(authed(ALICE), "papers", "arxiv:1706.03762"), {
        title: "Attention Is All You Need",
        sourceStatus: "available",
      })
    );
    // Update: nor overwrite an existing entry.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "papers", "arxiv:1"), { title: "real" });
    });
    await assertFails(setDoc(doc(authed(ALICE), "papers", "arxiv:1"), { title: "poisoned" }));
  });
  it("blocks unauthenticated writes", async () => {
    await assertFails(
      setDoc(doc(testEnv.unauthenticatedContext().firestore(), "papers", "arxiv:x"), { title: "x" })
    );
  });
  it("blocks client deletes", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "papers", "arxiv:1"), { title: "x" });
    });
    await assertFails(deleteDoc(doc(authed(ALICE), "papers", "arxiv:1")));
  });
});

describe("deviceCodes/* — backend-only", () => {
  it("blocks an authenticated user from reading a device code", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "deviceCodes", "dc1"), {
        userCode: "ABCD2FGH",
        status: "approved",
        uid: BOB,
      });
    });
    await assertFails(getDoc(doc(authed(ALICE), "deviceCodes", "dc1")));
  });
  it("blocks an authenticated user from writing a device code", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "deviceCodes", "dc2"), { userCode: "x", status: "approved", uid: ALICE }),
    );
  });
});

describe("cliSessions/* — backend-only token hashes", () => {
  it("blocks an authenticated user from reading a session (token hash)", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "cliSessions", "conn1"), {
        connectionId: "conn1",
        uid: ALICE,
        tokenHash: "deadbeef",
      });
    });
    // Even the owning user must not read their own token hash.
    await assertFails(getDoc(doc(authed(ALICE), "cliSessions", "conn1")));
  });
  it("blocks an authenticated user from writing a session", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "cliSessions", "conn2"), {
        connectionId: "conn2",
        uid: ALICE,
        tokenHash: "x",
      }),
    );
  });
});

describe("users/{uid}/savedPapers/* — read-own, write backend-only", () => {
  async function seedSaved(uid: string, paperId: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", uid, "savedPapers", paperId), {
        paperId,
        savedAt: "2026-01-01T00:00:00Z",
      });
    });
  }
  it("lets the owner read their own saved record", async () => {
    await seedSaved(ALICE, "arxiv:1706.03762");
    await assertSucceeds(getDoc(doc(authed(ALICE), "users", ALICE, "savedPapers", "arxiv:1706.03762")));
  });
  it("blocks the owner from writing directly (writes go through the API)", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE, "savedPapers", "arxiv:1"), {
        paperId: "arxiv:1",
        savedAt: "x",
      })
    );
  });
  it("blocks reading another user's library", async () => {
    await seedSaved(BOB, "arxiv:1");
    await assertFails(getDoc(doc(authed(ALICE), "users", BOB, "savedPapers", "arxiv:1")));
  });
});

describe("users/{uid}/clis/* — read-own, write backend-only", () => {
  // The backend (Admin SDK) seeds + mutates connections; clients only read.
  async function seedConnection(uid: string, id: string, status = "active") {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", uid, "clis", id), {
        connectionId: id,
        uid,
        status,
        device: { hostname: "host", platform: "darwin" },
      });
    });
  }

  it("lets the owner read their own connections", async () => {
    await seedConnection(ALICE, "conn1");
    await assertSucceeds(getDoc(doc(authed(ALICE), "users", ALICE, "clis", "conn1")));
  });

  it("blocks the owner from revoking or deleting directly (goes through the API)", async () => {
    await seedConnection(ALICE, "conn1");
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE, "clis", "conn1"), { status: "revoked" }, { merge: true }),
    );
    await assertFails(deleteDoc(doc(authed(ALICE), "users", ALICE, "clis", "conn1")));
  });

  it("blocks a client from forging a connection (create)", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE, "clis", "forged"), {
        connectionId: "forged",
        uid: ALICE,
        status: "active",
      }),
    );
  });

  it("blocks reading another user's connections", async () => {
    await seedConnection(BOB, "conn1");
    await assertFails(getDoc(doc(authed(ALICE), "users", BOB, "clis", "conn1")));
  });
});

describe("users/{uid}/cliEvents/* — append-only log, read-own / backend-write", () => {
  async function seedEvent(uid: string, id: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", uid, "cliEvents", id), {
        type: "connected",
        connectionId: "conn1",
        device: { hostname: "host", platform: "darwin" },
        at: "2026-01-01T00:00:00Z",
      });
    });
  }

  it("lets the owner read their own activity log", async () => {
    await seedEvent(ALICE, "e1");
    await assertSucceeds(getDoc(doc(authed(ALICE), "users", ALICE, "cliEvents", "e1")));
  });

  it("blocks a client from writing log entries directly (forging history)", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE, "cliEvents", "forged"), {
        type: "connected",
        connectionId: "conn1",
        at: "2026-01-01T00:00:00Z",
      }),
    );
  });

  it("blocks reading another user's activity log", async () => {
    await seedEvent(BOB, "e1");
    await assertFails(getDoc(doc(authed(ALICE), "users", BOB, "cliEvents", "e1")));
  });
});

describe("users/{uid}/projects/* — read-own, write backend-only", () => {
  async function seedProject(uid: string, id: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", uid, "projects", id), {
        projectId: id,
        slug: "mine",
        name: "Mine",
        ownerUid: uid,
      });
    });
  }
  async function seedMembership(uid: string, projectId: string, paperId: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "users", uid, "projects", projectId, "projectPapers", paperId),
        { paperId, projectId, ownerUid: uid },
      );
    });
  }

  it("lets a user read their own project and its memberships", async () => {
    await seedProject(ALICE, "ab23");
    await seedMembership(ALICE, "ab23", "arxiv:1");
    await assertSucceeds(getDoc(doc(authed(ALICE), "users", ALICE, "projects", "ab23")));
    await assertSucceeds(
      getDoc(doc(authed(ALICE), "users", ALICE, "projects", "ab23", "projectPapers", "arxiv:1")),
    );
  });
  it("blocks a user from writing a project directly (writes go through the API)", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE, "projects", "ab23"), {
        projectId: "ab23",
        slug: "mine",
        ownerUid: ALICE,
      }),
    );
  });
  it("blocks a user from writing a projectPapers membership directly", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE, "projects", "ab23", "projectPapers", "arxiv:1"), {
        paperId: "arxiv:1",
        projectId: "ab23",
        ownerUid: ALICE,
      }),
    );
  });
  it("blocks reading another user's project", async () => {
    await seedProject(BOB, "ab23");
    await assertFails(getDoc(doc(authed(ALICE), "users", BOB, "projects", "ab23")));
  });
  it("blocks reading another user's project membership", async () => {
    await seedMembership(BOB, "ab23", "arxiv:1");
    await assertFails(
      getDoc(doc(authed(ALICE), "users", BOB, "projects", "ab23", "projectPapers", "arxiv:1")),
    );
  });
});

describe("collectionGroup(projectPapers) — cross-project membership reads", () => {
  async function seedMembership(owner: string, projectId: string, paperId: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(
        doc(ctx.firestore(), "users", owner, "projects", projectId, "projectPapers", paperId),
        { paperId, projectId, ownerUid: owner },
      );
    });
  }

  it("lets a user read their own memberships when filtered by ownerUid", async () => {
    await seedMembership(ALICE, "p1", "arxiv:1");
    await assertSucceeds(
      getDocs(query(collectionGroup(authed(ALICE), "projectPapers"), where("ownerUid", "==", ALICE))),
    );
  });
  it("rejects an unfiltered collectionGroup query (could span other users)", async () => {
    await assertFails(getDocs(collectionGroup(authed(ALICE), "projectPapers")));
  });
  it("rejects querying another user's memberships", async () => {
    await seedMembership(BOB, "p1", "arxiv:1");
    await assertFails(
      getDocs(query(collectionGroup(authed(ALICE), "projectPapers"), where("ownerUid", "==", BOB))),
    );
  });
});
