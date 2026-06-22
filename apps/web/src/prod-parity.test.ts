import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { API_PROXY_MOUNTS } from "./dev-proxy";

// ---------------------------------------------------------------------------
// Production-parity guards.
//
// Several prod-only outages slipped through because the dev/emulator setup is
// more forgiving than production:
//   - the web searched arXiv via a `/arxiv-api` Vite dev proxy that has no
//     Firebase Hosting rewrite, so in prod that path fell through to index.html;
//   - a collectionGroup query needed a COLLECTION_GROUP index that the Firestore
//     emulator silently doesn't require, so it only failed once deployed.
//
// These are config-parity bugs: nothing in the *code* is wrong, the dev and prod
// environments just disagree. The emulator can't catch them, so we assert the
// invariants directly against the committed config files. Fast + hermetic.
// ---------------------------------------------------------------------------

const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

interface Rewrite {
  source: string;
  function?: string;
  destination?: string;
}

function firebaseRewrites(): Rewrite[] {
  const json = JSON.parse(repoFile("firebase.json")) as {
    hosting?: { rewrites?: Rewrite[] };
  };
  return json.hosting?.rewrites ?? [];
}

// The SPA catch-all serves index.html for any unmatched path — it "matches"
// everything, so it must be excluded when asking "is this path backed by a real
// server in prod?".
const isSpaCatchAll = (r: Rewrite) =>
  r.source === "**" || (r.destination ?? "").endsWith("index.html");

describe("routing parity: dev proxy ⊆ prod rewrites", () => {
  // API_PROXY_MOUNTS is the canonical list of same-origin paths the web expects a
  // real backend to serve; the dev server proxies exactly these (vite.config.ts
  // builds its proxy from this list). In production there is no Vite layer —
  // Firebase Hosting serves those paths via `rewrites`. If a path is proxied in
  // dev but has no prod rewrite, it works under `pnpm dev` and 404s/SPA-falls-
  // through once deployed. Every proxy path MUST have a matching prod rewrite.
  const proxyPaths = API_PROXY_MOUNTS.map(({ mount }) => `/api/${mount}`);

  const rewrites = firebaseRewrites().filter((r) => !isSpaCatchAll(r));

  const servedInProd = (proxyPath: string) =>
    rewrites.some(
      (r) =>
        r.source === proxyPath ||
        r.source === `${proxyPath}/**` ||
        r.source.startsWith(`${proxyPath}/`),
    );

  it("has at least one proxy path to check (guards against a no-op test)", () => {
    expect(proxyPaths.length).toBeGreaterThan(0);
  });

  it.each(proxyPaths)(
    "dev proxy %s is served by a production Hosting rewrite",
    (proxyPath) => {
      expect(
        servedInProd(proxyPath),
        `Vite proxies "${proxyPath}" in dev, but firebase.json has no Hosting ` +
          `rewrite for it — in production that path falls through to the SPA ` +
          `(index.html). Add a rewrite, or stop relying on the proxy in prod.`,
      ).toBe(true);
    },
  );
});

describe("Firestore index parity: required indexes are declared", () => {
  // The Firestore emulator does NOT enforce composite / collection-group index
  // requirements, so a query that needs one passes locally and throws
  // failed-precondition in prod. We can't make the emulator strict, so we assert
  // the indexes our queries depend on are present in the deployed config.
  //
  // MAINTENANCE: any new query that needs an index (a collectionGroup query, an
  // array-contains, a where + orderBy on different fields, or multiple range
  // filters) must be added to firebase/firestore.indexes.json AND asserted here.
  const config = JSON.parse(repoFile("firebase/firestore.indexes.json")) as {
    indexes: { collectionGroup: string; queryScope: string; fields: unknown[] }[];
    fieldOverrides?: {
      collectionGroup: string;
      fieldPath: string;
      indexes: { arrayConfig?: string; order?: string; queryScope: string }[];
    }[];
  };

  it("declares the collection-group array-contains index for projectPapers.memberUids", () => {
    // Backs subscribeMemberships(): collectionGroup("projectPapers") +
    // where("memberUids", "array-contains", uid). Needs a COLLECTION_GROUP-scoped
    // CONTAINS index — the exact one whose absence broke prod.
    const override = (config.fieldOverrides ?? []).find(
      (o) => o.collectionGroup === "projectPapers" && o.fieldPath === "memberUids",
    );
    expect(override, "missing fieldOverride for projectPapers.memberUids").toBeDefined();
    expect(
      override!.indexes.some(
        (i) => i.arrayConfig === "CONTAINS" && i.queryScope === "COLLECTION_GROUP",
      ),
    ).toBe(true);
  });

  it("declares the projects ownerUid+id composite index", () => {
    const idx = config.indexes.find((i) => i.collectionGroup === "projects");
    expect(idx, "missing composite index for projects").toBeDefined();
  });
});
