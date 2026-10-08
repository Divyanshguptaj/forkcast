import type { TimelineEntry } from "@/lib/agent/replay";
import type { ExtractedDish, MenuExtraction } from "@/schemas/menuExtraction";
import type { RestaurantDetails } from "@/schemas/restaurant";
import type { UserRequest } from "@/schemas/request";
import { recommend, type RecommendCandidate } from "@/server/ranking";
import recording from "./recorded-barcelona.json";

/* Replays a real run recorded on 2026-10-08 (Places, Tavily and Gemini for Barcelona). Event timing is simulated;
   restaurants, menus, dishes, prices and dietary readings are the recorded extraction output, and the recommendations
   are computed by the real ranking engine. */

interface Recording {
  request: UserRequest;
  cuisines: string[];
  discoveredCount?: number;
  candidates: Array<{ restaurant: RestaurantDetails; shortlistScore: number; distanceKm?: number; extraction: MenuExtraction }>;
}

const data = recording as unknown as Recording;

const STAGE_FOR_TIER = { official_site: "site", official_linked: "site", official_domain_search: "search", unverified_asset: "assets", third_party: "third_party" } as const;
const FORMAT_FOR_METHOD = { html_text: "html", pdf_text: "pdf_text", vision: "image" } as const;
const VEG_PREVIEW = { confirmed: "confirmed_vegetarian", possible: "likely_vegetarian", not_suitable: "contains_meat_or_fish", unknown: "unknown" } as const;
const RELEVANCE = { confirmed: 0, possible: 1, unknown: 2, not_suitable: 3 } as const;

const step = (id: string, s: string, status: string, detail?: string) => ({ type: "restaurant.step" as const, id, step: s, status, ...(detail ? { detail } : {}) });

function previewItems(dishes: ExtractedDish[]) {
  return [...dishes]
    .sort((a, b) => RELEVANCE[a.diet.vegetarian.status] - RELEVANCE[b.diet.vegetarian.status])
    .slice(0, 12)
    .map((d) => {
      const price = d.prices[0];
      return {
        originalName: d.originalName,
        translatedName: d.translatedName ?? d.originalName,
        ...(price?.amount !== undefined ? { price: price.amount } : {}),
        priceStatus: price?.status ?? "absent",
        vegetarian: VEG_PREVIEW[d.diet.vegetarian.status],
      };
    });
}

function restaurantTimeline(c: Recording["candidates"][number], startAt: number): TimelineEntry[] {
  const id = c.restaurant.placeId;
  const e = c.extraction;
  const t = (n: number) => startAt + n;
  const good = e.documents.filter((d) => d.status === "extracted" || d.status === "partial");
  const first = e.documents[0];
  const entries: TimelineEntry[] = [
    { at: t(0), event: step(id, "details", "started") },
    { at: t(300), event: step(id, "details", "done") },
    { at: t(400), event: step(id, "menu", "started", "Looking for the menu") },
  ];

  if (first) {
    entries.push({ at: t(900), event: { type: "menu.stage", id, stage: STAGE_FOR_TIER[first.tier], found: true, candidates: e.documents.length, sourceTier: first.tier, documentKind: first.documentKind, mediaType: first.mediaType } });
  }

  if (e.status === "unavailable" || e.status === "failed" || good.length === 0) {
    entries.push({ at: t(1500), event: { type: "menu.resolved", id, status: "unavailable", documentCount: 0, reason: "no_menu_found" } });
    entries.push({ at: t(1600), event: step(id, "menu", "warning", e.reason?.slice(0, 120) ?? "No readable menu") });
    entries.push({ at: t(1700), event: step(id, "reviews", "done", "skipped") });
    return entries;
  }

  const method = good[0].method ?? "html_text";
  entries.push(
    { at: t(1500), event: { type: "menu.read", id, format: FORMAT_FOR_METHOD[method], languages: good[0].languages, usedVision: method === "vision", dishCount: good.reduce((n, d) => n + d.dishCount, 0) } },
    { at: t(1600), event: { type: "tool", id, name: "gemini", label: "Reading menu text" } },
    { at: t(1700), event: step(id, "translate", "started") },
    { at: t(2400), event: step(id, "translate", "done") },
    { at: t(2500), event: step(id, "diet", "started") },
    { at: t(3100), event: { type: "menu.items", id, items: previewItems(e.dishes) } },
    { at: t(3200), event: step(id, "diet", "done") },
    { at: t(3300), event: { type: "menu.resolved", id, status: e.status === "partial" ? "partial" : "found", documentCount: good.length, sourceTier: first?.tier } },
    { at: t(3350), event: { type: "menu.extracted", id, status: e.status, documentCount: good.length, skippedCount: e.documents.length - good.length, dishCount: e.dishes.length } },
    { at: t(3400), event: step(id, "menu", e.status === "partial" ? "warning" : "done", e.status === "partial" ? "Part of the menu could not be read" : undefined) },
    { at: t(3500), event: step(id, "reviews", "done", "skipped") },
  );
  return entries;
}

export function recordedTimeline(overrides: { budgetMax?: number } = {}): TimelineEntry[] {
  const request: UserRequest = { ...data.request, ...(overrides.budgetMax !== undefined ? { budget: { max: overrides.budgetMax, currency: "EUR", perPerson: true } } : {}) };
  const candidates: RecommendCandidate[] = data.candidates.map((c) => ({ restaurant: c.restaurant, shortlistScore: c.shortlistScore, ...(c.distanceKm !== undefined ? { distanceKm: c.distanceKm } : {}), extraction: c.extraction }));
  const set = recommend({ request, cuisines: data.cuisines, candidates });

  const entries: TimelineEntry[] = [
    { at: 0, event: { type: "run.started" } },
    { at: 600, event: { type: "understood", request } },
    { at: 1000, event: { type: "discover.started", city: request.city } },
    { at: 1200, event: { type: "tool", name: "places", label: `Places text search: "${request.cuisines[0] ?? "restaurants"} restaurants in ${request.city}"` } },
    { at: 2400, event: { type: "discover.found", count: data.discoveredCount ?? data.candidates.length } },
    {
      at: 3200,
      event: {
        type: "shortlist.done",
        restaurants: data.candidates.map((c) => ({
          id: c.restaurant.placeId,
          name: c.restaurant.name,
          rating: c.restaurant.rating,
          ratingCount: c.restaurant.ratingCount,
          priceLevel: c.restaurant.priceLevel,
          distanceKm: c.distanceKm,
          address: c.restaurant.address,
          primaryType: c.restaurant.primaryType,
          mapsUrl: c.restaurant.mapsUrl,
        })),
      },
    },
  ];

  let end = 3400;
  data.candidates.forEach((c, i) => {
    const start = 3400 + i * 500;
    const timeline = restaurantTimeline(c, start);
    entries.push(...timeline);
    end = Math.max(end, ...timeline.map((x) => x.at));
  });

  entries.push(
    { at: end + 600, event: { type: "rank.done" } },
    { at: end + 800, event: { type: "recommendations.ready", payload: set } },
    { at: end + 1200, event: { type: "explain.done" } },
  );
  return entries;
}
