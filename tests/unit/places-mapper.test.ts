import { describe, expect, it, vi } from "vitest";
import { mapGooglePlace } from "@/server/providers/places/mapper";
import { normalizeWebsite } from "@/server/providers/places/websiteUrl";
import { rawPlace } from "../helpers/places";

const ctx = { fetchedAt: "2026-10-07T12:00:00.000Z" };

describe("mapGooglePlace", () => {
  it("maps a complete place", () => {
    const mapped = mapGooglePlace(rawPlace(), ctx)!;
    expect(mapped.restaurant).toMatchObject({
      placeId: "place-1",
      name: "Trattoria Uno",
      address: "Carrer Major 1, Barcelona",
      location: { lat: 41.39, lng: 2.17 },
      rating: 4.6,
      ratingCount: 1200,
      priceLevel: 2,
      websiteUrl: "https://trattoria.example/",
      mapsUrl: "https://maps.google.com/?cid=1",
      servesVegetarianFood: true,
      primaryType: "italian_restaurant",
      businessStatus: "OPERATIONAL",
      sourceId: "places:place-1",
    });
    expect(mapped.restaurant.openingHours?.periods).toHaveLength(1);
    expect(mapped.restaurant.openingHours?.weekdayText[0]).toContain("Monday");
    expect(mapped.source).toEqual({
      id: "places:place-1",
      provider: "google_places",
      url: "https://maps.google.com/?cid=1",
      fetchedAt: ctx.fetchedAt,
      label: "Google Places",
    });
  });

  it("keeps a missing website missing", () => {
    const r = mapGooglePlace(rawPlace({ websiteUri: undefined }), ctx)!.restaurant;
    expect(r.websiteUrl).toBeUndefined();
    expect(r.websiteHttpsCandidate).toBeUndefined();
  });

  it("keeps a missing price level missing, and ignores unspecified levels", () => {
    expect(mapGooglePlace(rawPlace({ priceLevel: undefined }), ctx)!.restaurant.priceLevel).toBeUndefined();
    expect(mapGooglePlace(rawPlace({ priceLevel: "PRICE_LEVEL_UNSPECIFIED" }), ctx)!.restaurant.priceLevel).toBeUndefined();
  });

  it.each([
    ["PRICE_LEVEL_FREE", 0],
    ["PRICE_LEVEL_INEXPENSIVE", 1],
    ["PRICE_LEVEL_MODERATE", 2],
    ["PRICE_LEVEL_EXPENSIVE", 3],
    ["PRICE_LEVEL_VERY_EXPENSIVE", 4],
  ])("maps %s to %i", (level, expected) => {
    expect(mapGooglePlace(rawPlace({ priceLevel: level }), ctx)!.restaurant.priceLevel).toBe(expected);
  });

  it("keeps a missing vegetarian signal missing", () => {
    const r = mapGooglePlace(rawPlace({ servesVegetarianFood: undefined }), ctx)!.restaurant;
    expect(r.servesVegetarianFood).toBeUndefined();
    expect(mapGooglePlace(rawPlace({ servesVegetarianFood: false }), ctx)!.restaurant.servesVegetarianFood).toBe(false);
  });

  it("preserves an http website and adds an unverified https candidate", () => {
    const r = mapGooglePlace(rawPlace({ websiteUri: "http://www.viento.example/" }), ctx)!.restaurant;
    expect(r.websiteUrl).toBe("http://www.viento.example/");
    expect(r.websiteHttpsCandidate).toBe("https://www.viento.example/");
  });

  it("does not invent ratings", () => {
    const r = mapGooglePlace(rawPlace({ rating: undefined, userRatingCount: undefined }), ctx)!.restaurant;
    expect(r.rating).toBeUndefined();
    expect(r.ratingCount).toBeUndefined();
  });

  it("omits out-of-range ratings and unknown business statuses", () => {
    const r = mapGooglePlace(rawPlace({ rating: 7.5, businessStatus: "BUSINESS_STATUS_UNSPECIFIED" }), ctx)!.restaurant;
    expect(r.rating).toBeUndefined();
    expect(r.businessStatus).toBeUndefined();
  });

  it("defaults omitted hour/minute/day fields in opening hours to zero", () => {
    const hours = { periods: [{ open: { hour: 19 }, close: { day: 0, hour: 23 } }] };
    const r = mapGooglePlace(rawPlace({ regularOpeningHours: hours }), ctx)!.restaurant;
    expect(r.openingHours?.periods[0]).toEqual({ open: { day: 0, hour: 19, minute: 0 }, close: { day: 0, hour: 23, minute: 0 } });
  });

  it("returns null for places without identity or coordinates", () => {
    expect(mapGooglePlace(rawPlace({ displayName: undefined }), ctx)).toBeNull();
    expect(mapGooglePlace(rawPlace({ displayName: { text: "   " } }), ctx)).toBeNull();
    expect(mapGooglePlace(rawPlace({ location: undefined }), ctx)).toBeNull();
    expect(mapGooglePlace(rawPlace({ id: "" }), ctx)).toBeNull();
    expect(mapGooglePlace(null, ctx)).toBeNull();
  });
});

describe("untrusted external URLs", () => {
  it("drops non-http website and maps URLs instead of passing them on", () => {
    const r = mapGooglePlace(rawPlace({ websiteUri: "javascript:alert(1)", googleMapsUri: "data:text/html,x" }), ctx)!;
    expect(r.restaurant.websiteUrl).toBeUndefined();
    expect(r.restaurant.mapsUrl).toBeUndefined();
    expect(r.source.url).toBeUndefined();
  });

  it("drops IP-literal websites at the schema boundary", () => {
    const r = mapGooglePlace(rawPlace({ websiteUri: "http://10.0.0.1/admin" }), ctx)!.restaurant;
    expect(r.websiteUrl).toBeUndefined();
  });

  it("treats other hostnames as data and never fetches them while mapping", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const r = mapGooglePlace(rawPlace({ websiteUri: "http://intranet.corp.example/admin" }), ctx)!.restaurant;
    expect(r.websiteUrl).toBe("http://intranet.corp.example/admin");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("normalizeWebsite", () => {
  it("leaves https URLs untouched", () => {
    expect(normalizeWebsite("https://example.com/menu")).toEqual({ original: "https://example.com/menu" });
  });

  it("proposes https for http URLs and keeps path and query", () => {
    expect(normalizeWebsite("http://example.com/carta?x=1")).toEqual({
      original: "http://example.com/carta?x=1",
      httpsCandidate: "https://example.com/carta?x=1",
    });
  });

  it("drops explicit port 80 on the https candidate", () => {
    expect(normalizeWebsite("http://example.com:80/")?.httpsCandidate).toBe("https://example.com/");
  });

  it("handles missing and invalid input", () => {
    expect(normalizeWebsite(undefined)).toEqual({});
    expect(normalizeWebsite("")).toEqual({});
    expect(normalizeWebsite("not a url")).toEqual({});
    expect(normalizeWebsite("ftp://example.com")).toEqual({});
  });
});
