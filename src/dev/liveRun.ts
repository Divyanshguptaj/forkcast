import type { Env } from "@/config/env";
import { RecommendRequestBody, type UserRequest } from "@/schemas/request";
import type { MenuExtraction } from "@/schemas/menuExtraction";
import type { MenuResolution } from "@/schemas/menuResolution";
import { createEventEmitter, type EventEmitter } from "@/server/agent/events";
import { runDiscovery, type DiscoveryResult } from "@/server/discovery/pipeline";
import { extractMenus, type ExtractionRunStats } from "@/server/menu/extract/pipeline";
import { sharedExtractionCache } from "@/server/menu/extract/modelCache";
import { createSharedCache, defaultFetcher, resolveMenus, type ResolverRestaurant } from "@/server/menu/resolver";
import { createGeminiClient, type GeminiClient } from "@/server/providers/gemini/client";
import { createPlacesClient } from "@/server/providers/places/client";
import { createTavilyClient } from "@/server/providers/tavily/client";
import type { ExtractionFocus } from "@/server/menu/extract/prompts";
import type { RecommendCandidate } from "@/server/ranking";

export interface LiveRun {
  discovery: DiscoveryResult;
  resolutions: MenuResolution[];
  extractions: MenuExtraction[];
  extractStats: ExtractionRunStats;
  candidates: RecommendCandidate[];
  llm?: GeminiClient;
  timings: { discoveryMs: number; resolveMs: number; extractMs: number };
}

export function focusFor(request: UserRequest): ExtractionFocus {
  return request.diet.length > 0 && request.diet.every((d) => d === "vegetarian" || d === "vegan") ? "plant_based" : "all";
}

export async function runLive(form: Partial<UserRequest>, env: Env, opts: { llm?: boolean; emitter?: EventEmitter } = {}): Promise<LiveRun> {
  const emitter = opts.emitter ?? createEventEmitter(() => undefined);
  const body = RecommendRequestBody.parse({ form: { city: "Barcelona", ...form } });
  const llm = opts.llm === false || !env.GEMINI_API_KEY ? undefined : createGeminiClient(env);

  const t0 = Date.now();
  const discovery = await runDiscovery(body, { places: createPlacesClient(env), emitter });
  const discoveryMs = Date.now() - t0;

  const restaurants: ResolverRestaurant[] = discovery.selected.map((e) => ({
    placeId: e.placeId,
    name: e.name,
    address: e.discovered.restaurant.address,
    city: discovery.normalized.request.city,
    websiteUrl: e.discovered.restaurant.websiteUrl,
    websiteHttpsCandidate: e.discovered.restaurant.websiteHttpsCandidate,
  }));

  const sharedCache = createSharedCache();
  const search = env.TAVILY_API_KEY ? createTavilyClient(env) : undefined;
  const t1 = Date.now();
  const resolutions = await resolveMenus(restaurants, { fetcher: defaultFetcher, search, emitter, sharedCache, restaurantConcurrency: 3, fetchConcurrency: 6, tavilyConcurrency: 2 });
  const resolveMs = Date.now() - t1;

  const t2 = Date.now();
  const { results, stats } = await extractMenus(
    restaurants.map((restaurant, i) => ({ restaurant, resolution: resolutions[i] })),
    { fetcher: defaultFetcher, sharedCache, modelCache: sharedExtractionCache, llm, priceCheckModel: env.GEMINI_PRICE_CHECK_MODEL, emitter, focus: focusFor(discovery.normalized.request) },
  );
  const extractMs = Date.now() - t2;

  const candidates: RecommendCandidate[] = discovery.selected.map((e, i) => ({
    restaurant: e.discovered.restaurant,
    shortlistScore: e.shortlistScore,
    ...(e.distanceKm !== undefined ? { distanceKm: e.distanceKm } : {}),
    extraction: results[i],
  }));

  return { discovery, resolutions, extractions: results, extractStats: stats, candidates, llm, timings: { discoveryMs, resolveMs, extractMs } };
}
