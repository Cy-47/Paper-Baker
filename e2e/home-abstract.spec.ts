import { test, expect, type Page } from "@playwright/test";
import { seedPaperMeta } from "./seed";

// E2E for the click-to-expand abstract behaviour on the shared PaperRow
// component, exercised on the Home, Library, and Project pages. Seeding uses the
// dev-only __pbSaveToLibrary hook (thin savedPapers) plus seedPaperMeta (papers/
// metadata into the emulator) so the flow is deterministic and independent of
// the live arxiv API.

const PAPER = {
  paperId: "arxiv:1706.03762",
  source: { type: "arxiv", id: "1706.03762" },
  title: "Attention Is All You Need",
  abstract:
    "We propose the Transformer, based solely on attention mechanisms, dispensing with recurrence entirely.",
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
  await page.goto("/");
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { __pbDevSignIn?: unknown }).__pbDevSignIn ===
      "function"
  );
  await page.evaluate(() =>
    (window as unknown as { __pbDevSignIn: () => Promise<unknown> }).__pbDevSignIn()
  );
  await expect(
    page.getByRole("complementary").getByRole("link", { name: "Find papers" })
  ).toBeVisible();
}

async function seed(page: Page) {
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

// Click the paper's row, expect the abstract to appear, click again, expect it
// gone. `scope` is the container the row lives in (page or a region).
async function expectToggle(page: Page, scope = page.getByRole("main")) {
  const entry = scope.getByRole("button", { expanded: false }).filter({
    hasText: PAPER.title,
  });
  await expect(entry).toBeVisible();
  await expect(scope.getByText(PAPER.abstract)).toBeHidden();

  await entry.click();
  await expect(scope.getByText(PAPER.abstract)).toBeVisible();

  await scope.getByRole("button", { expanded: true }).filter({ hasText: PAPER.title }).click();
  await expect(scope.getByText(PAPER.abstract)).toBeHidden();
}

test("Home page toggles a saved paper's abstract", async ({ page }) => {
  await signIn(page);
  await seed(page);
  await page.goto("/");
  await expectToggle(page);
});

test("Library page toggles a saved paper's abstract", async ({ page }) => {
  await signIn(page);
  await seed(page);
  await page.goto("/library");
  await expectToggle(page);
});

test("Project page toggles a filed paper's abstract", async ({ page }) => {
  await signIn(page);
  await seed(page);

  // File the seeded paper into a fresh project via the save panel.
  await page.goto("/library");
  await page.getByRole("button", { name: "Add to project" }).first().click();
  const projectName = `Proj ${Date.now()}`;
  await page.getByPlaceholder("New project…").fill(projectName);
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("dialog").getByText(projectName)).toBeVisible();
  await page.locator('[data-slot="drawer-backdrop"]').click({ position: { x: 8, y: 8 } });
  await expect(page.getByRole("dialog")).toBeHidden();

  // Open the project page and toggle the abstract there.
  await page.getByRole("link", { name: new RegExp(projectName) }).click();
  await expectToggle(page);

  // The membership chip surfaces inside the paper's row on Home.
  await page.goto("/");
  const row = page.getByRole("main").getByRole("button").filter({ hasText: PAPER.title });
  await expect(row.getByText(projectName)).toBeVisible();
});
