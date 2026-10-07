import { describe, expect, it, vi } from "vitest";
import { discoverRestaurants } from "@/server/discovery/discover";
import { normalizeRequest } from "@/server/discovery/normalizeRequest";
import { buildPlacesQueries } from "@/server/discovery/queryBuilder";
import { runDiscovery } from "@/server/discovery/pipeline";
import { createEventEmitter } from "@/server/agent/events";
import { PlacesError } from "@/server/providers/places/errors";
import type { PlacesProvider, PlacesSearchResult } from "@/server/providers/types";
import type { AgentEvent } from "@/schemas/events";
import { norm, restaurant } from "../helpers/places";

function provider(byQuery: Record<string, ReturnType<typeof restaurant>[] | Error>): PlacesProvider & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async searchText(input): Promise<PlacesSearchResult> {
      calls.push(input.query);
      const entry = byQuery[input.query] ?? [];
      if (entry instanceof Error) throw entry;
      return { restaurants: entry, sources: entry.map((r) => ({ id: r.sourceId, provider: "google_places", fetchedAt: "2026-10-07T12:00:00.000Z", label: "Google Places" })), droppedUnmappable: 0, latencyMs: 5 };
    },
  };
}

describe("normalizeRequest", () => {
  it("canonicalizes cuisines and removes duplicates", () => {
    const n = norm({ cuisines: ["Italian", "italiana", " Italian restaurant ", "Japonesa"] });
    expect(n.cuisines).toEqual(["italian", "japanese"]);
  });

  it("keeps unresolvable preferences for the review phase", () => {
    const n = norm({ preferences: ["not too crowded", "quiet"], mustHave: ["outdoor seating"] });
    expect(n.unresolvedPreferences).toEqual(["not too crowded", "quiet", "outdoor seating"]);
  });

  it("uses the city center as origin and prefers a requested location", () => {
    expect(norm().origin?.source).toBe("city_center");
    expect(norm({ location: { lat: 41.4, lng: 2.15 } }).origin).toMatchObject({ source: "request", lat: 41.4 });
  });

  it("warns for unconfigured cities instead of failing", () => {
    const n = norm({ city: "Lisbon" });
    expect(n.city).toBeUndefined();
    expect(n.origin).toBeUndefined();
    expect(n.warnings[0]).toContain("Lisbon");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(norm())).toBe(JSON.stringify(norm()));
  });
});

describe("buildPlacesQueries", () => {
  it("uses a primary cuisine query plus a diet supplement", () => {
    const q = buildPlacesQueries(norm());
    expect(q.map((x) => x.text)).toEqual(["italian restaurants in Barcelona", "vegetarian italian restaurants in Barcelona"]);
    expect(q.map((x) => x.purpose)).toEqual(["primary", "diet_supplement"]);
  });

  it("does not put the diet in the primary query", () => {
    expect(buildPlacesQueries(norm())[0].text).not.toContain("vegetarian");
  });

  it("makes a single request when there is nothing to expand", () => {
    expect(buildPlacesQueries(norm({ diet: [], cuisines: [] })).map((x) => x.text)).toEqual(["restaurants in Barcelona"]);
  });

  it("falls back to a second cuisine when there is no diet", () => {
    const q = buildPlacesQueries(norm({ diet: [], cuisines: ["Italian", "Japanese"] }));
    expect(q.map((x) => x.text)).toEqual(["italian restaurants in Barcelona", "japanese restaurants in Barcelona"]);
  });

  it("adds breakfast and brunch terms but not lunch or dinner", () => {
    expect(buildPlacesQueries(norm({ meal: "breakfast", diet: [], cuisines: [] }))[0].text).toBe("breakfast restaurants in Barcelona");
    expect(buildPlacesQueries(norm({ meal: "brunch", diet: ["vegan"], cuisines: [] }))[1].text).toBe("vegan brunch restaurants in Barcelona");
    expect(buildPlacesQueries(norm({ meal: "dinner", diet: [], cuisines: [] }))[0].text).not.toContain("dinner");
  });

  it("never plans more than two Places requests", () => {
    expect(buildPlacesQueries(norm({ diet: ["vegan", "gluten_free"], cuisines: ["a", "b", "c"] }))).toHaveLength(2);
  });

  it("prefers vegan over vegetarian for the supplement", () => {
    expect(buildPlacesQueries(norm({ diet: ["vegetarian", "vegan"] }))[1].text).toContain("vegan");
  });
});

describe("discoverRestaurants", () => {
  const queries = buildPlacesQueries(norm());

  it("merges duplicate place IDs across searches and records which queries found them", async () => {
    const a = restaurant({ placeId: "a", sourceId: "places:a" });
    const b = restaurant({ placeId: "b", sourceId: "places:b" });
    const c = restaurant({ placeId: "c", sourceId: "places:c" });
    const places = provider({ "italian restaurants in Barcelona": [a, b], "vegetarian italian restaurants in Barcelona": [b, c] });
    const out = await discoverRestaurants(norm(), queries, places);
    expect(out.discovered.map((d) => d.restaurant.placeId)).toEqual(["a", "b", "c"]);
    const dup = out.discovered.find((d) => d.restaurant.placeId === "b")!;
    expect(dup.foundBy.map((h) => [h.queryId, h.rank])).toEqual([["q1", 2], ["q2", 1]]);
    expect(out.sources).toHaveLength(3);
    expect(out.calls).toHaveLength(2);
  });

  it("handles fewer results than expected", async () => {
    const places = provider({ "italian restaurants in Barcelona": [restaurant()], "vegetarian italian restaurants in Barcelona": [] });
    const out = await discoverRestaurants(norm(), queries, places);
    expect(out.discovered).toHaveLength(1);
  });

  it("returns an empty result for empty searches without throwing", async () => {
    const out = await discoverRestaurants(norm(), queries, provider({}));
    expect(out.discovered).toEqual([]);
    expect(out.calls.every((c) => c.returned === 0 && !c.error)).toBe(true);
  });

  it("survives one failed query when another succeeds", async () => {
    const places = provider({
      "italian restaurants in Barcelona": [restaurant()],
      "vegetarian italian restaurants in Barcelona": new PlacesError("rate_limited", "slow down", 429),
    });
    const out = await discoverRestaurants(norm(), queries, places);
    expect(out.discovered).toHaveLength(1);
    expect(out.calls[1].error).toContain("slow down");
  });

  it("throws when every query fails", async () => {
    const err = new PlacesError("auth", "denied", 403);
    const places = provider({ "italian restaurants in Barcelona": err, "vegetarian italian restaurants in Barcelona": err });
    await expect(discoverRestaurants(norm(), queries, places)).rejects.toBe(err);
  });

  it("passes the city bias and region to the provider", async () => {
    const spy = vi.fn(async () => ({ restaurants: [], sources: [], droppedUnmappable: 0, latencyMs: 1 }));
    await discoverRestaurants(norm(), queries.slice(0, 1), { searchText: spy });
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ regionCode: "ES", locationBias: expect.objectContaining({ radiusMeters: 6000 }) }), expect.anything());
  });
});

describe("runDiscovery events", () => {
  const body = { form: { city: "Barcelona", meal: "dinner" as const, diet: ["vegetarian" as const], cuisines: ["Italian"] } };

  it("emits real events in order, validated against the contract", async () => {
    const rs = Array.from({ length: 8 }, (_, i) => restaurant({ placeId: `p${i}`, name: `Place ${i}`, sourceId: `places:p${i}`, ratingCount: 100 + i }));
    const places = provider({ "italian restaurants in Barcelona": rs, "vegetarian italian restaurants in Barcelona": rs.slice(0, 3) });
    const events: AgentEvent[] = [];
    const result = await runDiscovery(body, { places, emitter: createEventEmitter((e) => events.push(e), "run-1") });

    expect(events.map((e) => e.type)).toEqual(["run.started", "understood", "discover.started", "tool", "tool", "discover.found", "shortlist.done"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(events.every((e) => e.runId === "run-1")).toBe(true);
    const found = events.find((e) => e.type === "discover.found");
    expect(found && found.type === "discover.found" && found.count).toBe(8);
    const done = events.find((e) => e.type === "shortlist.done");
    expect(done && done.type === "shortlist.done" && done.restaurants).toHaveLength(5);
    expect(result.selected).toHaveLength(5);
    expect(places.calls).toHaveLength(2);
  });

  it("emits a tool event before each Places call and none otherwise", async () => {
    const places = provider({});
    const events: AgentEvent[] = [];
    await runDiscovery(body, { places, emitter: createEventEmitter((e) => events.push(e)) });
    const tools = events.filter((e) => e.type === "tool");
    expect(tools).toHaveLength(places.calls.length);
    expect(tools.every((e) => e.type === "tool" && e.name === "places")).toBe(true);
  });

  it("emits an error event and rethrows when discovery fails", async () => {
    const err = new PlacesError("rate_limited", "limit", 429);
    const places = provider({ "italian restaurants in Barcelona": err, "vegetarian italian restaurants in Barcelona": err });
    const events: AgentEvent[] = [];
    await expect(runDiscovery(body, { places, emitter: createEventEmitter((e) => events.push(e)) })).rejects.toBe(err);
    const last = events.at(-1);
    expect(last).toMatchObject({ type: "error", code: "places_rate_limited", recoverable: true });
  });

  it("rejects free text without a form until natural-language parsing exists", async () => {
    await expect(runDiscovery({ text: "vegetarian dinner" }, { places: provider({}), emitter: createEventEmitter(() => undefined) })).rejects.toThrow(/Free-text/);
  });

  it("does not request review text (no review events, empty sampled reviews)", async () => {
    const places = provider({ "italian restaurants in Barcelona": [restaurant()] });
    const events: AgentEvent[] = [];
    const result = await runDiscovery(body, { places, emitter: createEventEmitter((e) => events.push(e)) });
    expect(events.some((e) => e.type.startsWith("reviews."))).toBe(false);
    expect(result.discovered.every((d) => d.restaurant.sampledReviews.length === 0)).toBe(true);
  });

  it("normalizes the request it announces", async () => {
    const events: AgentEvent[] = [];
    await runDiscovery({ form: { city: "barcelona", cuisines: ["italiana"] } }, { places: provider({}), emitter: createEventEmitter((e) => events.push(e)) });
    const understood = events.find((e) => e.type === "understood");
    expect(understood && understood.type === "understood" && understood.request.city).toBe("Barcelona");
    expect(normalizeRequest({ city: "barcelona", cuisines: ["italiana"] } as never).cuisines).toEqual(["italian"]);
  });
});
