import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { SCENARIOS } from "../../src/mocks/replay/scenarios";

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
    await expect(page.getByText(/Replay of a recorded run/)).toBeVisible();
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

test.describe("recommendation results", () => {
  test("ranks real recorded menus with dishes, verified prices, evidence and sources", async ({ page }, info) => {
    await page.goto("/?scenario=recorded&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    const cards = page.getByTestId("recommendation-card");
    await expect(cards).toHaveCount(4);
    await expect(cards.first()).toContainText("Trattoria Marina");
    await expect(cards.first()).toContainText("Matches everything");
    await expect(cards.first()).toContainText("VEGETARIANA");
    await expect(cards.first()).toContainText("€14.50");
    await expect(page.locator('[data-tier="uncertain"]')).toContainText("group booking");
    await expect(page.getByTestId("excluded-list")).toContainText("Elio's");
    await expect(page.getByText("Design preview with invented data")).toHaveCount(0);
    await noHorizontalOverflow(page);
    await page.getByTestId("recommendation-results").screenshot({ path: `${SHOT_DIR}/recommendations-${info.project.name}.png` });
    await cards.first().screenshot({ path: `${SHOT_DIR}/recommendation-card-${info.project.name}.png` });
  });

  test("labels the closest options when nothing matches exactly", async ({ page }) => {
    await page.goto("/?scenario=recorded-no-exact&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /No exact match/ })).toBeVisible();
    await expect(page.getByText("No restaurant satisfied every requirement")).toBeVisible();
    await expect(page.locator('[data-tier="exact"]')).toHaveCount(0);
    await expect(page.getByTestId("recommendation-card").first()).toContainText("Doesn't match");
    await noHorizontalOverflow(page);
  });

  test("results have no critical accessibility violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/?scenario=recorded&speed=0");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    await page.getByText("What we checked").first().click();
    await page.getByText(/How the score/).first().click();
    expect(await axeViolations(page)).toEqual([]);
  });
});

/* The tests below drive the real UI and real client code against a MOCKED /api/recommend (recorded events or synthetic errors). */
function sse(events: Array<Record<string, unknown>>): string {
  return events.map((e, seq) => `event: ${String(e.type)}
data: ${JSON.stringify({ runId: "mock-run", seq, ts: "2026-10-08T12:00:00.000Z", ...e })}

`).join("");
}

const recordedBody = () => SCENARIOS.recorded.steps.map((s) => s.event).map((e, seq) => `event: ${e.type}
data: ${JSON.stringify({ ...e, runId: "mock-run", seq })}

`).join("");

async function mockRecommend(page: Page, respond: (postData: string) => { status?: number; body: string; contentType?: string }) {
  const bodies: string[] = [];
  await page.route("**/api/recommend", async (route) => {
    const post = route.request().postData() ?? "";
    bodies.push(post);
    const r = respond(post);
    await route.fulfill({ status: r.status ?? 200, contentType: r.contentType ?? "text/event-stream", body: r.body });
  });
  return bodies;
}

test.describe("live flow (network mocked)", () => {
  test("a typed sentence is sent to the API and the streamed results are shown", async ({ page }, info) => {
    const bodies = await mockRecommend(page, () => ({ body: recordedBody() }));
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian Italian dinner under €30");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    expect(JSON.parse(bodies[0]).text).toBe("vegetarian Italian dinner under €30");
    await expect(page.getByText(/Replay of a recorded/)).toHaveCount(0);
    await expect(page.getByTestId("demo-bar")).toHaveCount(0);
    await expect(page.getByTestId("recommendation-card").first()).toContainText("Matches everything");
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOT_DIR}/live-results-${info.project.name}.png`, fullPage: true });
  });

  test("an empty search asks for input and sends nothing", async ({ page }) => {
    const bodies = await mockRecommend(page, () => ({ body: recordedBody() }));
    await page.goto("/");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.locator("#craving-problem")).toContainText("Describe what you are hungry for");
    expect(bodies).toHaveLength(0);
  });

  test("a rate-limit response is explained and the search can be edited", async ({ page }) => {
    await mockRecommend(page, () => ({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "rate_limited", message: "You have searched a lot recently. Please wait a little before searching again." } }) }));
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegan lunch");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.locator('[data-notice="rate_limited"]')).toContainText("searched a lot recently");
    await page.getByRole("button", { name: "Edit search" }).first().click();
    await expect(page.getByLabel("What are you hungry for?")).toHaveValue("vegan lunch");
  });

  test("a conflicting request shows the reason and no retry button", async ({ page }) => {
    await mockRecommend(page, () => ({ body: sse([{ type: "run.started" }, { type: "error", code: "conflicting_request", message: 'Your request asks for a vegan diet and also for "steak". Please remove one of them.', recoverable: false }]) }));
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegan steak");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.locator('[data-notice="request_problem"]')).toContainText("steak");
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
  });

  test("an unavailable service can be retried", async ({ page }) => {
    let attempts = 0;
    await mockRecommend(page, () => (++attempts === 1 ? { status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "not_configured", message: "Forkcast is not configured on this server." } }) } : { body: recordedBody() }));
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.locator('[data-notice="service_unavailable"]')).toBeVisible();
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    expect(attempts).toBe(2);
  });

  test("no restaurants found shows the friendly empty state", async ({ page }) => {
    await mockRecommend(page, () => ({ body: sse([{ type: "run.started" }, { type: "discover.started", city: "Barcelona" }, { type: "discover.found", count: 0 }]) }));
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegan dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByText("No tables found")).toBeVisible();
  });

  test("a search can be cancelled while it runs", async ({ page }) => {
    await page.route("**/api/recommend", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      await route.abort().catch(() => undefined);
    });
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegan dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await page.getByRole("button", { name: "Cancel search" }).click();
    await expect(page.getByLabel("What are you hungry for?")).toHaveValue("vegan dinner");
    await expect(page.getByRole("button", { name: "Cancel search" })).toHaveCount(0);
  });

  test("live results have no critical accessibility violations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockRecommend(page, () => ({ body: recordedBody() }));
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian Italian dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
  });
});

/* The tests below use the REAL browser client, REAL /api/recommend handler and REAL orchestrator, resolver, extractor and ranking.
   Only the external providers (Places, Gemini, the restaurants' websites) are deterministic fakes inside tests/e2e/harness/server.ts. */
const HARNESS = "http://localhost:3130";

async function useHarness(page: Page, scenario = "default", tag = "none") {
  await page.route("**/api/recommend", (route) => route.continue({ url: `${HARNESS}/api/recommend`, headers: { ...route.request().headers(), "x-scenario": scenario, "x-tag": tag } }));
}

const harnessState = async (request: import("@playwright/test").APIRequestContext, tag: string) => (await request.get(`${HARNESS}/__state?tag=${encodeURIComponent(tag)}`)).json() as Promise<{ started: number; completed: number; aborted: number }>;

test.describe("real API and orchestrator (fake providers)", () => {
  test("a sentence goes through the real pipeline and renders evidence-backed results", async ({ page, request }, info) => {
    const tag = `pipeline-${info.project.name}`;
    await useHarness(page, "default", tag);
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian Italian dinner under €30");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Your best matches/ })).toBeVisible();
    const cards = page.getByTestId("recommendation-card");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("Risotto de setas (V)");
    await expect(cards.first()).toContainText("€14.50");
    await expect(cards.first()).not.toContainText("Croquetas");
    await expect(cards.first()).toContainText("Budget");
    await page.getByTestId("run-summary").locator("summary").click();
    await expect(page.getByTestId("run-summary")).toContainText("AI requests");
    await noHorizontalOverflow(page);
    await page.screenshot({ path: `${SHOT_DIR}/e2e-real-api-${info.project.name}.png`, fullPage: true });
    await expect.poll(() => harnessState(request, tag)).toMatchObject({ started: 1, completed: 1, aborted: 0 });
  });

  test("an unsupported city is rejected by the real understanding step", async ({ page }) => {
    await useHarness(page);
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegan dinner in Madrid");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.locator('[data-notice="request_problem"]')).toContainText("Barcelona");
  });

  test("restaurants without readable menus are explained, not guessed", async ({ page }) => {
    await useHarness(page, "nomenu");
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("heading", { name: /Nothing we can recommend/ })).toBeVisible();
    await page.getByTestId("excluded-list").locator("summary").click();
    await expect(page.getByTestId("excluded-list")).toContainText("Casa Dos");
  });

  test("AI quota exhaustion is disclosed and the search still finishes", async ({ page }) => {
    await useHarness(page, "quota");
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByTestId("recommendation-results")).toBeVisible();
    await expect(page.getByTestId("recommendation-results")).toContainText("daily limit");
  });

  test("cancelling in the browser stops the search on the server", async ({ page, request }, info) => {
    const tag = `cancel-${info.project.name}`;
    await useHarness(page, "slow", tag);
    await page.goto("/");
    await page.getByLabel("What are you hungry for?").fill("vegetarian dinner");
    await page.getByRole("button", { name: /Find my table/ }).click();
    await expect(page.getByRole("button", { name: "Cancel search" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel search" }).click();
    await expect(page.getByLabel("What are you hungry for?")).toBeVisible();
    await expect.poll(async () => (await harnessState(request, tag)).aborted, { timeout: 10_000 }).toBe(1);
    expect((await harnessState(request, tag)).completed).toBe(0);
  });
});

test("design gallery renders every notice and has no critical accessibility violations", async ({ page }, info) => {
  await page.goto("/dev/gallery");
  await expect(page.getByRole("heading", { name: "Forkcast design gallery" })).toBeVisible();
  await expect(page.locator("[data-notice]")).toHaveCount(15);
  await page.screenshot({ path: `${SHOT_DIR}/gallery-${info.project.name}.png` });
  expect(await axeViolations(page)).toEqual([]);
});
