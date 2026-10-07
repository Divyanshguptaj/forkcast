import type { DiscoveredRestaurant } from "@/server/discovery/discover";
import { normalizeRequest, type NormalizedRequest } from "@/server/discovery/normalizeRequest";
import type { RestaurantDetails } from "@/schemas/restaurant";
import type { UserRequest } from "@/schemas/request";

export const CITY_CENTER = { lat: 41.3874, lng: 2.1686 };

export function rawPlace(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "place-1",
    displayName: { text: "Trattoria Uno", languageCode: "en" },
    formattedAddress: "Carrer Major 1, Barcelona",
    location: { latitude: 41.39, longitude: 2.17 },
    types: ["italian_restaurant", "restaurant", "food"],
    primaryType: "italian_restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=1",
    rating: 4.6,
    userRatingCount: 1200,
    priceLevel: "PRICE_LEVEL_MODERATE",
    websiteUri: "https://trattoria.example/",
    regularOpeningHours: {
      openNow: true,
      periods: [{ open: { day: 1, hour: 12, minute: 30 }, close: { day: 1, hour: 23, minute: 30 } }],
      weekdayDescriptions: ["Monday: 12:30 PM - 11:30 PM"],
    },
    servesVegetarianFood: true,
    ...over,
  };
}

export function restaurant(over: Partial<RestaurantDetails> = {}): RestaurantDetails {
  return {
    placeId: "p1",
    name: "Trattoria Uno",
    address: "Carrer Major 1, Barcelona",
    location: { lat: 41.39, lng: 2.17 },
    rating: 4.6,
    ratingCount: 1200,
    priceLevel: 2,
    types: ["italian_restaurant", "restaurant"],
    sourceId: "places:p1",
    sampledReviews: [],
    ...over,
  };
}

export function discovered(over: Partial<RestaurantDetails> = {}, rank = 1, count = 20): DiscoveredRestaurant {
  return {
    restaurant: restaurant(over),
    foundBy: [{ queryId: "q1", purpose: "primary", rank, resultCount: count }],
  };
}

export function norm(over: Partial<UserRequest> = {}): NormalizedRequest {
  return normalizeRequest({
    city: "Barcelona",
    meal: "dinner",
    diet: ["vegetarian"],
    cuisines: ["Italian"],
    budget: { max: 30, currency: "EUR", perPerson: true },
    preferences: ["not too crowded"],
    allergies: [],
    dislikedFoods: [],
    mustHave: [],
    reviewSearchTerms: [],
    ...over,
  });
}

export function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

export function errorResponse(status: number, body: unknown = { error: { status: "SOME_ERROR", message: "x" } }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
