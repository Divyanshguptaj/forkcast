import type { Env } from "@/config/env";
import { RUN_LIMITS } from "@/config/limits";
import type { MenuExtraction } from "@/schemas/menuExtraction";
import type { MenuResolution } from "@/schemas/menuResolution";
import type { RecommendRequestBodyType, UserRequest } from "@/schemas/request";
import { runDiscovery, type DiscoveryResult } from "../discovery/pipeline";
import { HybridUnderstander } from "../discovery/nlUnderstand";
import { extractMenus, type ExtractionRunStats } from "../menu/extract/pipeline";
import { ExtractionCache } from "../menu/extract/modelCache";
import type { ExtractionFocus } from "../menu/extract/prompts";
import { createSharedCache, resolveMenu, type ResolverRestaurant, type ResolverSharedCache } from "../menu/resolver";
import { createLimiter } from "../menu/resolver/limiter";
import type { GeminiStats } from "../providers/gemini/client";
import type { Fetcher, LlmProvider, PlacesProvider, WebSearchProvider } from "../providers/types";
import { recommend, type RecommendCandidate } from "../ranking";
import type { EventEmitter } from "./events";
import { estimateCost, type CostEstimate } from "./cost";
import { describeFailure } from "./failure";

export interface RunLimits {
  softDeadlineMs: number;
  hardDeadlineMs: number;
  restaurantConcurrency: number;
  fetchConcurrency: number;
  tavilyConcurrency: number;
}

export const DEFAULT_RUN_LIMITS: RunLimits = {
  softDeadlineMs: Math.round(RUN_LIMITS.globalDeadlineMs * 0.8),
  hardDeadlineMs: RUN_LIMITS.globalDeadlineMs,
  restaurantConcurrency: 5,
  fetchConcurrency: 6,
  tavilyConcurrency: 2,
};

export interface RunDeps {
  env: Env;
  places: PlacesProvider;
  search?: WebSearchProvider;
  llm?: LlmProvider & { stats?: GeminiStats };
  fetcher: Fetcher;
  emitter: EventEmitter;
  signal: AbortSignal;
  limits?: Partial<RunLimits>;
  modelCache?: ExtractionCache;
  sharedCache?: ResolverSharedCache;
  now?: () => number;
}

export interface RunMetrics {
  totalMs: number;
  phases: { understandAndDiscoverMs: number; researchMs: number; rankMs: number };
  placesCalls: number;
  tavily: { searches: number; extracts: number; credits: number };
  fetch: { requests: number; bytes: number };
  gemini: { understandRequests: number; extractionRequests: number; visionRequests: number; priceChecks: number; httpRequests: number; inputTokens: number; outputTokens: number; cacheHits: number; quotaSkipped: number; failures: number };
  restaurants: { shortlisted: number; withMenu: number };
  partial: boolean;
  cost: CostEstimate;
}

export type RunOutcome = "completed" | "no_results" | "failed" | "cancelled";

export function focusFor(request: UserRequest): ExtractionFocus {
  return request.diet.length > 0 && request.diet.every((d) => d === "vegetarian" || d === "vegan") ? "plant_based" : "all";
}

export async function runRecommendation(body: RecommendRequestBodyType, deps: RunDeps): Promise<{ outcome: RunOutcome; metrics?: RunMetrics }> {
  const now = deps.now ?? Date.now;
  const started = now();
  const limits = { ...DEFAULT_RUN_LIMITS, ...deps.limits };
  const { emitter } = deps;

  let errorEmitted = false;
  const tracked: EventEmitter = {
    runId: emitter.runId,
    emit(event) {
      if (event.type === "error") errorEmitted = true;
      return emitter.emit(event);
    },
  };

  const work = new AbortController();
  const onClientAbort = () => work.abort();
  deps.signal.addEventListener("abort", onClientAbort, { once: true });
  const soft = setTimeout(() => work.abort(), limits.softDeadlineMs);
  const cancelled = () => deps.signal.aborted;

  let understandRequests = 0;
  let understandTokens = { input: 0, output: 0 };
  const understander = new HybridUnderstander({
    llm: deps.llm,
    signal: work.signal,
    onLlmCall: (info) => {
      understandRequests++;
      understandTokens = { input: understandTokens.input + (info.inputTokens ?? 0), output: understandTokens.output + (info.outputTokens ?? 0) };
    },
  });

  try {
    let discovery: DiscoveryResult;
    try {
      discovery = await runDiscovery(body, { places: deps.places, emitter: tracked, understander, signal: work.signal });
    } catch (err) {
      if (cancelled()) return { outcome: "cancelled" };
      if (!errorEmitted) tracked.emit({ type: "error", ...describeFailure(err) });
      return { outcome: "failed" };
    }
    const discoveredAt = now();
    if (cancelled()) return { outcome: "cancelled" };
    if (discovery.selected.length === 0) return { outcome: "no_results" };

    const request = discovery.normalized.request;
    const restaurants: ResolverRestaurant[] = discovery.selected.map((e) => ({
      placeId: e.placeId,
      name: e.name,
      address: e.discovered.restaurant.address,
      city: request.city,
      websiteUrl: e.discovered.restaurant.websiteUrl,
      websiteHttpsCandidate: e.discovered.restaurant.websiteHttpsCandidate,
    }));
    for (const r of restaurants) {
      tracked.emit({ type: "restaurant.step", id: r.placeId, step: "details", status: "started" });
      tracked.emit({ type: "restaurant.step", id: r.placeId, step: "details", status: "done" });
      tracked.emit({ type: "restaurant.step", id: r.placeId, step: "reviews", status: "done", detail: "skipped" });
    }

    const sharedCache = deps.sharedCache ?? createSharedCache();
    const modelCache = deps.modelCache ?? new ExtractionCache();
    const limiters = { fetch: createLimiter(limits.fetchConcurrency), tavily: createLimiter(limits.tavilyConcurrency) };
    const restaurantLimiter = createLimiter(limits.restaurantConcurrency);
    const focus = focusFor(request);

    const resolutions = new Map<string, MenuResolution>();
    const extractions = new Map<string, MenuExtraction>();
    const extractStats: ExtractionRunStats[] = [];

    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    const hardStop = new Promise<void>((resolve) => {
      hardTimer = setTimeout(() => {
        work.abort();
        resolve();
      }, Math.max(0, limits.hardDeadlineMs - (now() - started)));
    });
    const research = Promise.all(
      restaurants.map(async (r) => {
        try {
          const resolution = await restaurantLimiter.run(() => resolveMenu(r, { fetcher: deps.fetcher, search: deps.search, emitter: tracked, sharedCache, limiters, signal: work.signal }));
          resolutions.set(r.placeId, resolution);
          const { results, stats } = await extractMenus([{ restaurant: r, resolution }], {
            fetcher: deps.fetcher,
            sharedCache,
            modelCache,
            llm: deps.llm,
            priceCheckModel: deps.env.GEMINI_PRICE_CHECK_MODEL,
            emitter: tracked,
            signal: work.signal,
            focus,
            requestedDiets: request.diet,
            limits: { maxDocsTotal: 2, maxLlmRequests: 4 },
          });
          extractStats.push(stats);
          extractions.set(r.placeId, results[0]);
        } catch {
          tracked.emit({ type: "restaurant.step", id: r.placeId, step: "menu", status: "failed", detail: "Menu research failed" });
        }
      }),
    );
    await Promise.race([research, hardStop]);
    clearTimeout(hardTimer);
    clearTimeout(soft);
    if (cancelled()) return { outcome: "cancelled" };
    const researchedAt = now();
    const partial = work.signal.aborted;

    const candidates: RecommendCandidate[] = discovery.selected.map((e) => ({
      restaurant: e.discovered.restaurant,
      shortlistScore: e.shortlistScore,
      ...(e.distanceKm !== undefined ? { distanceKm: e.distanceKm } : {}),
      extraction: extractions.get(e.placeId),
    }));
    tracked.emit({ type: "rank.done" });
    const set = recommend({ request, cuisines: discovery.normalized.cuisines, candidates });

    const sum = (pick: (s: ExtractionRunStats) => number) => extractStats.reduce((n, s) => n + pick(s), 0);
    const quotaSkipped = sum((s) => s.quotaSkipped);
    if (quotaSkipped > 0 || deps.llm?.available?.() === false) set.notices.push("The AI reader has reached its daily limit, so some menus were read with a basic parser. Dietary details are limited and fewer dishes can be confirmed.");
    if (!deps.llm) set.notices.push("AI menu reading is not configured, so menus were read with a basic parser and dietary details are limited.");
    if (partial) set.notices.push("The time limit was reached, so some restaurants were not fully researched.");
    if (discovery.normalized.warnings.length > 0) set.notices.push(...discovery.normalized.warnings.map((w) => w.slice(0, 300)));
    tracked.emit({ type: "recommendations.ready", payload: set });

    const tavilySearches = [...resolutions.values()].reduce((n, r) => n + r.usage.tavilySearches, 0);
    const tavilyExtracts = [...resolutions.values()].reduce((n, r) => n + r.usage.tavilyExtracts, 0);
    const tavilyCredits = [...resolutions.values()].reduce((n, r) => n + r.usage.tavilyCredits, 0);
    const gemini = {
      understandRequests,
      extractionRequests: sum((s) => s.llmRequests),
      visionRequests: sum((s) => s.visionRequests),
      priceChecks: sum((s) => s.priceCheckRequests),
      httpRequests: deps.llm?.stats?.requests ?? 0,
      inputTokens: sum((s) => s.inputTokens) + understandTokens.input,
      outputTokens: sum((s) => s.outputTokens) + understandTokens.output,
      cacheHits: sum((s) => s.cacheHits),
      quotaSkipped,
      failures: Object.values(deps.llm?.stats?.failures ?? {}).reduce((a, b) => a + b, 0),
    };
    const placesCalls = discovery.placesCalls.length;
    const finishedAt = now();
    const metrics: RunMetrics = {
      totalMs: finishedAt - started,
      phases: { understandAndDiscoverMs: discoveredAt - started, researchMs: researchedAt - discoveredAt, rankMs: finishedAt - researchedAt },
      placesCalls,
      tavily: { searches: tavilySearches, extracts: tavilyExtracts, credits: tavilyCredits },
      fetch: { requests: [...resolutions.values()].reduce((n, r) => n + r.usage.directFetches, 0), bytes: [...resolutions.values()].reduce((n, r) => n + r.usage.bytesFetched, 0) },
      gemini,
      restaurants: { shortlisted: restaurants.length, withMenu: set.stats.withMenu },
      partial,
      cost: estimateCost({ placesCalls, tavilyCredits, inputTokens: gemini.inputTokens, outputTokens: gemini.outputTokens }),
    };
    tracked.emit({ type: "run.metrics", metrics: toPublicMetrics(metrics) });
    tracked.emit({ type: "explain.done" });
    return { outcome: "completed", metrics };
  } catch (err) {
    if (cancelled()) return { outcome: "cancelled" };
    if (!errorEmitted) tracked.emit({ type: "error", ...describeFailure(err) });
    return { outcome: "failed" };
  } finally {
    clearTimeout(soft);
    deps.signal.removeEventListener("abort", onClientAbort);
  }
}

export function toPublicMetrics(m: RunMetrics) {
  return {
    totalMs: m.totalMs,
    understandAndDiscoverMs: m.phases.understandAndDiscoverMs,
    researchMs: m.phases.researchMs,
    rankMs: m.phases.rankMs,
    placesCalls: m.placesCalls,
    tavilyCredits: m.tavily.credits,
    aiRequests: m.gemini.understandRequests + m.gemini.extractionRequests + m.gemini.priceChecks,
    inputTokens: m.gemini.inputTokens,
    outputTokens: m.gemini.outputTokens,
    cacheHits: m.gemini.cacheHits,
    estimatedCostUsd: m.cost.totalUsd,
    partial: m.partial,
  };
}
