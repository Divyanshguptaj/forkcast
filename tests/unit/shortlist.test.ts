import { describe, expect, it } from "vitest";
import {
  SHORTLIST_WEIGHTS,
  brandKey,
  buildShortlist,
  priceFit,
  ratingConfidence,
  shrunkRating,
} from "@/server/discovery/shortlist";
import { discovered, norm } from "../helpers/places";

const many = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    discovered({ placeId: `p${String(i).padStart(2, "0")}`, name: `Place ${i}`, rating: 4.0 + (i % 10) / 20, ratingCount: 200 + i * 37 }, i + 1, n),
  );

describe("shortlist determinism", () => {
  it("selects the configured number and is order independent", () => {
    const input = many(20);
    const a = buildShortlist(input, norm());
    const b = buildShortlist([...input].reverse(), norm());
    expect(a.selected).toHaveLength(5);
    expect(a.selected.map((e) => e.placeId)).toEqual(b.selected.map((e) => e.placeId));
    expect(a.entries.map((e) => e.shortlistScore)).toEqual(b.entries.map((e) => e.shortlistScore));
  });

  it("returns identical output across runs", () => {
    const strip = (r: ReturnType<typeof buildShortlist>) => r.entries.map((e) => ({ ...e, discovered: undefined }));
    expect(JSON.stringify(strip(buildShortlist(many(12), norm())))).toBe(JSON.stringify(strip(buildShortlist(many(12), norm()))));
  });

  it("returns everything when there are fewer candidates than slots", () => {
    const r = buildShortlist(many(3), norm());
    expect(r.selected).toHaveLength(3);
    expect(r.entries.every((e) => e.included)).toBe(true);
  });

  it("handles an empty candidate list", () => {
    expect(buildShortlist([], norm())).toEqual({ entries: [], selected: [] });
  });

  it("breaks exact ties by rating count then place id", () => {
    const tied = [
      discovered({ placeId: "b", name: "B", rating: 4.5, ratingCount: 500 }),
      discovered({ placeId: "a", name: "A", rating: 4.5, ratingCount: 500 }),
      discovered({ placeId: "c", name: "C", rating: 4.5, ratingCount: 500 }),
    ];
    const r = buildShortlist(tied, norm({ cuisines: [], diet: [], budget: undefined }), 3);
    expect(r.entries.map((e) => e.placeId)).toEqual(["a", "b", "c"]);
    const reversed = buildShortlist([...tied].reverse(), norm({ cuisines: [], diet: [], budget: undefined }), 3);
    expect(reversed.entries.map((e) => e.placeId)).toEqual(["a", "b", "c"]);
  });
});

describe("rating confidence", () => {
  it("labels confidence by review count", () => {
    expect(ratingConfidence(undefined)).toBe("none");
    expect(ratingConfidence(0)).toBe("none");
    expect(ratingConfidence(5)).toBe("very_low");
    expect(ratingConfidence(50)).toBe("low");
    expect(ratingConfidence(300)).toBe("medium");
    expect(ratingConfidence(2000)).toBe("high");
  });

  it("shrinks small samples toward the prior", () => {
    expect(shrunkRating(5, 3)).toBeLessThan(4.4);
    expect(shrunkRating(4.6, 2000)).toBeGreaterThan(4.55);
    expect(shrunkRating(undefined, undefined)).toBe(shrunkRating(5, 0));
  });

  it("a 5.0 with 3 reviews does not beat a 4.6 with 2000 reviews", () => {
    const r = buildShortlist(
      [
        discovered({ placeId: "tiny", name: "Tiny", rating: 5, ratingCount: 3 }),
        discovered({ placeId: "big", name: "Big", rating: 4.6, ratingCount: 2000 }),
      ],
      norm(),
      1,
    );
    expect(r.selected[0].placeId).toBe("big");
  });

  it("records rating confidence on entries", () => {
    const r = buildShortlist([discovered({ ratingCount: 4 })], norm());
    expect(r.entries[0].ratingConfidence).toBe("very_low");
  });
});

describe("price compatibility", () => {
  it("fits when the budget covers the typical price", () => {
    expect(priceFit(2, 30)).toBe(1);
    expect(priceFit(1, 30)).toBe(1);
  });

  it("degrades smoothly as the budget falls short", () => {
    const l3 = priceFit(3, 30)!;
    const l4 = priceFit(4, 30)!;
    expect(l3).toBeGreaterThan(l4);
    expect(l3).toBeLessThan(1);
    expect(l4).toBeLessThan(0.4);
  });

  it("is not scored without a price level or a budget", () => {
    expect(priceFit(undefined, 30)).toBeNull();
    expect(priceFit(2, undefined)).toBeNull();
  });

  it("prefers a restaurant that fits the budget when everything else is equal", () => {
    const r = buildShortlist(
      [
        discovered({ placeId: "pricey", name: "Pricey", priceLevel: 4 }),
        discovered({ placeId: "fits", name: "Fits", priceLevel: 2 }),
      ],
      norm(),
      1,
    );
    expect(r.selected[0].placeId).toBe("fits");
  });

  it("does not penalize or exclude a missing price level", () => {
    const r = buildShortlist([discovered({ placeId: "np", priceLevel: undefined })], norm());
    expect(r.selected).toHaveLength(1);
    const price = r.entries[0].signals.find((s) => s.name === "priceFit")!;
    expect(price.value).toBeNull();
    expect(price.contribution).toBe(0);
  });
});

describe("vegetarian Places signal stays weak", () => {
  it("can break ties but never overturns a clear rating gap", () => {
    const r = buildShortlist(
      [
        discovered({ placeId: "veg", name: "Veg Place", rating: 4.2, ratingCount: 800, servesVegetarianFood: true }),
        discovered({ placeId: "better", name: "Better Place", rating: 4.8, ratingCount: 800 }),
      ],
      norm(),
      1,
    );
    expect(r.selected[0].placeId).toBe("better");
  });

  it("breaks an otherwise exact tie", () => {
    const r = buildShortlist(
      [
        discovered({ placeId: "a-no", name: "No Signal", servesVegetarianFood: undefined }),
        discovered({ placeId: "z-yes", name: "Yes Signal", servesVegetarianFood: true }),
      ],
      norm(),
      1,
    );
    expect(r.selected[0].placeId).toBe("z-yes");
  });

  it("has the smallest weight and is skipped when no plant-based diet is requested", () => {
    const smallest = Math.min(...Object.values(SHORTLIST_WEIGHTS));
    expect(SHORTLIST_WEIGHTS.vegetarianSignal).toBe(smallest);
    const r = buildShortlist([discovered({ servesVegetarianFood: true })], norm({ diet: [] }));
    expect(r.entries[0].signals.find((s) => s.name === "vegetarianSignal")!.value).toBeNull();
  });

  it("missing signal gives zero, not a penalty beyond the weight", () => {
    const r = buildShortlist(
      [discovered({ servesVegetarianFood: undefined }), discovered({ placeId: "p2", servesVegetarianFood: true })],
      norm(),
    );
    const [first, second] = r.entries;
    expect(Math.abs(first.shortlistScore - second.shortlistScore)).toBeLessThanOrEqual(SHORTLIST_WEIGHTS.vegetarianSignal + 0.001);
  });
});

describe("explainability and brand de-duplication", () => {
  it("exposes score, signals, penalties, inclusion and reason", () => {
    const r = buildShortlist(many(8), norm());
    const entry = r.entries[0];
    expect(entry.signals.map((s) => s.name)).toEqual(["rating", "credibility", "priceFit", "cuisineMatch", "searchRank", "distance", "vegetarianSignal"]);
    expect(entry.signals.every((s) => typeof s.note === "string" && s.note.length > 0)).toBe(true);
    expect(entry.reason).toMatch(/Selected/);
    const rejected = r.entries.find((e) => !e.included)!;
    expect(rejected.reason).toMatch(/Not selected/);
  });

  it("weights sum to one and contributions sum to the score", () => {
    expect(Object.values(SHORTLIST_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const entry = buildShortlist(many(3), norm()).entries[0];
    const sum = entry.signals.reduce((a, s) => a + s.contribution, 0);
    expect(sum).toBeCloseTo(entry.shortlistScore, 2);
  });

  it("redistributes weight for signals that do not apply", () => {
    const entry = buildShortlist([discovered()], norm({ cuisines: [], diet: [], budget: undefined })).entries[0];
    const applicable = entry.signals.filter((s) => s.value !== null);
    expect(applicable.reduce((a, s) => a + s.contribution, 0)).toBeCloseTo(entry.shortlistScore, 2);
    expect(entry.shortlistScore).toBeGreaterThan(0.5);
  });

  it("keeps only one location per brand", () => {
    const r = buildShortlist(
      [
        discovered({ placeId: "t1", name: "Teresa Carles", ratingCount: 3000 }),
        discovered({ placeId: "t2", name: "Teresa Carles", ratingCount: 2000 }),
        discovered({ placeId: "o1", name: "Other Place", ratingCount: 1000 }),
      ],
      norm(),
      3,
    );
    expect(r.selected.map((e) => e.placeId)).toEqual(expect.arrayContaining(["t1", "o1"]));
    const dup = r.entries.find((e) => e.placeId === "t2")!;
    expect(dup.included).toBe(false);
    expect(dup.penalties).toContain("duplicate brand location");
  });

  it("derives brand keys without district suffixes or accents", () => {
    expect(brandKey("Viento | Restaurante Italiano Barcelona")).toBe(brandKey("Viento"));
    expect(brandKey("Vegetalia Born - Restaurant vegetarià Barcelona")).toBe("vegetalia born");
    expect(brandKey("Café de l'Òpera")).not.toMatch(/[^\x00-\x7f]/);
  });

  it("scores missing ratings with the prior instead of excluding", () => {
    const r = buildShortlist([discovered({ rating: undefined, ratingCount: undefined })], norm());
    expect(r.selected).toHaveLength(1);
    expect(r.entries[0].ratingConfidence).toBe("none");
  });
});
