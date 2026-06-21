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
  collection,
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
function unauthed() {
  return testEnv.unauthenticatedContext().firestore();
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
    await assertFails(getDoc(doc(unauthed(), "papers", "arxiv:1706.03762")));
  });
  it("blocks client writes (cache poisoning) — even when authenticated", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "papers", "arxiv:1706.03762"), {
        title: "Attention Is All You Need",
        sourceStatus: "available",
      })
    );
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "papers", "arxiv:1"), { title: "real" });
    });
    await assertFails(setDoc(doc(authed(ALICE), "papers", "arxiv:1"), { title: "poisoned" }));
  });
  it("blocks client deletes", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "papers", "arxiv:1"), { title: "x" });
    });
    await assertFails(deleteDoc(doc(authed(ALICE), "papers", "arxiv:1")));
  });
});

describe("users/{uid} — public profile, read any signed-in / backend write-only", () => {
  async function seedProfile(uid: string, handle: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", uid), {
        uid,
        handle,
        displayName: "Display " + handle,
        createdAt: "2026-01-01T00:00:00Z",
      });
    });
  }
  it("lets any signed-in user read another user's profile (handles/sharing need it)", async () => {
    await seedProfile(BOB, "bob");
    await assertSucceeds(getDoc(doc(authed(ALICE), "users", BOB)));
  });
  it("blocks unauthenticated profile reads", async () => {
    await seedProfile(BOB, "bob");
    await assertFails(getDoc(doc(unauthed(), "users", BOB)));
  });
  it("blocks a client from writing a profile directly (even its own)", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "users", ALICE), { uid: ALICE, handle: "alice", displayName: "A" }),
    );
  });
});

describe("handles/{handle} — registry, public read / backend write-only", () => {
  async function seedHandle(handle: string, uid: string) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "handles", handle), { uid });
    });
  }
  it("lets a signed-in user resolve a handle to a uid", async () => {
    await seedHandle("alice", ALICE);
    await assertSucceeds(getDoc(doc(authed(BOB), "handles", "alice")));
  });
  it("blocks unauthenticated reads", async () => {
    await seedHandle("alice", ALICE);
    await assertFails(getDoc(doc(unauthed(), "handles", "alice")));
  });
  it("blocks a client from claiming a handle directly", async () => {
    await assertFails(setDoc(doc(authed(ALICE), "handles", "alice"), { uid: ALICE }));
  });
});

describe("deviceCodes/* — backend-only", () => {
  it("blocks reading a device code", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "deviceCodes", "dc1"), {
        userCode: "ABCD2FGH",
        status: "approved",
        uid: BOB,
      });
    });
    await assertFails(getDoc(doc(authed(ALICE), "deviceCodes", "dc1")));
  });
  it("blocks writing a device code", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "deviceCodes", "dc2"), { userCode: "x", status: "approved", uid: ALICE }),
    );
  });
});

describe("cliSessions/* — backend-only token hashes", () => {
  it("blocks reading a session (token hash) — even the owner", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "cliSessions", "conn1"), {
        connectionId: "conn1",
        uid: ALICE,
        tokenHash: "deadbeef",
      });
    });
    await assertFails(getDoc(doc(authed(ALICE), "cliSessions", "conn1")));
  });
  it("blocks writing a session", async () => {
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

describe("projects/* — top-level, membership-gated reads, write backend-only", () => {
  async function seedProject(owner: string, stableId: string, members: string[] = [owner]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "projects", stableId), {
        stableId,
        id: "mine",
        name: "Mine",
        ownerUid: owner,
        ownerHandle: "owner",
        memberUids: members,
        visibility: "private",
      });
    });
  }
  async function seedMembership(stableId: string, paperId: string, members: string[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "projects", stableId, "projectPapers", paperId), {
        paperId,
        projectStableId: stableId,
        memberUids: members,
      });
    });
  }

  it("lets the owner read their project and its memberships", async () => {
    await seedProject(ALICE, "ab23kd9p");
    await seedMembership("ab23kd9p", "arxiv:1", [ALICE]);
    await assertSucceeds(getDoc(doc(authed(ALICE), "projects", "ab23kd9p")));
    await assertSucceeds(
      getDoc(doc(authed(ALICE), "projects", "ab23kd9p", "projectPapers", "arxiv:1")),
    );
  });

  it("lets a SHARED member read a project they don't own (the sharing seam)", async () => {
    // No sharing endpoint exists yet, but the read model already authorizes on
    // membership: a BOB-owned project with ALICE in memberUids is readable by ALICE.
    await seedProject(BOB, "shared01", [BOB, ALICE]);
    await seedMembership("shared01", "arxiv:1", [BOB, ALICE]);
    await assertSucceeds(getDoc(doc(authed(ALICE), "projects", "shared01")));
    await assertSucceeds(
      getDoc(doc(authed(ALICE), "projects", "shared01", "projectPapers", "arxiv:1")),
    );
  });

  it("blocks a non-member from reading a project or its memberships", async () => {
    await seedProject(BOB, "ab23kd9p");
    await seedMembership("ab23kd9p", "arxiv:1", [BOB]);
    await assertFails(getDoc(doc(authed(ALICE), "projects", "ab23kd9p")));
    await assertFails(
      getDoc(doc(authed(ALICE), "projects", "ab23kd9p", "projectPapers", "arxiv:1")),
    );
  });

  it("blocks a client from writing a project or membership directly", async () => {
    await assertFails(
      setDoc(doc(authed(ALICE), "projects", "ab23kd9p"), {
        stableId: "ab23kd9p",
        id: "mine",
        ownerUid: ALICE,
        memberUids: [ALICE],
      }),
    );
    await assertFails(
      setDoc(doc(authed(ALICE), "projects", "ab23kd9p", "projectPapers", "arxiv:1"), {
        paperId: "arxiv:1",
        projectStableId: "ab23kd9p",
        memberUids: [ALICE],
      }),
    );
  });

  it("admits a membership-filtered list and rejects an unfiltered one", async () => {
    await seedProject(ALICE, "mine0001", [ALICE]);
    await seedProject(BOB, "bob00001", [BOB]);
    await assertSucceeds(
      getDocs(query(collection(authed(ALICE), "projects"), where("memberUids", "array-contains", ALICE))),
    );
    // Unfiltered would span BOB's project, which ALICE can't read.
    await assertFails(getDocs(collection(authed(ALICE), "projects")));
  });
});

describe("collectionGroup(projectPapers) — cross-project membership reads", () => {
  async function seedMembership(stableId: string, paperId: string, members: string[]) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "projects", stableId, "projectPapers", paperId), {
        paperId,
        projectStableId: stableId,
        memberUids: members,
      });
    });
  }

  it("lets a user read their memberships when filtered by array-contains uid", async () => {
    await seedMembership("p1xxxxxx", "arxiv:1", [ALICE]);
    await assertSucceeds(
      getDocs(query(collectionGroup(authed(ALICE), "projectPapers"), where("memberUids", "array-contains", ALICE))),
    );
  });
  it("reaches a shared project's memberships too", async () => {
    await seedMembership("p2xxxxxx", "arxiv:2", [BOB, ALICE]);
    await assertSucceeds(
      getDocs(query(collectionGroup(authed(ALICE), "projectPapers"), where("memberUids", "array-contains", ALICE))),
    );
  });
  it("rejects an unfiltered collectionGroup query (could span other users)", async () => {
    await assertFails(getDocs(collectionGroup(authed(ALICE), "projectPapers")));
  });
  it("rejects querying another user's memberships", async () => {
    await seedMembership("p3xxxxxx", "arxiv:1", [BOB]);
    await assertFails(
      getDocs(query(collectionGroup(authed(ALICE), "projectPapers"), where("memberUids", "array-contains", BOB))),
    );
  });
});
