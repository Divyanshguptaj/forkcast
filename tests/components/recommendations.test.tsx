// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RecommendationResults } from "@/components/results/RecommendationResults";
import { PriceTag } from "@/components/results/PriceTag";
import { agentReducer, createInitialRunState } from "@/lib/agent/reducer";
import { SCENARIOS, type ScenarioId } from "@/mocks/replay/scenarios";
import { RecommendationSetSchema, type RecommendationSet } from "@/schemas/recommendations";
import { recommend } from "@/server/ranking";
import { budget, candidate, dish, extraction, request } from "../helpers/rankKit";
import { mockMatchMedia } from "../setup";

beforeEach(() => mockMatchMedia(false));

function setFor(id: ScenarioId): RecommendationSet {
  const state = SCENARIOS[id].steps.reduce((s, { event }) => agentReducer(s, { type: "event", event }), createInitialRunState());
  expect(state.recommendations).toBeDefined();
  return state.recommendations!;
}

describe("recorded run results", () => {
  const set = setFor("recorded");

  it("stores a valid recommendation set in the run state and completes the run", () => {
    expect(RecommendationSetSchema.safeParse(set).success).toBe(true);
    const state = SCENARIOS.recorded.steps.reduce((s, { event }) => agentReducer(s, { type: "event", event }), createInitialRunState());
    expect(state.stages).toMatchObject({ compare: "done", ready: "done" });
  });

  it("renders ranked cards with dishes, prices, evidence, caveats and sources", () => {
    render(<RecommendationResults set={set} />);
    expect(screen.getByRole("heading", { level: 2, name: /Your best matches/ })).toBeInTheDocument();
    const cards = screen.getAllByTestId("recommendation-card");
    expect(cards).toHaveLength(set.recommendations.length);
    const first = within(cards[0]);
    expect(first.getByRole("heading", { level: 3 })).toHaveTextContent("Trattoria Marina");
    expect(first.getByText("VEGETARIANA")).toBeInTheDocument();
    expect(first.getAllByText("€14.50").length).toBeGreaterThan(0);
    expect(first.getByText("Matches everything")).toBeInTheDocument();
    expect(first.getAllByRole("link").some((a) => a.getAttribute("href")?.includes("maps"))).toBe(true);
    expect(cards.every((c) => within(c).getAllByRole("link").every((a) => a.getAttribute("rel")?.includes("noopener")))).toBe(true);
    const uncertain = cards.find((c) => c.getAttribute("data-tier") === "uncertain")!;
    expect(within(uncertain).getAllByText(/group booking/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Not recommended \(/)).toBeInTheDocument();
  });

  it("separates hard requirements from preferences", () => {
    render(<RecommendationResults set={set} />);
    expect(screen.getByText("Must have").nextElementSibling).toHaveTextContent("Vegetarian");
    expect(screen.getByText("Nice to have").nextElementSibling).toHaveTextContent("Italian cuisine");
  });
});

describe("no exact match", () => {
  it("explains that nothing fully matches and labels what each option misses", () => {
    const set = setFor("recorded-no-exact");
    render(<RecommendationResults set={set} />);
    expect(screen.getByRole("heading", { level: 2, name: /No exact match/ })).toBeInTheDocument();
    expect(screen.getByText(/No restaurant satisfied every requirement/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Closest options" })).toBeInTheDocument();
    expect(screen.getAllByText("Doesn't match").length).toBeGreaterThan(0);
  });

  it("says plainly when nothing can be recommended", () => {
    const set = recommend({ request: request({ diet: ["vegan"] }), candidates: [candidate("a", undefined), candidate("b", extraction("b", [dish({ veg: "unknown" })]))] });
    render(<RecommendationResults set={set} />);
    expect(screen.getByRole("heading", { level: 2, name: /Nothing we can recommend/ })).toBeInTheDocument();
    expect(screen.queryAllByTestId("recommendation-card")).toHaveLength(0);
    expect(screen.getByText(/None of the restaurants could be confirmed/)).toBeInTheDocument();
  });
});

describe("price display", () => {
  it("shows disputed prices as disputed rather than as a price", () => {
    const { container } = render(<PriceTag price={4.5} status="disputed" />);
    expect(container).toHaveTextContent("Price disputed");
    expect(screen.getByLabelText("Disputed price €4.50")).toBeInTheDocument();
  });

  it("renders a disputed dish with both readings", () => {
    const set = recommend({
      request: request({ diet: ["vegetarian"], budget: budget(30) }),
      candidates: [candidate("a", extraction("a", [dish({ name: "Pa amb tomàquet", veg: "confirmed", price: 4.5, priceStatus: "disputed", alternate: 14.5 })]))],
    });
    render(<RecommendationResults set={set} />);
    expect(screen.getByText("other reading €14.50")).toBeInTheDocument();
    expect(screen.getAllByText("Needs checking").length).toBeGreaterThan(0);
    expect(screen.queryByText(/within €30/)).toBeNull();
  });
});
