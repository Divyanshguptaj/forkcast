import { describe, expect, it } from "vitest";
import { filterCandidates, hasServiceInWindow } from "@/server/discovery/filter";
import { discovered, norm, restaurant } from "../helpers/places";

const open = (day: number, h: number, m = 0) => ({ day, hour: h, minute: m });
const hours = (periods: Array<{ open: ReturnType<typeof open>; close?: ReturnType<typeof open> }>) => ({ weekdayText: [], periods });

function run(over: Parameters<typeof restaurant>[0], request: Parameters<typeof norm>[0] = {}) {
  return filterCandidates([discovered(over)], norm(request));
}

describe("filterCandidates: hard exclusions", () => {
  it("excludes permanently closed places", () => {
    const r = run({ businessStatus: "CLOSED_PERMANENTLY" });
    expect(r.kept).toHaveLength(0);
    expect(r.excluded[0].rule).toBe("permanently_closed");
  });

  it("excludes temporarily closed places with a distinct reason", () => {
    expect(run({ businessStatus: "CLOSED_TEMPORARILY" }).excluded[0].rule).toBe("temporarily_closed");
  });

  it("excludes invalid candidates", () => {
    expect(run({ name: "   " }).excluded[0].rule).toBe("invalid_candidate");
    expect(run({ location: { lat: Number.NaN, lng: 2 } }).excluded[0].rule).toBe("invalid_candidate");
  });

  it("excludes places that are not food venues", () => {
    expect(run({ types: ["lodging", "point_of_interest"] }).excluded[0].rule).toBe("not_a_food_venue");
  });

  it("does not mistake unrelated types for food venues", () => {
    expect(run({ types: ["barber_shop"] }).excluded[0].rule).toBe("not_a_food_venue");
  });

  it("excludes places far outside the city", () => {
    const r = run({ location: { lat: 40.4168, lng: -3.7038 } });
    expect(r.excluded[0].rule).toBe("outside_area");
    expect(r.excluded[0].reason).toMatch(/km/);
  });

  it("keeps nearby places and places in neighbouring districts", () => {
    expect(run({ location: { lat: 41.4, lng: 2.17 } }).kept).toHaveLength(1);
    expect(run({ location: { lat: 41.3586, lng: 2.0996 } }).kept).toHaveLength(1);
  });

  it("honours an explicit max distance", () => {
    const r = run({ location: { lat: 41.43, lng: 2.17 } }, { maxDistanceKm: 2 });
    expect(r.excluded[0].rule).toBe("outside_area");
  });

  it("skips the area check when the city has no configured center", () => {
    const r = run({ location: { lat: 38.7223, lng: -9.1393 } }, { city: "Lisbon" });
    expect(r.kept).toHaveLength(1);
  });
});

describe("filterCandidates: missing metadata is not a reason to exclude", () => {
  it("keeps a place with nothing but identity and location", () => {
    const r = run({
      rating: undefined,
      ratingCount: undefined,
      priceLevel: undefined,
      websiteUrl: undefined,
      mapsUrl: undefined,
      openingHours: undefined,
      servesVegetarianFood: undefined,
      address: undefined,
      types: [],
    });
    expect(r.kept).toHaveLength(1);
    expect(r.excluded).toHaveLength(0);
  });

  it("does not exclude on servesVegetarianFood=false", () => {
    expect(run({ servesVegetarianFood: false }).kept).toHaveLength(1);
  });

  it("does not exclude on price level or budget mismatch", () => {
    expect(run({ priceLevel: 4 }, { budget: { max: 10, currency: "EUR", perPerson: true } }).kept).toHaveLength(1);
  });

  it("does not exclude on missing website", () => {
    expect(run({ websiteUrl: undefined }).kept).toHaveLength(1);
  });
});

describe("meal window filtering", () => {
  it("excludes a lunch-only place for dinner", () => {
    const lunchOnly = hours([1, 2, 3, 4, 5].map((d) => ({ open: open(d, 12), close: open(d, 16) })));
    const r = run({ openingHours: lunchOnly }, { meal: "dinner" });
    expect(r.excluded[0].rule).toBe("no_service_in_meal_window");
    expect(run({ openingHours: lunchOnly }, { meal: "lunch" }).kept).toHaveLength(1);
  });

  it("keeps a place open late on any single day", () => {
    const mixed = hours([{ open: open(1, 12), close: open(1, 16) }, { open: open(5, 19), close: open(5, 23, 30) }]);
    expect(run({ openingHours: mixed }, { meal: "dinner" }).kept).toHaveLength(1);
  });

  it("treats periods without a close time as always open", () => {
    expect(run({ openingHours: hours([{ open: open(0, 0) }]) }, { meal: "dinner" }).kept).toHaveLength(1);
  });

  it("handles periods that wrap past midnight", () => {
    const lateBar = hours([{ open: open(5, 22), close: open(6, 3) }]);
    expect(hasServiceInWindow(restaurant({ openingHours: lateBar }), "dinner")).toBe(true);
  });

  it("handles periods that wrap around the end of the week", () => {
    const sundayNight = hours([{ open: open(6, 22), close: open(0, 2) }]);
    expect(hasServiceInWindow(restaurant({ openingHours: sundayNight }), "dinner")).toBe(true);
  });

  it("does not exclude when hours are missing or empty", () => {
    expect(run({ openingHours: undefined }, { meal: "dinner" }).kept).toHaveLength(1);
    expect(run({ openingHours: hours([]) }, { meal: "dinner" }).kept).toHaveLength(1);
  });

  it("applies no meal filter for 'any'", () => {
    const morningOnly = hours([{ open: open(1, 7), close: open(1, 9) }]);
    expect(run({ openingHours: morningOnly }, { meal: "any" }).kept).toHaveLength(1);
  });

  it("excludes dinner-only places for breakfast", () => {
    const dinnerOnly = hours([0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: open(d, 19, 30), close: open(d, 23) })));
    expect(run({ openingHours: dinnerOnly }, { meal: "breakfast" }).excluded[0].rule).toBe("no_service_in_meal_window");
  });
});
