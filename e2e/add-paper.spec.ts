import { test, expect, type Page } from "@playwright/test";
import { seedPaperMeta } from "./seed";

// E2E for the redesigned app. Paper saving is seeded via the dev-only
// __pbSaveToLibrary hook (thin savedPapers record) plus seedPaperMeta (the
// papers/ metadata, straight into the emulator), so the core UI/data flows (save
// panel, project filing, library, project pages) are deterministic and don't
// depend on the live arxiv API (its relevance + rate limits are covered by
// integration tests).

const PAPER = {
  paperId: "arxiv:1706.03762",
  source: { type: "arxiv", id: "1706.03762" },
  title: "Attention Is All You Need",
  abstract: "We propose the Transformer, based solely on attention mechanisms.",
  authors: [{ name: "Ashish Vaswani" }, { name: "Noam Shazeer" }],
  publishedAt: "2017-01-01T00:00:00Z",
  categories: ["cs.CL"],
  links: {
    abs: "https://arxiv.org/abs/1706.03762",
    pdf: "https://arxiv.org/pdf/1706.03762",
  },
  sourceStatus: "available",
};

async function signIn(page: Page) {
  // Sign in on /login: while unauthenticated it shows the form (no redirect away),
  // and its useEffect does a CLIENT-SIDE navigate to /home once auth resolves —
  // preserving the live emulator session (a full reload/goto would drop it, and
  // racing Root's "/" → /site redirect is flaky).
  await page.goto("/login");
  await page.waitForFunction(
    () => typeof (window as unknown as { __pbDevSignIn?: unknown }).__pbDevSignIn === "function"
  );
  await page.evaluate(() =>
    (window as unknown as { __pbDevSignIn: () => Promise<string> }).__pbDevSignIn()
  );
  // A brand-new account hits the handle-onboarding modal. Only the FIRST signed-in
  // test of a run sees it — the claimed handle persists in the emulator (firestore
  // isn't wiped between tests), so later tests load straight into the app.
  const handleInput = page.getByLabel("Handle");
  try {
    await handleInput.waitFor({ state: "visible", timeout: 4000 });
    await handleInput.fill("dev-user");
    await page.getByRole("button", { name: /continue/i }).click();
  } catch {
    /* handle already claimed earlier in the run — no modal */
  }
  await expect(
    page.getByRole("complementary").getByRole("link", { name: "Find papers" })
  ).toBeVisible();
}

async function seed(page: Page) {
  // Metadata into the global papers/ cache (emulator-direct), then the thin
  // savedPapers record via the in-app dev hook.
  await seedPaperMeta(PAPER);
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __pbSaveToLibrary?: unknown })
        .__pbSaveToLibrary === "function"
  );
  await page.evaluate(async (paper) => {
    await (
      window as unknown as {
        __pbSaveToLibrary: (p: unknown, ids: string[]) => Promise<void>;
      }
    ).__pbSaveToLibrary(paper, []);
  }, PAPER);
}

test("save panel files a paper into a new project across the app", async ({ page }) => {
  await signIn(page);
  await seed(page);

  await page.goto("/library");
  // Scope to the main list — the sidebar "Papers" nav also shows the title.
  await expect(page.getByRole("main").getByText(PAPER.title)).toBeVisible();
  // The seeded paper has no project yet.
  await expect(page.getByText("No project", { exact: true })).toBeVisible();

  // Open the Save panel and create + tick a project.
  await page.getByRole("button", { name: "Add to project" }).first().click();
  const projectName = `Proj ${Date.now()}`;
  await page.getByPlaceholder("New project…").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();

  // It appears in the panel's project list, and (below) in the sidebar + chip.
  await expect(page.getByRole("dialog").getByText(projectName)).toBeVisible();
  // Dismiss the drawer by clicking its backdrop (top-left, outside the panel).
  await page.locator('[data-slot="drawer-backdrop"]').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("link", { name: new RegExp(projectName) })).toBeVisible();

  // The library row now shows the project chip instead of "No project".
  await expect(page.getByRole("main").getByText(projectName)).toBeVisible();

  // The project page lists the paper; removing it returns it to unfiled.
  await page.getByRole("link", { name: new RegExp(projectName) }).click();
  await expect(page.getByRole("main").getByText(PAPER.title)).toBeVisible();
  await page.getByRole("button", { name: "Remove from this project" }).click();
  await expect(
    page.getByText("No papers yet", { exact: false })
  ).toBeVisible();
});

test("Save on the Find page opens the panel for a freshly-saved paper", async ({ page }) => {
  await signIn(page);

  // A paper that has never been saved (unique id per run), so clicking Save
  // genuinely fires the save path rather than short-circuiting on isSaved.
  const fresh = {
    ...PAPER,
    paperId: `arxiv:9999.${Date.now()}`,
    source: { type: "arxiv", id: `9999.${Date.now()}` },
    title: `Fresh Find Paper ${Date.now()}`,
  };

  // Make the arxiv search deterministic: return our fresh paper for any query.
  await page.route(/\/papers\/search/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([fresh]),
    })
  );

  // Stub the save so it succeeds but writes nothing to Firestore. The paper
  // therefore never reaches the library snapshot, so itemFor(id) stays undefined
  // for the whole assertion window — pinning open the exact race the fix targets:
  // the panel must render from the paper we hand it, not flash closed waiting on
  // the Firestore snapshot + papers/ metadata round-trip.
  await page.route(/\/api\/library$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ paperId: fresh.paperId, savedAt: "2020-01-01T00:00:00Z" }),
        })
      : route.continue()
  );

  await page.goto("/find?q=fresh%20find%20paper");
  await expect(page.getByRole("main").getByText(fresh.title)).toBeVisible();

  await page.getByRole("main").getByRole("button", { name: "Save" }).click();

  // The panel stays open and shows the paper (it would flash closed before the fix).
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByText(fresh.title)).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Add to projects")).toBeVisible();
});

test("Home renders a saved paper after its server timestamp resolves", async ({ page }) => {
  await signIn(page);
  await seed(page);

  // Reload to force a fresh server read: savedAt now comes back as a resolved
  // Firestore Timestamp (the optimistic local write reads back as null and hides
  // the bug). Before the fix, Home's savedAt.localeCompare sort threw here.
  // The reload drops the emulator auth session, bouncing to /login; re-establish
  // it (LoginPage then client-side-navigates back to /home with the fresh read).
  await page.reload();
  await page.waitForFunction(
    () => typeof (window as unknown as { __pbDevSignIn?: unknown }).__pbDevSignIn === "function"
  );
  await page.evaluate(() =>
    (window as unknown as { __pbDevSignIn: () => Promise<string> }).__pbDevSignIn()
  );
  await expect(
    page.getByRole("complementary").getByRole("link", { name: "Find papers" })
  ).toBeVisible();

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText(PAPER.title)).toBeVisible();
});

test("renames a project and the new name propagates across the app", async ({ page }) => {
  await signIn(page);
  await seed(page);

  // Create a project (this also files the seeded paper into it) via the save panel.
  await page.goto("/library");
  await page.getByRole("button", { name: "Add to project" }).first().click();
  const original = `Proj ${Date.now()}`;
  await page.getByPlaceholder("New project…").fill(original);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("dialog").getByText(original)).toBeVisible();
  await page.locator('[data-slot="drawer-backdrop"]').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog")).toBeHidden();

  // Go to the project page and rename it inline.
  await page.getByRole("complementary").getByRole("link", { name: new RegExp(original) }).click();
  await expect(page.getByRole("heading", { name: original })).toBeVisible();
  const url = page.url(); // stable id in the URL — must NOT change on rename
  await page.getByRole("button", { name: "Rename project" }).click();
  const renamed = `${original} Renamed`;
  await page.getByLabel("Project name").fill(renamed);
  await page.getByRole("button", { name: "Save" }).click();

  // (1) Project page heading updates; the URL (stable id) is unchanged.
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();
  expect(page.url()).toBe(url);

  // (2) Sidebar link updates.
  await expect(
    page.getByRole("complementary").getByRole("link", { name: new RegExp(renamed) })
  ).toBeVisible();

  // (3) The library chip on the filed paper updates.
  await page.goto("/library");
  await expect(page.getByRole("main").getByText(renamed)).toBeVisible();
});
