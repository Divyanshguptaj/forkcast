import type { Source } from "@/schemas/common";
import type { RecommendRequestBodyType } from "@/schemas/request";
import type { EventEmitter } from "../agent/events";
import type { PlacesProvider } from "../providers/types";
import { PlacesError } from "../providers/places/errors";
import { discoverRestaurants, type DiscoveredRestaurant, type PlacesCallRecord } from "./discover";
import { filterCandidates, type ExcludedCandidate } from "./filter";
import { normalizeRequest, type NormalizedRequest } from "./normalizeRequest";
import { buildPlacesQueries, type PlannedQuery } from "./queryBuilder";
import { buildShortlist, type ShortlistEntry } from "./shortlist";
import { StructuredRequestUnderstander, type RequestUnderstander } from "./understand";

export interface DiscoveryDeps {
  places: PlacesProvider;
  emitter: EventEmitter;
  understander?: RequestUnderstander;
  signal?: AbortSignal;
  shortlistSize?: number;
}

export interface DiscoveryResult {
  runId: string;
  normalized: NormalizedRequest;
  queries: PlannedQuery[];
  placesCalls: PlacesCallRecord[];
  discovered: DiscoveredRestaurant[];
  excluded: ExcludedCandidate[];
  retained: number;
  shortlist: ShortlistEntry[];
  selected: ShortlistEntry[];
  sources: Source[];
  durationMs: number;
}

export async function runDiscovery(body: RecommendRequestBodyType, deps: DiscoveryDeps): Promise<DiscoveryResult> {
  const { emitter, places } = deps;
  const started = Date.now();
  const understander = deps.understander ?? new StructuredRequestUnderstander();

  try {
    emitter.emit({ type: "run.started" });
    const request = await understander.understand(body);
    const normalized = normalizeRequest(request);
    emitter.emit({ type: "understood", request: normalized.request });

    const queries = buildPlacesQueries(normalized);
    emitter.emit({ type: "discover.started", city: normalized.request.city });

    const outcome = await discoverRestaurants(normalized, queries, places, { signal: deps.signal }, {
      onQueryStart: (q) => emitter.emit({ type: "tool", name: "places", label: `Places text search: "${q.text}"` }),
    });
    emitter.emit({ type: "discover.found", count: outcome.discovered.length });

    const filtered = filterCandidates(outcome.discovered, normalized);
    const shortlist = buildShortlist(filtered.kept, normalized, deps.shortlistSize);
    emitter.emit({
      type: "shortlist.done",
      restaurants: shortlist.selected.map((e) => ({
        id: e.placeId,
        name: e.name,
        rating: e.discovered.restaurant.rating,
        ratingCount: e.discovered.restaurant.ratingCount,
        priceLevel: e.discovered.restaurant.priceLevel,
        distanceKm: e.distanceKm,
        address: e.discovered.restaurant.address,
        primaryType: e.discovered.restaurant.primaryType,
        mapsUrl: e.discovered.restaurant.mapsUrl,
      })),
    });

    return {
      runId: emitter.runId,
      normalized,
      queries,
      placesCalls: outcome.calls,
      discovered: outcome.discovered,
      excluded: filtered.excluded,
      retained: filtered.kept.length,
      shortlist: shortlist.entries,
      selected: shortlist.selected,
      sources: outcome.sources,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const code = err instanceof PlacesError ? `places_${err.code}` : err instanceof Error ? err.name : "unknown";
    const message = err instanceof Error ? err.message.slice(0, 300) : "Discovery failed";
    emitter.emit({ type: "error", code, message, recoverable: err instanceof PlacesError && err.code === "rate_limited" });
    throw err;
  }
}
