import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Production-parity guards.
//
// Several prod-only outages slipped through because the dev/emulator setup is
// more forgiving than production:
//   - the web searched arXiv via a `/arxiv-api` Vite dev proxy that had no
//     Firebase Hosting rewrite, so in prod that path fell through to index.html;
//   - the dev proxy and the firebase.json rewrites listed routes separately and
//     silently drifted (/api/me was prod-only, /arxiv-api was dev-only);
//   - a collectionGroup query needed a COLLECTION_GROUP index that the Firestore
//     emulator silently doesn't require, so it only failed once deployed.
//
// These are config-parity bugs: nothing in the *code* is wrong, the dev and prod
// environments just disagree. The emulator can't catch them, so we assert the
// invariants directly against the committed config files. Fast + hermetic.
//
// The first class is now mostly designed away: all backend calls go through a
// single `/api/**` → `api` gateway (one Hosting rewrite, one Vite proxy, no
// per-route list to keep in sync). These tests lock that shape in.
// ---------------------------------------------------------------------------

const repoFile = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), "utf8");

interface Rewrite {
  source: string;
  function?: string;
  destination?: string;
}

function hostingRewrites(file: string): Rewrite[] {
  const json = JSON.parse(repoFile(file)) as {
    hosting?: { rewrites?: Rewrite[] };
  };
  return json.hosting?.rewrites ?? [];
}

const isSpaCatchAll = (r: Rewrite) =>
  r.source === "**" || (r.destination ?? "").endsWith("index.html");

describe.each(["firebase.json", "firebase.test.json"])(
  "routing parity: %s serves /api via the gateway",
  (file) => {
    const rewrites = hostingRewrites(file);

    it("routes /api/** to the api function", () => {
      const apiRewrite = rewrites.find((r) => r.source === "/api/**");
      expect(
        apiRewrite,
        `${file} must rewrite /api/** to a Cloud Function so same-origin API ` +
          `calls reach the backend instead of falling through to the SPA.`,
      ).toBeDefined();
      expect(apiRewrite!.function).toBe("api");
    });

    it("places the /api rewrite before the SPA catch-all (order matters)", () => {
      const apiIdx = rewrites.findIndex((r) => r.source === "/api/**");
      const spaIdx = rewrites.findIndex(isSpaCatchAll);
      expect(apiIdx).toBeGreaterThanOrEqual(0);
      expect(spaIdx).toBeGreaterThanOrEqual(0);
      // A catch-all ahead of /api/** would swallow API calls into index.html.
      expect(apiIdx).toBeLessThan(spaIdx);
    });

    it("has no leftover per-function /api rewrites (drift surface)", () => {
      const strays = rewrites.filter(
        (r) => r.source.startsWith("/api/") && r.source !== "/api/**",
      );
      expect(strays, `unexpected per-route rewrites: ${JSON.stringify(strays)}`).toEqual(
        [],
      );
    });
  },
);

describe("routing parity: the dev proxy forwards /api to the same gateway", () => {
  // Read vite.config.ts as text (importing it pulls in the build plugins). The
  // dev server must proxy /api so a path that works deployed also works under
  // `pnpm dev`; with a single /api proxy there is no per-route list to drift.
  const viteConfig = repoFile("apps/web/vite.config.ts");

  it('proxies "/api" in the Vite dev server', () => {
    expect(viteConfig).toMatch(/proxy:\s*\{[\s\S]*["']\/api["']\s*:/);
  });

  it("forwards to the api function on the emulator", () => {
    expect(viteConfig).toContain("/paper-baker/us-central1/api");
  });
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
