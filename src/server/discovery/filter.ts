import { haversineKm } from "@/lib/geo";
import type { RestaurantDetails } from "@/schemas/restaurant";
import type { DiscoveredRestaurant } from "./discover";
import type { NormalizedRequest } from "./normalizeRequest";

export type FilterRule =
  | "invalid_candidate"
  | "permanently_closed"
  | "temporarily_closed"
  | "not_a_food_venue"
  | "outside_area"
  | "no_service_in_meal_window";

export interface ExcludedCandidate {
  placeId: string;
  name: string;
  rule: FilterRule;
  reason: string;
}

export interface FilterResult {
  kept: DiscoveredRestaurant[];
  excluded: ExcludedCandidate[];
}

const FOOD_TYPE_HINTS = [
  "restaurant",
  "cafe",
  "coffee_shop",
  "bar",
  "bakery",
  "food",
  "meal_takeaway",
  "meal_delivery",
  "brunch",
  "breakfast",
  "pub",
  "tapas",
];

export const MEAL_WINDOWS: Record<string, { start: number; end: number; label: string }> = {
  breakfast: { start: 8 * 60, end: 11 * 60, label: "breakfast hours (08:00-11:00)" },
  brunch: { start: 10 * 60, end: 14 * 60, label: "brunch hours (10:00-14:00)" },
  lunch: { start: 13 * 60, end: 16 * 60, label: "lunch hours (13:00-16:00)" },
  dinner: { start: 19 * 60, end: 23 * 60, label: "dinner hours (19:00-23:00)" },
};

const MINUTES_PER_DAY = 1440;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;
const AREA_RADIUS_FACTOR = 2.5;

type Period = NonNullable<RestaurantDetails["openingHours"]>["periods"][number];

function pointToMinutes(p: { day: number; hour: number; minute: number }): number {
  return p.day * MINUTES_PER_DAY + p.hour * 60 + p.minute;
}

function periodOverlapsWindow(period: Period, window: { start: number; end: number }): boolean {
  if (!period.close) return true;
  const open = pointToMinutes(period.open);
  let close = pointToMinutes(period.close);
  if (close <= open) close += MINUTES_PER_WEEK;
  for (let day = 0; day < 7; day++) {
    for (const shift of [-MINUTES_PER_WEEK, 0, MINUTES_PER_WEEK]) {
      const start = day * MINUTES_PER_DAY + window.start + shift;
      const end = day * MINUTES_PER_DAY + window.end + shift;
      if (open < end && close > start) return true;
    }
  }
  return false;
}

export function hasServiceInWindow(restaurant: RestaurantDetails, meal: string): boolean | undefined {
  const window = MEAL_WINDOWS[meal];
  const periods = restaurant.openingHours?.periods ?? [];
  if (!window || periods.length === 0) return undefined;
  return periods.some((p) => periodOverlapsWindow(p, window));
}

function isFoodVenue(types: string[]): boolean {
  if (types.length === 0) return true;
  return types.some((t) => FOOD_TYPE_HINTS.some((hint) => t === hint || t.endsWith(`_${hint}`) || t.startsWith(`${hint}_`)));
}

function areaLimitKm(norm: NormalizedRequest): number | undefined {
  if (norm.request.maxDistanceKm !== undefined) return norm.request.maxDistanceKm;
  if (norm.city) return (norm.city.radiusMeters / 1000) * AREA_RADIUS_FACTOR;
  return undefined;
}

export function filterCandidates(discovered: DiscoveredRestaurant[], norm: NormalizedRequest): FilterResult {
  const kept: DiscoveredRestaurant[] = [];
  const excluded: ExcludedCandidate[] = [];
  const limitKm = areaLimitKm(norm);

  for (const entry of discovered) {
    const r = entry.restaurant;
    const exclude = (rule: FilterRule, reason: string) =>
      excluded.push({ placeId: r.placeId, name: r.name, rule, reason });

    if (!r.placeId || !r.name.trim() || !Number.isFinite(r.location.lat) || !Number.isFinite(r.location.lng)) {
      exclude("invalid_candidate", "Missing identity or coordinates");
      continue;
    }
    if (r.businessStatus === "CLOSED_PERMANENTLY") {
      exclude("permanently_closed", "Google lists this place as permanently closed");
      continue;
    }
    if (r.businessStatus === "CLOSED_TEMPORARILY") {
      exclude("temporarily_closed", "Google lists this place as temporarily closed");
      continue;
    }
    if (!isFoodVenue(r.types)) {
      exclude("not_a_food_venue", "Place types do not include a food venue");
      continue;
    }
    if (limitKm !== undefined && norm.origin) {
      const distance = haversineKm(norm.origin, r.location);
      if (distance > limitKm) {
        exclude("outside_area", `${distance.toFixed(1)} km from the search origin (limit ${limitKm.toFixed(1)} km)`);
        continue;
      }
    }
    const meal = norm.request.meal;
    if (hasServiceInWindow(r, meal) === false) {
      exclude("no_service_in_meal_window", `Opening hours show no service during ${MEAL_WINDOWS[meal].label}`);
      continue;
    }
    kept.push(entry);
  }

  return { kept, excluded };
}
