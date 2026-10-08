// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentResearchView } from "@/components/research/AgentResearchView";
import { MenuTicket } from "@/components/research/MenuTicket";
import { ResearchTrail } from "@/components/research/ResearchTrail";
import { ShortlistBoard } from "@/components/research/ShortlistBoard";
import { DietBadge } from "@/components/results/DietBadge";
import { PriceTag } from "@/components/results/PriceTag";
import { RecommendationCardShell } from "@/components/results/RecommendationCardShell";
import { SourceIndicator } from "@/components/results/SourceIndicator";
import { NOTICE_COPY, StatusNotice, type NoticeKind } from "@/components/states/StatusNotice";
import { agentReducer, createInitialRunState } from "@/lib/agent/reducer";
import type { RunState } from "@/lib/agent/types";
import { RESULT_PREVIEW } from "@/mocks/replay/resultPreview";
import { SCENARIOS, type ScenarioId } from "@/mocks/replay/scenarios";
import { mockMatchMedia } from "../setup";

function stateFor(id: ScenarioId, upTo?: (type: string, seq: number) => boolean): RunState {
  let s = createInitialRunState();
  for (const { event } of SCENARIOS[id].steps) {
    if (upTo && !upTo(event.type, event.seq)) break;
    s = agentReducer(s, { type: "event", event });
  }
  return s;
}

beforeEach(() => mockMatchMedia(false));

describe("shortlist rendering", () => {
  const state = stateFor("phase2");

  it("shows the five shortlisted restaurants with the Phase 2 facts", () => {
    render(<ShortlistBoard state={state} mocked={false} />);
    expect(screen.getByRole("heading", { name: "5 places made the shortlist" })).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem").filter((li) => li.hasAttribute("data-restaurant"));
    expect(rows).toHaveLength(5);
    const first = rows[0];
    expect(within(first).getByText("Osteria Alba")).toBeInTheDocument();
    expect(within(first).getByText(/4\.8 \(3,120 reviews\)/)).toBeInTheDocument();
    expect(within(first).getByText("€€")).toBeInTheDocument();
    expect(within(first).getByText(/0\.5 km from the center/)).toBeInTheDocument();
    expect(within(first).getByText("Italian restaurant")).toBeInTheDocument();
  });

  it("is clearly not a recommendation list and invents nothing", () => {
    render(<ShortlistBoard state={state} mocked={false} />);
    expect(screen.getByText(/Research candidates, not recommendations yet/)).toBeInTheDocument();
    expect(screen.queryByText(/% match/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Menu ticket/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/vegetarian options/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Waiting for menu research…")).toHaveLength(5);
    expect(screen.getAllByText("Waiting")).toHaveLength(5);
  });

  it("shows skeletons while the shortlist is being chosen and nothing before discovery", () => {
    const searching = stateFor("phase2", (type) => type !== "shortlist.done");
    const { container, rerender } = render(<ShortlistBoard state={searching} mocked={false} />);
    expect(screen.getByText(/Picking the places worth a closer look/)).toBeInTheDocument();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    rerender(<ShortlistBoard state={createInitialRunState()} mocked={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("omits a missing Maps link instead of faking one", () => {
    render(<ShortlistBoard state={state} mocked={false} />);
    expect(screen.queryByRole("link", { name: /Google Maps/ })).not.toBeInTheDocument();
  });
});

describe("degraded menu states", () => {
  const state = stateFor("full-demo");

  it("shows 'menu found but unreadable' as a calm state with the official link", () => {
    render(<ShortlistBoard state={state} mocked />);
    const notice = document.querySelector('[data-notice="menu_unreadable"]') as HTMLElement;
    expect(notice).not.toBeNull();
    expect(notice).toHaveAttribute("role", "status");
    expect(within(notice).getByText("Menu found, but we couldn't read it")).toBeInTheDocument();
    const link = within(notice).getByRole("link", { name: /View official menu/ });
    expect(link).toHaveAttribute("href", "https://www.viento.example/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("explains why a menu could not be read, using the resolver's reason", () => {
    render(<ShortlistBoard state={state} mocked />);
    const notice = document.querySelector('[data-notice="menu_unreadable"]') as HTMLElement;
    expect(notice).toHaveTextContent(/online flipbook viewer/);
    const unavailable = document.querySelector('[data-notice="menu_unavailable"]') as HTMLElement;
    expect(unavailable).toHaveTextContent(/lists no website/);
  });

  it("shows which kind of source a found menu stage came from", () => {
    render(<ShortlistBoard state={state} mocked />);
    const row = document.querySelector('[data-restaurant="demo-alba"]') as HTMLElement;
    expect(row).toHaveTextContent(/official site/);
  });

  it("shows extraction progress and distinguishes partial results", () => {
    render(<ShortlistBoard state={state} mocked />);
    const circolo = document.querySelector('[data-restaurant="demo-alba"]') as HTMLElement;
    expect(circolo).toHaveTextContent("Read 2 menu documents · 4 dishes");
    expect(circolo.querySelector('[data-notice="menu_partial"]')).toBeNull();
    const patsa = document.querySelector('[data-restaurant="demo-atelier"]') as HTMLElement;
    expect(patsa).toHaveTextContent("Read 1 menu document · 2 dishes · 1 skipped");
    expect(patsa.querySelector('[data-notice="menu_partial"]')).not.toBeNull();
  });

  it("lists where the agent looked when no menu exists", () => {
    render(<ShortlistBoard state={state} mocked />);
    const row = document.querySelector('[data-restaurant="demo-elio"]') as HTMLElement;
    expect(row.querySelector('[data-notice="menu_unavailable"]')).not.toBeNull();
    expect(within(row).getByRole("list", { name: "Where we looked for the menu" })).toBeInTheDocument();
  });

  it("flags low-confidence photo menus and unclear prices", () => {
    render(<ShortlistBoard state={state} mocked />);
    expect(document.querySelector('[data-notice="menu_low_confidence"]')).not.toBeNull();
    expect(screen.getByText("Price unclear")).toBeInTheDocument();
    expect(screen.getAllByText("No price listed").length).toBeGreaterThan(0);
  });

  it("shows review research as unavailable without failing the restaurant", () => {
    render(<ShortlistBoard state={state} mocked />);
    const row = document.querySelector('[data-restaurant="demo-atelier"]') as HTMLElement;
    expect(within(row).getByText("Review research unavailable")).toBeInTheDocument();
    expect(row).toHaveAttribute("data-phase", "degraded");
  });

  it("labels simulated research as demo data", () => {
    render(<ShortlistBoard state={state} mocked />);
    expect(screen.getAllByText("Demo data").length).toBeGreaterThan(0);
  });
});

describe("run level states", () => {
  it("renders the right notice for each failure and offers actions", () => {
    const cases: Array<[ScenarioId, NoticeKind]> = [
      ["no-results", "no_results"],
      ["places-down", "places_unavailable"],
      ["timeout", "partial_results"],
    ];
    for (const [scenario, kind] of cases) {
      const { container, unmount } = render(<AgentResearchView state={stateFor(scenario)} mockedStages={false} onEdit={() => undefined} onRetry={() => undefined} />);
      expect(container.querySelector(`[data-notice="${kind}"]`), kind).not.toBeNull();
      expect(screen.getAllByRole("button", { name: /Edit search/ }).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("explains that discovery-only runs have no research yet", () => {
    const ended = agentReducer(stateFor("phase2"), { type: "source.ended" });
    render(<AgentResearchView state={ended} />);
    expect(screen.getByText(/Discovery is complete/)).toBeInTheDocument();
  });
});

describe("request summary", () => {
  it("describes the replayed request, not the composer state", () => {
    render(<AgentResearchView state={stateFor("phase2")} mockedStages={false} />);
    for (const part of ["Barcelona", "Dinner", "vegetarian", "italian", "under €30"]) {
      expect(screen.getAllByText(part).length, part).toBeGreaterThan(0);
    }
  });

  it("shows no summary before the request is understood", () => {
    render(<AgentResearchView state={createInitialRunState()} mockedStages={false} />);
    expect(screen.queryByText("Barcelona")).not.toBeInTheDocument();
  });
});

describe("research trail", () => {
  it("marks the current stage with aria-current and exposes stage status as text", () => {
    const mid = stateFor("phase2", (type) => type !== "discover.found");
    render(<ResearchTrail state={mid} />);
    const current = document.querySelector('[aria-current="step"]') as HTMLElement;
    expect(current).toHaveAttribute("data-stage", "search");
    expect(within(screen.getByRole("navigation", { name: "Research progress" })).getAllByText(/\(done\)|\(not started\)/).length).toBeGreaterThan(0);
  });
});

describe("accessibility and provenance primitives", () => {
  it("StatusNotice uses alert only for real problems", () => {
    for (const kind of Object.keys(NOTICE_COPY) as NoticeKind[]) {
      const { container, unmount } = render(<StatusNotice kind={kind} />);
      const expected = NOTICE_COPY[kind].tone === "problem" ? "alert" : "status";
      expect(container.firstElementChild).toHaveAttribute("role", expected);
      unmount();
    }
  });

  it("diet state is conveyed in words, not only colour", () => {
    for (const [status, text] of [
      ["confirmed_vegetarian", "Vegetarian"],
      ["likely_vegetarian", "Likely vegetarian"],
      ["unknown", "Unclear"],
      ["contains_meat_or_fish", "Contains meat or fish"],
    ] as const) {
      const { unmount } = render(<DietBadge status={status} />);
      expect(screen.getByText(text)).toBeInTheDocument();
      unmount();
    }
  });

  it("price states never show a number when the price is unclear or absent", () => {
    const { rerender, container } = render(<PriceTag status="disputed" />);
    expect(container).toHaveTextContent("Price unclear");
    expect(container.textContent).not.toMatch(/\d/);
    rerender(<PriceTag status="absent" />);
    expect(container).toHaveTextContent("No price listed");
    rerender(<PriceTag price={6.5} status="verified" />);
    expect(container).toHaveTextContent("€6.50");
    rerender(<PriceTag price={4.5} status="ocr_agreed" />);
    expect(screen.getByLabelText("Read from a photo")).toBeInTheDocument();
  });

  it("provenance indicators are focusable and describe themselves", () => {
    for (const kind of ["retrieved", "extracted", "inferred", "uncertain"] as const) {
      const { unmount } = render(<SourceIndicator kind={kind} />);
      const indicator = screen.getByRole("img");
      expect(indicator).toHaveAttribute("tabindex", "0");
      expect(indicator.getAttribute("aria-label")!.length).toBeGreaterThan(10);
      unmount();
    }
  });

  it("recommendation shell labels mock data and omits links it doesn't have", () => {
    render(<RecommendationCardShell {...RESULT_PREVIEW[0]} />);
    expect(screen.getByRole("img", { name: "92 percent match (demo)" })).toBeInTheDocument();
    expect(screen.getAllByText("Demo data").length).toBeGreaterThan(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText(/appear here once real data is connected/)).toBeInTheDocument();
  });
});

describe("reduced motion", () => {
  const items = RESULT_PREVIEW[0].dishes;
  const hiddenLines = (container: HTMLElement) =>
    [...container.querySelectorAll("li")].filter((li) => (li as HTMLElement).style.opacity === "0");

  it("reveals menu ticket lines immediately when the user prefers reduced motion", () => {
    mockMatchMedia(true);
    const { container } = render(<MenuTicket items={items} />);
    expect(hiddenLines(container)).toHaveLength(0);
    expect(screen.getAllByText("Original").length).toBe(items.length);
  });

  it("staggers the reveal otherwise", () => {
    mockMatchMedia(false);
    const { container } = render(<MenuTicket items={items} />);
    expect(hiddenLines(container)).toHaveLength(items.length);
  });
});
