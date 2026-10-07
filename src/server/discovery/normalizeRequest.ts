import { getCity, type CityConfig } from "@/config/cities";
import { UserRequestSchema, type UserRequest } from "@/schemas/request";
import { normalizeText } from "@/lib/text";

export interface NormalizedRequest {
  request: UserRequest;
  city?: CityConfig;
  origin?: { lat: number; lng: number; source: "request" | "city_center" };
  cuisines: string[];
  unresolvedPreferences: string[];
  warnings: string[];
}

const CUISINE_ALIASES: Record<string, string> = {
  italiana: "italian",
  italiano: "italian",
  italia: "italian",
  japonesa: "japanese",
  japones: "japanese",
  mediterranea: "mediterranean",
  mediterranis: "mediterranean",
  espanola: "spanish",
  catalana: "catalan",
  mexicana: "mexican",
  india: "indian",
};

function canonicalCuisine(raw: string): string {
  const cleaned = normalizeText(raw)
    .replace(/\b(restaurants?|restaurantes?|food|cuisine|cocina|comida)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return CUISINE_ALIASES[cleaned] ?? cleaned;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function normalizeRequest(input: UserRequest): NormalizedRequest {
  const request = UserRequestSchema.parse(input);
  const warnings: string[] = [];

  const city = getCity(request.city);
  if (!city) warnings.push(`City "${request.city}" is not configured; results are not biased to a location.`);

  const origin = request.location
    ? { ...request.location, source: "request" as const }
    : city
      ? { ...city.center, source: "city_center" as const }
      : undefined;

  const cuisines = dedupe(request.cuisines.map(canonicalCuisine));
  const unresolvedPreferences = dedupe([...request.preferences, ...request.mustHave].map((p) => p.trim()));

  return {
    request: { ...request, city: city?.name ?? request.city, country: request.country ?? city?.country },
    city,
    origin,
    cuisines,
    unresolvedPreferences,
    warnings,
  };
}
