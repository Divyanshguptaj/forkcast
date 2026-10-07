import type { Source } from "@/schemas/common";
import type { RestaurantDetails } from "@/schemas/restaurant";
import type { CallContext, PlacesProvider } from "../providers/types";
import type { NormalizedRequest } from "./normalizeRequest";
import type { PlannedQuery } from "./queryBuilder";

export interface QueryHit {
  queryId: string;
  purpose: PlannedQuery["purpose"];
  rank: number;
  resultCount: number;
}

export interface DiscoveredRestaurant {
  restaurant: RestaurantDetails;
  foundBy: QueryHit[];
}

export interface PlacesCallRecord {
  queryId: string;
  text: string;
  returned: number;
  droppedUnmappable: number;
  latencyMs: number;
  error?: string;
}

export interface DiscoveryOutcome {
  discovered: DiscoveredRestaurant[];
  sources: Source[];
  calls: PlacesCallRecord[];
}

export interface DiscoverHooks {
  onQueryStart?: (query: PlannedQuery) => void;
}

export async function discoverRestaurants(
  norm: NormalizedRequest,
  queries: PlannedQuery[],
  places: PlacesProvider,
  ctx: CallContext = {},
  hooks: DiscoverHooks = {},
): Promise<DiscoveryOutcome> {
  const byId = new Map<string, DiscoveredRestaurant>();
  const sources = new Map<string, Source>();
  const calls: PlacesCallRecord[] = [];
  let lastError: unknown;

  const locationBias = norm.origin
    ? { lat: norm.origin.lat, lng: norm.origin.lng, radiusMeters: norm.city?.radiusMeters ?? 10_000 }
    : undefined;

  for (const query of queries) {
    hooks.onQueryStart?.(query);
    try {
      const result = await places.searchText(
        {
          query: query.text,
          maxResults: query.maxResults,
          locationBias,
          regionCode: norm.request.country,
        },
        ctx,
      );
      calls.push({
        queryId: query.id,
        text: query.text,
        returned: result.restaurants.length,
        droppedUnmappable: result.droppedUnmappable,
        latencyMs: result.latencyMs,
      });
      result.restaurants.forEach((restaurant, index) => {
        const hit: QueryHit = {
          queryId: query.id,
          purpose: query.purpose,
          rank: index + 1,
          resultCount: result.restaurants.length,
        };
        const existing = byId.get(restaurant.placeId);
        if (existing) existing.foundBy.push(hit);
        else byId.set(restaurant.placeId, { restaurant, foundBy: [hit] });
      });
      for (const source of result.sources) sources.set(source.id, source);
    } catch (err) {
      lastError = err;
      calls.push({
        queryId: query.id,
        text: query.text,
        returned: 0,
        droppedUnmappable: 0,
        latencyMs: 0,
        error: err instanceof Error ? err.message : "unknown error",
      });
    }
  }

  if (byId.size === 0 && lastError && calls.every((c) => c.error)) throw lastError;

  return { discovered: [...byId.values()], sources: [...sources.values()], calls };
}
