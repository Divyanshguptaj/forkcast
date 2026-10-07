import { RUN_LIMITS } from "@/config/limits";
import { haversineKm } from "@/lib/geo";
import { normalizeText } from "@/lib/text";
import type { DiscoveredRestaurant } from "./discover";
import type { NormalizedRequest } from "./normalizeRequest";

export type RatingConfidence = "high" | "medium" | "low" | "very_low" | "none";

export interface ShortlistSignal {
  name: string;
  value: number | null;
  weight: number;
  contribution: number;
  note: string;
}

export interface ShortlistEntry {
  placeId: string;
  name: string;
  shortlistScore: number;
  signals: ShortlistSignal[];
  penalties: string[];
  ratingConfidence: RatingConfidence;
  distanceKm?: number;
  included: boolean;
  reason: string;
  discovered: DiscoveredRestaurant;
}

export interface ShortlistResult {
  entries: ShortlistEntry[];
  selected: ShortlistEntry[];
}

export const SHORTLIST_WEIGHTS = {
  rating: 0.28,
  credibility: 0.14,
  priceFit: 0.14,
  cuisineMatch: 0.18,
  searchRank: 0.12,
  distance: 0.09,
  vegetarianSignal: 0.05,
} as const;

const PRIOR_RATING = 4.2;
const PRIOR_WEIGHT = 50;
const RATING_FLOOR = 3.5;
const RATING_SPAN = 1.5;
const CREDIBILITY_LOG_SCALE = 3.5;
const DISTANCE_FULL_KM = 1;
const DISTANCE_ZERO_KM = 8;

const PRICE_LEVEL_EUR: Record<number, { entry: number; typical: number }> = {
  0: { entry: 0, typical: 5 },
  1: { entry: 5, typical: 12 },
  2: { entry: 12, typical: 25 },
  3: { entry: 25, typical: 45 },
  4: { entry: 45, typical: 80 },
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number, digits = 3) => Number(n.toFixed(digits));

export function ratingConfidence(count: number | undefined): RatingConfidence {
  if (count === undefined || count <= 0) return "none";
  if (count >= 500) return "high";
  if (count >= 100) return "medium";
  if (count >= 20) return "low";
  return "very_low";
}

export function shrunkRating(rating: number | undefined, count: number | undefined): number {
  if (rating === undefined || !count || count <= 0) return PRIOR_RATING;
  return (count / (count + PRIOR_WEIGHT)) * rating + (PRIOR_WEIGHT / (count + PRIOR_WEIGHT)) * PRIOR_RATING;
}

export function priceFit(priceLevel: number | undefined, budgetMax: number | undefined): number | null {
  if (priceLevel === undefined || budgetMax === undefined) return null;
  const band = PRICE_LEVEL_EUR[priceLevel];
  if (!band) return null;
  if (budgetMax >= band.typical) return 1;
  if (budgetMax >= band.entry) {
    return 0.4 + (0.6 * (budgetMax - band.entry)) / Math.max(1, band.typical - band.entry);
  }
  return 0.4 * clamp01(budgetMax / Math.max(1, band.entry));
}

function cuisineMatch(entry: DiscoveredRestaurant, cuisines: string[]): { value: number | null; note: string } {
  if (cuisines.length === 0) return { value: null, note: "no cuisine requested" };
  const r = entry.restaurant;
  const name = normalizeText(r.name);
  const types = [...r.types, r.primaryType ?? ""].map((t) => t.toLowerCase());
  let best = 0;
  let note = "no cuisine evidence in Places data";
  for (const cuisine of cuisines) {
    const slug = cuisine.replace(/\s+/g, "_");
    if (types.some((t) => t === `${slug}_restaurant` || t.includes(slug))) {
      best = 1;
      note = `Places type matches "${cuisine}"`;
      break;
    }
    if (name.includes(cuisine) && best < 0.8) {
      best = 0.8;
      note = `name mentions "${cuisine}"`;
    }
  }
  if (best === 0 && entry.foundBy.some((h) => h.purpose === "primary" || h.purpose === "second_cuisine")) {
    best = 0.5;
    note = "returned by a cuisine-specific search";
  }
  if (best === 0) best = 0.2;
  return { value: best, note };
}

function searchRank(entry: DiscoveredRestaurant): { value: number; note: string } {
  const values = entry.foundBy.map((h) => (h.resultCount <= 1 ? 1 : 1 - (h.rank - 1) / (h.resultCount - 1)));
  const best = Math.max(...values);
  const multi = entry.foundBy.length > 1 ? 0.1 : 0;
  return {
    value: clamp01(best * 0.9 + multi),
    note: `best rank ${Math.min(...entry.foundBy.map((h) => h.rank))} of ${entry.foundBy[0].resultCount}${entry.foundBy.length > 1 ? ", found by multiple queries" : ""}`,
  };
}

export function brandKey(name: string): string {
  const head = name.split(/\s[-|–]\s|\||\(/)[0];
  return normalizeText(head)
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\b(restaurant|restaurante|restaurant|bar|cafe|the|el|la|els|les|de|del)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildEntry(entry: DiscoveredRestaurant, norm: NormalizedRequest): ShortlistEntry {
  const r = entry.restaurant;
  const signals: ShortlistSignal[] = [];
  const add = (name: keyof typeof SHORTLIST_WEIGHTS, value: number | null, note: string) => {
    const weight = SHORTLIST_WEIGHTS[name];
    signals.push({ name, value: value === null ? null : round(value), weight, contribution: 0, note });
  };

  const shrunk = shrunkRating(r.rating, r.ratingCount);
  add(
    "rating",
    clamp01((shrunk - RATING_FLOOR) / RATING_SPAN),
    r.rating === undefined
      ? "no rating from Places; prior used"
      : `rating ${r.rating} (${r.ratingCount ?? 0} reviews) shrunk to ${shrunk.toFixed(2)}`,
  );
  add(
    "credibility",
    r.ratingCount ? clamp01(Math.log10(1 + r.ratingCount) / CREDIBILITY_LOG_SCALE) : 0,
    `${r.ratingCount ?? 0} ratings`,
  );
  add(
    "priceFit",
    priceFit(r.priceLevel, norm.request.budget?.max),
    r.priceLevel === undefined || !norm.request.budget
      ? "not scored (missing price level or budget)"
      : `price level ${r.priceLevel} vs budget ${norm.request.budget.max} EUR`,
  );
  const cuisine = cuisineMatch(entry, norm.cuisines);
  add("cuisineMatch", cuisine.value, cuisine.note);
  const rank = searchRank(entry);
  add("searchRank", rank.value, rank.note);

  let distanceKm: number | undefined;
  if (norm.origin) {
    distanceKm = haversineKm(norm.origin, r.location);
    add(
      "distance",
      clamp01(1 - (distanceKm - DISTANCE_FULL_KM) / (DISTANCE_ZERO_KM - DISTANCE_FULL_KM)),
      `${distanceKm.toFixed(1)} km from ${norm.origin.source === "request" ? "requested location" : "city center"}`,
    );
  } else {
    add("distance", null, "no origin available");
  }

  const wantsPlantBased = norm.request.diet.some((d) => d === "vegetarian" || d === "vegan");
  add(
    "vegetarianSignal",
    wantsPlantBased ? (r.servesVegetarianFood === true ? 1 : 0) : null,
    !wantsPlantBased
      ? "no vegetarian/vegan diet requested"
      : r.servesVegetarianFood === undefined
        ? "Places gave no vegetarian signal (not a penalty)"
        : `Places servesVegetarianFood=${r.servesVegetarianFood}`,
  );

  let weightSum = 0;
  let total = 0;
  for (const s of signals) {
    if (s.value === null) continue;
    weightSum += s.weight;
    total += s.weight * s.value;
  }
  for (const s of signals) s.contribution = s.value === null || weightSum === 0 ? 0 : round((s.weight * s.value) / weightSum);

  return {
    placeId: r.placeId,
    name: r.name,
    shortlistScore: weightSum === 0 ? 0 : round(total / weightSum),
    signals,
    penalties: [],
    ratingConfidence: ratingConfidence(r.ratingCount),
    distanceKm: distanceKm === undefined ? undefined : round(distanceKm, 2),
    included: false,
    reason: "",
    discovered: entry,
  };
}

export function buildShortlist(
  kept: DiscoveredRestaurant[],
  norm: NormalizedRequest,
  size: number = RUN_LIMITS.shortlistSize,
): ShortlistResult {
  const entries = kept.map((k) => buildEntry(k, norm));
  entries.sort(
    (a, b) =>
      b.shortlistScore - a.shortlistScore ||
      (b.discovered.restaurant.ratingCount ?? 0) - (a.discovered.restaurant.ratingCount ?? 0) ||
      a.placeId.localeCompare(b.placeId),
  );

  const selectedBrands = new Set<string>();
  const selected: ShortlistEntry[] = [];
  for (const entry of entries) {
    const key = brandKey(entry.name);
    if (selected.length >= size) {
      entry.reason = `Not selected: shortlist is full (${size})`;
      continue;
    }
    if (key && selectedBrands.has(key)) {
      entry.penalties.push("duplicate brand location");
      entry.reason = "Not selected: another location of the same restaurant is already shortlisted";
      continue;
    }
    if (key) selectedBrands.add(key);
    entry.included = true;
    entry.reason = `Selected with score ${entry.shortlistScore.toFixed(2)}`;
    selected.push(entry);
  }
  return { entries, selected };
}
