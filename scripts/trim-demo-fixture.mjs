import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/trim-demo-fixture.mjs <recording.json> <output.json>");

const MAX_DISHES = 12;
const rank = { confirmed: 0, possible: 1, unknown: 2, not_suitable: 3 };
const rec = JSON.parse(readFileSync(input, "utf8"));

const candidates = rec.candidates.map((c) => {
  const r = c.restaurant;
  const restaurant = {
    placeId: r.placeId,
    name: r.name,
    address: r.address,
    location: r.location,
    rating: r.rating,
    ratingCount: r.ratingCount,
    priceLevel: r.priceLevel,
    types: r.types.slice(0, 6),
    primaryType: r.primaryType,
    businessStatus: r.businessStatus,
    sourceId: r.sourceId,
    websiteUrl: r.websiteUrl,
    mapsUrl: r.mapsUrl,
    openingHours: r.openingHours ? { weekdayText: [], periods: r.openingHours.periods } : undefined,
    servesVegetarianFood: r.servesVegetarianFood,
    sampledReviews: [],
  };
  const e = c.extraction;
  const dishes = [...e.dishes]
    .map((d, i) => ({ d, i }))
    .sort((a, b) => rank[a.d.diet.vegetarian.status] - rank[b.d.diet.vegetarian.status] || a.i - b.i)
    .slice(0, MAX_DISHES)
    .sort((a, b) => a.i - b.i)
    .map(({ d }) => ({
      ...d,
      originalDescription: d.originalDescription?.slice(0, 120),
      translatedDescription: undefined,
      sources: d.sources.slice(0, 1).map((s) => ({ ...s, evidence: s.evidence?.slice(0, 100) })),
    }));
  const setIds = new Set(dishes.map((d) => d.setMenuId).filter(Boolean));
  return {
    restaurant,
    shortlistScore: c.shortlistScore,
    distanceKm: c.distanceKm,
    extraction: { ...e, dishes, setMenus: e.setMenus.filter((s) => setIds.has(s.id)), warnings: [] },
  };
});

writeFileSync(output, `${JSON.stringify({ recordedAt: rec.recordedAt, scenario: rec.scenario, request: rec.request, cuisines: rec.cuisines, discoveredCount: rec.discoveredCount, candidates })}\n`);
console.log(`${candidates.length} restaurants, ${candidates.reduce((n, c) => n + c.extraction.dishes.length, 0)} dishes`);
