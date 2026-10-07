import { httpUrl, type Source } from "@/schemas/common";
import { RestaurantDetailsSchema, type OpeningHours, type RestaurantDetails } from "@/schemas/restaurant";
import { GooglePlaceSchema, type GooglePlace } from "./googleTypes";
import { normalizeWebsite } from "./websiteUrl";

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

const BUSINESS_STATUSES = new Set(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]);

export interface MapContext {
  fetchedAt: string;
}

export interface MappedPlace {
  restaurant: RestaurantDetails;
  source: Source;
}

function mapHours(raw: GooglePlace["regularOpeningHours"]): OpeningHours | undefined {
  if (!raw) return undefined;
  return {
    weekdayText: raw.weekdayDescriptions ?? [],
    periods: (raw.periods ?? []).map((p) => ({ open: p.open, close: p.close })),
    openNow: raw.openNow,
  };
}

export function mapGooglePlace(input: unknown, ctx: MapContext): MappedPlace | null {
  const parsed = GooglePlaceSchema.safeParse(input);
  if (!parsed.success) return null;
  const place = parsed.data;

  const name = place.displayName?.text.trim();
  if (!name || !place.location) return null;

  const mapsUrl = place.googleMapsUri ? httpUrl.safeParse(place.googleMapsUri) : undefined;
  const sourceId = `places:${place.id}`;
  const source: Source = {
    id: sourceId,
    provider: "google_places",
    url: mapsUrl?.success ? mapsUrl.data : undefined,
    fetchedAt: ctx.fetchedAt,
    label: "Google Places",
  };

  const website = normalizeWebsite(place.websiteUri);
  const rating = place.rating !== undefined && place.rating >= 0 && place.rating <= 5 ? place.rating : undefined;
  const ratingCount =
    place.userRatingCount !== undefined && Number.isInteger(place.userRatingCount) && place.userRatingCount >= 0
      ? place.userRatingCount
      : undefined;

  const candidate = {
    placeId: place.id,
    name,
    address: place.formattedAddress,
    location: { lat: place.location.latitude, lng: place.location.longitude },
    rating,
    ratingCount,
    priceLevel: place.priceLevel ? PRICE_LEVELS[place.priceLevel] : undefined,
    types: place.types ?? [],
    primaryType: place.primaryType,
    businessStatus:
      place.businessStatus && BUSINESS_STATUSES.has(place.businessStatus) ? place.businessStatus : undefined,
    sourceId,
    websiteUrl: website.original,
    websiteHttpsCandidate: website.httpsCandidate,
    mapsUrl: mapsUrl?.success ? mapsUrl.data : undefined,
    openingHours: mapHours(place.regularOpeningHours),
    servesVegetarianFood: place.servesVegetarianFood,
    sampledReviews: [],
  };

  const restaurant = RestaurantDetailsSchema.safeParse(candidate);
  if (!restaurant.success) return null;
  return { restaurant: restaurant.data, source };
}
