import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOT_DIR = "docs/screenshots";

async function noHorizontalOverflow(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  const overflow = await page.evaluate((w) => document.documentElement.scrollWidth - w, width);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function axeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  return results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
}

test.describe("compose", () => {
  test("explains the product and fills filters from an example", async ({ page }, info) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("hungry");
    await expect(page.getByLabel("What are you hungry for?")).toBeVisible();

    await page.getByRole("button", { name: /Vegan brunch somewhere relaxed/ }).click();
    await expect(page.getByLabel("What are you hungry for?")).toHaveValue("Vegan brunch somewhere relaxed");
    await expect(page.getByRole("button", { name: /Meal.*Brunch/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Diet.*Vegan/ })).toBeVisible();

    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOT_DIR}/compose-${info.project.name}.png`, fullPage: true });
  });

  test("preference panels open with keyboard and update the summary", async ({ page }) => {
    await page.goto("/");
    const diet = page.getByRole("button", { name: /Diet/ });
    await diet.focus();
    await page.keyboard.press("Enter");
    await expect(diet).toHaveAttribute("aria-expanded", "true");
    const vegetarian = page.getByRole("group", { name: "Dietary preferences" }).getByRole("button", { name: "Vegetarian" });
    await vegetarian.click();
    await expect(vegetarian).toHaveAttribute("aria-pressed", "true");
    await expect(diet).toContainText("Vegetarian");

    await page.getByRole("button", { name: /Budget/ }).click();
    await page.getByRole("button", { name: "Any budget" }).click();
    await page.getByLabel("Maximum budget per person in euros").focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("button", { name: /Budget/ })).toContainText("Under €45");
  });

  test("has no critical accessibility violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe("research replay", () => {
  test("shows shortlist, degraded menus and demo preview results", async ({ page }, info) => {
    await page.goto("/?scenario=full-demo&speed=6");
    await page.getByRole("button", { name: /Find my table/ }).click();

    await expect(page.getByRole("region", { name: "Discovery summary" })).toContainText("places discovered");
    await expect(page.getByRole("heading", { name: /5 places made the shortlist/ })).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/research-shortlist-${info.project.name}.png`, fullPage: true });

    await expect(page.getByText("Menu found, but we couldn't read it")).toBeVisible();
    await expect(page.getByRole("link", { name: /View official menu/ })).toHaveAttribute("href", "https://www.viento.example/");
    await expect(page.locator('[data-notice="menu_unavailable"]')).toBeVisible();
    await page.screenshot({ path: `${SHOT_DIR}/research-menus-${info.project.name}.png`, fullPage: true });

    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    await expect(page.getByText("Design preview with invented data")).toBeVisible();
    await noHorizontalOverflow(page);
    await page.locator("article").first().screenshot({ path: `${SHOT_DIR}/results-card-${info.project.name}.png` });
  });

  test("renders the real discovery-only run without inventing research", async ({ page }) => {
    await page.goto("/?scenario=phase2&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /5 places made the shortlist/ })).toBeVisible();
    await expect(page.getByText("Discovery is complete")).toBeVisible();
    await expect(page.getByText("Menu ticket")).toHaveCount(0);
    await expect(page.getByText("Recorded discovery run").or(page.getByText(/Replay of a recorded discovery run/))).toBeVisible();
    await expect(page.getByText("Your best matches")).toHaveCount(0);
  });

  test("shows friendly states for no results and a Places outage", async ({ page }) => {
    await page.goto("/?scenario=no-results&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByText("No tables found")).toBeVisible();

    await page.goto("/?scenario=places-down&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.locator('[data-notice="places_unavailable"]')).toContainText("restaurant directory");
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });

  test("shows partial results after a timeout", async ({ page }) => {
    await page.goto("/?scenario=timeout&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByText("Partial results")).toBeVisible();
  });

  test("respects reduced motion and still completes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?scenario=full-demo&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    await expect(page.getByRole("region", { name: "Discovery summary" })).toContainText("29");
    const animated = await page.evaluate(() => {
      const el = document.querySelector("[data-stage='research'] span");
      return el ? getComputedStyle(el).animationName : "none";
    });
    expect(["none", "pulse-ring"]).toContain(animated);
  });

  test("research view has no critical accessibility violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?scenario=full-demo&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

test("design gallery renders every notice and has no critical accessibility violations", async ({ page }, info) => {
  await page.goto("/dev/gallery");
  await expect(page.getByRole("heading", { name: "Forkcast design gallery" })).toBeVisible();
  await expect(page.locator("[data-notice]")).toHaveCount(12);
  await page.screenshot({ path: `${SHOT_DIR}/gallery-${info.project.name}.png` });
  expect(await axeViolations(page)).toEqual([]);
});
