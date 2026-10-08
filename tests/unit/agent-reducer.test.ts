import { describe, expect, it } from "vitest";
import { agentReducer, createInitialRunState } from "@/lib/agent/reducer";
import { restaurantPhase, runNotice } from "@/lib/agent/selectors";
import type { RunState } from "@/lib/agent/types";
import { AgentEventSchema, type AgentEvent } from "@/schemas/events";
import { SCENARIOS } from "@/mocks/replay/scenarios";

const events = (id: keyof typeof SCENARIOS): AgentEvent[] => SCENARIOS[id].steps.map((s) => s.event);

function reduceAll(list: AgentEvent[], start: RunState = createInitialRunState()): RunState {
  return list.reduce((state, event) => agentReducer(state, { type: "event", event }), start);
}

describe("replay fixtures use the real AgentEvent contract", () => {
  it.each(Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>)("%s validates against AgentEventSchema", (id) => {
    for (const event of events(id)) {
      const result = AgentEventSchema.safeParse(event);
      expect(result.success, `${id} seq ${event.seq} ${event.type}`).toBe(true);
    }
  });

  it("assigns strictly increasing sequence numbers in time order", () => {
    const steps = SCENARIOS["full-demo"].steps;
    const seqs = steps.map((s) => s.event.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    const times = steps.map((s) => s.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("Phase 2 events", () => {
  const state = reduceAll(events("phase2"));

  it("progress the stages in order", () => {
    expect(state.stages).toMatchObject({ understand: "done", search: "done", shortlist: "done", research: "pending", compare: "pending", ready: "pending" });
    expect(state.status).toBe("running");
  });

  it("record discovery facts and the Places calls", () => {
    expect(state.discoveredCount).toBe(29);
    expect(state.placesCalls).toBe(2);
    expect(state.tools.map((t) => t.name)).toEqual(["places", "places"]);
    expect(state.city).toBe("Barcelona");
    expect(state.request?.budget?.max).toBe(30);
  });

  it("create five shortlisted restaurants with the facts Phase 2 provides", () => {
    expect(state.shortlistOrder).toHaveLength(5);
    const first = state.restaurants[state.shortlistOrder[0]];
    expect(first).toMatchObject({ name: "Osteria Alba", rating: 4.7, ratingCount: 3120, priceLevel: 2, distanceKm: 0.52 });
    expect(first.menu.items).toEqual([]);
    expect(first.reviews).toBeUndefined();
  });

  it("leave every restaurant waiting", () => {
    for (const id of state.shortlistOrder) expect(restaurantPhase(state.restaurants[id])).toBe("waiting");
  });

  it("completes the run when the source ends", () => {
    expect(agentReducer(state, { type: "source.ended" })).toMatchObject({ status: "complete", ended: true });
  });
});

describe("duplicate and out-of-order events", () => {
  it("ignores duplicate sequence numbers", () => {
    const list = events("phase2");
    const once = reduceAll(list);
    const twice = reduceAll([...list, ...list]);
    expect(twice.placesCalls).toBe(once.placesCalls);
    expect(twice.tools).toEqual(once.tools);
    expect(twice.shortlistOrder).toEqual(once.shortlistOrder);
  });

  it("is idempotent for a repeated event", () => {
    const list = events("phase2");
    const base = reduceAll(list.slice(0, 4));
    const again = agentReducer(base, { type: "event", event: list[3] });
    expect(again).toBe(base);
  });

  it("never moves a stage backwards when events arrive late", () => {
    const list = events("phase2");
    const shuffled = [list[0], list[1], list[5], list[2], list[3], list[4], list[6]];
    const state = reduceAll(shuffled);
    expect(state.stages.search).toBe("done");
    expect(state.stages.shortlist).toBe("done");
    expect(state.discoveredCount).toBe(29);
  });

  it("queues restaurant events that arrive before the shortlist and applies them afterwards", () => {
    const list = events("full-demo");
    const shortlistIndex = list.findIndex((e) => e.type === "shortlist.done");
    const early = list.find((e) => e.type === "restaurant.step" && e.id === "demo-alba")!;
    const withoutEarly = list.filter((e) => e !== early);
    const reordered = [...withoutEarly.slice(0, shortlistIndex), early, ...withoutEarly.slice(shortlistIndex)];
    const before = reduceAll(reordered.slice(0, shortlistIndex + 1));
    expect(before.pending["demo-alba"]).toHaveLength(1);
    const state = reduceAll(reordered);
    expect(state.pending["demo-alba"]).toBeUndefined();
    expect(state.restaurants["demo-alba"].steps.details.status).toBe("done");
  });

  it("holds early events as pending until the shortlist exists", () => {
    const list = events("full-demo");
    const early = list.find((e) => e.type === "restaurant.step" && e.id === "demo-alba")!;
    const state = reduceAll([list[0], early]);
    expect(state.pending["demo-alba"]).toHaveLength(1);
    const full = reduceAll(list.filter((e) => e.type !== "restaurant.step" || e.id !== "demo-alba"), state);
    expect(full.pending["demo-alba"]).toBeUndefined();
    expect(full.restaurants["demo-alba"].steps.details.status).toBe("started");
  });

  it("does not let a late 'started' overwrite a finished step", () => {
    const list = events("full-demo");
    const circolo = list.filter((e) => e.type === "restaurant.step" && e.id === "demo-alba" && e.step === "details");
    const state = reduceAll([...list.slice(0, 7), circolo[1], circolo[0]]);
    expect(state.restaurants["demo-alba"].steps.details.status).toBe("done");
  });

  it("ignores events from a different run and resets on a new run.started", () => {
    const a = reduceAll(events("phase2"));
    const other = events("no-results")[3];
    expect(agentReducer(a, { type: "event", event: other })).toBe(a);
    const fresh = agentReducer(a, { type: "event", event: events("no-results")[0] });
    expect(fresh.runId).toBe("demo-empty");
    expect(fresh.shortlistOrder).toEqual([]);
  });
});

describe("full demo research states", () => {
  const state = reduceAll(events("full-demo"));
  const phase = (id: string) => restaurantPhase(state.restaurants[id]);

  it("maps each restaurant to a sensible overall phase", () => {
    expect(phase("demo-alba")).toBe("complete");
    expect(phase("demo-marina")).toBe("degraded");
    expect(phase("demo-viento")).toBe("degraded");
    expect(phase("demo-elio")).toBe("degraded");
    expect(phase("demo-atelier")).toBe("degraded");
  });

  it("keeps the unreadable menu as a graceful state with the official link", () => {
    const viento = state.restaurants["demo-viento"];
    expect(viento.menu.resolved).toMatchObject({ status: "found_but_unreadable", documentCount: 0, officialMenuUrl: "https://www.viento.example/", reason: "flipbook_viewer" });
    expect(viento.steps.menu.status).toBe("warning");
    expect(viento.steps.reviews.status).toBe("done");
  });

  it("tracks disputed prices without inventing a number", () => {
    const disputed = state.restaurants["demo-marina"].menu.items.find((i) => i.priceStatus === "disputed");
    expect(disputed).toBeDefined();
    expect(disputed?.price).toBeUndefined();
  });

  it("marks a failed review step without failing the restaurant", () => {
    const patsa = state.restaurants["demo-atelier"];
    expect(patsa.steps.reviews.status).toBe("failed");
    expect(phase("demo-atelier")).not.toBe("failed");
  });

  it("records the extraction summary and the number of dishes read", () => {
    expect(state.restaurants["demo-alba"].menu.extraction).toMatchObject({ status: "extracted", documentCount: 2, dishCount: 4 });
    expect(state.restaurants["demo-atelier"].menu.extraction).toMatchObject({ status: "partial", skippedCount: 1, reason: "one document could not be read" });
  });

  it("finishes every stage and records review terms", () => {
    expect(Object.values(state.stages).every((s) => s === "done")).toBe(true);
    expect(state.rankDone && state.explainDone).toBe(true);
    expect(state.reviewTerms).toEqual(["vegetarian", "crowded", "queue", "noise"]);
  });

  it("passes through intermediate phases while replaying", () => {
    const list = events("full-demo");
    const seen = new Set<string>();
    let s = createInitialRunState();
    for (const event of list) {
      s = agentReducer(s, { type: "event", event });
      seen.add(restaurantPhase(s.restaurants["demo-marina"] ?? { ...state.restaurants["demo-marina"], steps: { details: { status: "idle" }, menu: { status: "idle" }, translate: { status: "idle" }, diet: { status: "idle" }, reviews: { status: "idle" } }, menu: { stages: [], items: [] } }));
    }
    for (const expected of ["waiting", "researching", "menu_reading", "menu_found", "review_research", "degraded"]) expect(seen.has(expected), expected).toBe(true);
  });
});

describe("run-level notices", () => {
  it("reports no results", () => {
    expect(runNotice(reduceAll(events("no-results")))).toBe("no_results");
  });

  it("maps a Places error to places_unavailable", () => {
    const state = reduceAll(events("places-down"));
    expect(state.status).toBe("error");
    expect(runNotice(state)).toBe("places_unavailable");
  });

  it("maps a deadline with a shortlist to partial results", () => {
    const state = reduceAll(events("timeout"));
    expect(runNotice(state)).toBe("partial_results");
    expect(state.stages.research).not.toBe("done");
  });

  it("has no notice for a healthy run", () => {
    expect(runNotice(reduceAll(events("full-demo")))).toBeUndefined();
  });
});
