import { buildTimeline, type ReplayStep, type TimelineEntry } from "@/lib/agent/replay";
import { recordedTimeline } from "./recorded";

export type ScenarioId = "recorded" | "recorded-no-exact" | "full-demo" | "phase2" | "no-results" | "places-down" | "timeout";

export interface ReplayScenario {
  id: ScenarioId;
  label: string;
  description: string;
  mockedStages: boolean;
  withResultsPreview: boolean;
  steps: ReplayStep[];
}

/* DEV / DEMO DATA. Restaurant names, ratings and counts are synthetic
   (synthetic data). Everything after `shortlist.done` in "full-demo" is simulated. */

const SHORTLIST = [
  { id: "demo-alba", name: "Osteria Alba", rating: 4.7, ratingCount: 3120, priceLevel: 2, distanceKm: 0.5, primaryType: "italian_restaurant" },
  { id: "demo-marina", name: "Trattoria Marina", rating: 4.6, ratingCount: 2140, priceLevel: 2, distanceKm: 1.1, primaryType: "italian_restaurant" },
  { id: "demo-viento", name: "Viento | Restaurante Italiano Barcelona", rating: 4.5, ratingCount: 1190, priceLevel: 2, distanceKm: 0.6, primaryType: "italian_restaurant" },
  { id: "demo-elio", name: "Elio's - Restaurant italianà a Barcelona i Bar de Còctels", rating: 4.3, ratingCount: 410, priceLevel: 2, distanceKm: 0.4, primaryType: "italian_restaurant" },
  { id: "demo-atelier", name: "Pasta Atelier", rating: 4.4, ratingCount: 980, priceLevel: 2, distanceKm: 1, primaryType: "italian_restaurant" },
] as const;

const REQUEST = {
  city: "Barcelona",
  country: "ES",
  meal: "dinner",
  diet: ["vegetarian"],
  allergies: [],
  dislikedFoods: [],
  cuisines: ["italian"],
  budget: { max: 30, currency: "EUR", perPerson: true },
  preferences: ["not too crowded"],
  mustHave: [],
  reviewSearchTerms: [],
};

function discovery(count: number, withShortlist: boolean): TimelineEntry[] {
  const entries: TimelineEntry[] = [
    { at: 0, event: { type: "run.started" } },
    { at: 800, event: { type: "understood", request: REQUEST } },
    { at: 1300, event: { type: "discover.started", city: "Barcelona" } },
    { at: 1500, event: { type: "tool", name: "places", label: 'Places text search: "italian restaurants in Barcelona"' } },
    { at: 2600, event: { type: "tool", name: "places", label: 'Places text search: "vegetarian italian restaurants in Barcelona"' } },
    { at: 3500, event: { type: "discover.found", count } },
  ];
  if (withShortlist) {
    entries.push({ at: 5200, event: { type: "shortlist.done", restaurants: SHORTLIST.map((r) => ({ ...r })) } });
  }
  return entries;
}

const ITALIAN_ES = [
  { originalName: "Pizza Margherita", translatedName: "Margherita pizza", price: 11.5, priceStatus: "verified", vegetarian: "confirmed_vegetarian" },
  { originalName: "Berenjenas a la parmigiana", translatedName: "Aubergine parmigiana", price: 12.9, priceStatus: "verified", vegetarian: "likely_vegetarian" },
  { originalName: "Gnocchi al pesto", translatedName: "Gnocchi with pesto", price: 13.5, priceStatus: "verified", vegetarian: "likely_vegetarian" },
  { originalName: "Ensalada de burrata", translatedName: "Burrata salad", price: 14, priceStatus: "verified", vegetarian: "confirmed_vegetarian" },
];

const IMAGE_MENU = [
  { originalName: "Pa amb tomàquet", translatedName: "Bread with tomato", price: 4.5, priceStatus: "ocr_agreed", vegetarian: "likely_vegetarian" },
  { originalName: "Escalivada amb formatge de cabra", translatedName: "Roasted vegetables with goat cheese", priceStatus: "disputed", vegetarian: "likely_vegetarian" },
  { originalName: "Truita de patates", translatedName: "Potato omelette", price: 7.2, priceStatus: "ocr_agreed", vegetarian: "likely_vegetarian" },
  { originalName: "Amanida de tomàquet i mozzarella (V)", translatedName: "Tomato and mozzarella salad", price: 10.7, priceStatus: "ocr_agreed", vegetarian: "confirmed_vegetarian" },
];

const PARTIAL_MENU = [
  { originalName: "Pasta fresca al pomodoro", translatedName: "Fresh tomato pasta", priceStatus: "absent", vegetarian: "likely_vegetarian" },
  { originalName: "Focaccia con verduras", translatedName: "Focaccia with vegetables", priceStatus: "absent", vegetarian: "unknown" },
];

function step(id: string, s: string, status: string, detail?: string) {
  return { type: "restaurant.step" as const, id, step: s, status, ...(detail ? { detail } : {}) };
}

function simulatedResearch(startAt: number): TimelineEntry[] {
  const [circolo, sicily, viento, anas, patsa] = SHORTLIST.map((r) => r.id);
  const t = (n: number) => startAt + n;
  return [
    { at: t(0), event: { type: "reviews.terms", terms: ["vegetarian", "crowded", "queue", "noise"] } },

    { at: t(100), event: step(circolo, "details", "started") },
    { at: t(500), event: step(circolo, "details", "done") },
    { at: t(600), event: step(circolo, "menu", "started", "Checking their website") },
    { at: t(1400), event: { type: "menu.stage", id: circolo, stage: "site", found: true, candidates: 3, sourceTier: "official_site", documentKind: "food_menu", mediaType: "pdf" } },
    { at: t(2000), event: { type: "menu.read", id: circolo, format: "pdf_text", languages: ["es", "en"], usedVision: false } },
    { at: t(2100), event: step(circolo, "translate", "started") },
    { at: t(2800), event: step(circolo, "translate", "done") },
    { at: t(2900), event: step(circolo, "diet", "started") },
    { at: t(3600), event: { type: "menu.items", id: circolo, items: ITALIAN_ES } },
    { at: t(3700), event: step(circolo, "diet", "done") },
    { at: t(3800), event: { type: "menu.resolved", id: circolo, status: "found", documentCount: 2 } },
    { at: t(3850), event: { type: "menu.extracted", id: circolo, status: "extracted", documentCount: 2, skippedCount: 0, dishCount: 4 } },
    { at: t(3900), event: step(circolo, "menu", "done") },
    { at: t(4000), event: step(circolo, "reviews", "started", "Looking for crowd and noise comments") },
    { at: t(5200), event: { type: "reviews.read", id: circolo, positive: 4, negative: 2, relevant: 3 } },
    { at: t(5300), event: step(circolo, "reviews", "done") },

    { at: t(700), event: step(sicily, "details", "started") },
    { at: t(1100), event: step(sicily, "details", "done") },
    { at: t(1200), event: step(sicily, "menu", "started", "Searching in Spanish and Catalan") },
    { at: t(2200), event: { type: "menu.stage", id: sicily, stage: "site", found: false, candidates: 0 } },
    { at: t(3000), event: { type: "menu.stage", id: sicily, stage: "search", found: true, candidates: 4 } },
    { at: t(3800), event: { type: "tool", id: sicily, name: "vision", label: "Reading an image menu" } },
    { at: t(4000), event: { type: "menu.read", id: sicily, format: "image", languages: ["ca", "es"], usedVision: true } },
    { at: t(4100), event: step(sicily, "translate", "started") },
    { at: t(4900), event: step(sicily, "translate", "done") },
    { at: t(5000), event: step(sicily, "diet", "started") },
    { at: t(5600), event: { type: "menu.items", id: sicily, items: IMAGE_MENU } },
    { at: t(5700), event: step(sicily, "diet", "done") },
    { at: t(5800), event: { type: "menu.resolved", id: sicily, status: "found", documentCount: 1 } },
    { at: t(5850), event: { type: "menu.extracted", id: sicily, status: "extracted", documentCount: 1, skippedCount: 0, dishCount: 4 } },
    { at: t(5900), event: step(sicily, "menu", "warning", "Photo menu: some prices unclear") },
    { at: t(6000), event: step(sicily, "reviews", "started") },
    { at: t(7000), event: { type: "reviews.read", id: sicily, positive: 5, negative: 2, relevant: 2 } },
    { at: t(7100), event: step(sicily, "reviews", "done") },

    { at: t(1300), event: step(viento, "details", "started") },
    { at: t(1700), event: step(viento, "details", "done") },
    { at: t(1800), event: step(viento, "menu", "started", "Checking their website") },
    { at: t(2800), event: { type: "menu.stage", id: viento, stage: "site", found: true, candidates: 1 } },
    { at: t(3600), event: { type: "menu.resolved", id: viento, status: "found_but_unreadable", documentCount: 0, officialMenuUrl: "https://www.viento.example/", reason: "flipbook_viewer" } },
    { at: t(3700), event: step(viento, "menu", "warning", "Menu is in a viewer we can't read") },
    { at: t(3800), event: step(viento, "reviews", "started") },
    { at: t(5000), event: { type: "reviews.read", id: viento, positive: 3, negative: 1, relevant: 2 } },
    { at: t(5100), event: step(viento, "reviews", "done") },

    { at: t(1900), event: step(anas, "details", "started") },
    { at: t(2300), event: step(anas, "details", "done") },
    { at: t(2400), event: step(anas, "menu", "started", "No website listed. Searching the web") },
    { at: t(3400), event: { type: "menu.stage", id: anas, stage: "site", found: false, candidates: 0 } },
    { at: t(4300), event: { type: "menu.stage", id: anas, stage: "search", found: false, candidates: 3 } },
    { at: t(5000), event: { type: "menu.stage", id: anas, stage: "third_party", found: false, candidates: 1 } },
    { at: t(5400), event: { type: "menu.resolved", id: anas, status: "unavailable", documentCount: 0, reason: "no_website" } },
    { at: t(5500), event: step(anas, "menu", "warning", "No menu found online") },
    { at: t(5600), event: step(anas, "reviews", "started") },
    { at: t(6700), event: { type: "reviews.read", id: anas, positive: 4, negative: 1, relevant: 1 } },
    { at: t(6800), event: step(anas, "reviews", "done") },

    { at: t(2500), event: step(patsa, "details", "started") },
    { at: t(2900), event: step(patsa, "details", "done") },
    { at: t(3000), event: step(patsa, "menu", "started") },
    { at: t(4000), event: { type: "menu.stage", id: patsa, stage: "site", found: true, candidates: 2 } },
    { at: t(4800), event: { type: "menu.read", id: patsa, format: "html", languages: ["es"], usedVision: false } },
    { at: t(4900), event: step(patsa, "translate", "started") },
    { at: t(5500), event: step(patsa, "translate", "done") },
    { at: t(5600), event: step(patsa, "diet", "started") },
    { at: t(6100), event: { type: "menu.items", id: patsa, items: PARTIAL_MENU } },
    { at: t(6200), event: step(patsa, "diet", "done") },
    { at: t(6300), event: { type: "menu.resolved", id: patsa, status: "partial", documentCount: 1 } },
    { at: t(6350), event: { type: "menu.extracted", id: patsa, status: "partial", documentCount: 1, skippedCount: 1, dishCount: 2, reason: "one document could not be read" } },
    { at: t(6400), event: step(patsa, "menu", "warning", "Menu has no prices") },
    { at: t(6500), event: step(patsa, "reviews", "started") },
    { at: t(7300), event: step(patsa, "reviews", "failed", "Review sources unavailable") },

    { at: t(8200), event: { type: "rank.done" } },
    { at: t(9000), event: { type: "explain.done" } },
  ];
}

export const SCENARIOS: Record<ScenarioId, ReplayScenario> = {
  recorded: {
    id: "recorded",
    label: "Recorded run",
    description: "A real Barcelona run (Places, menus and Gemini readings recorded 2026-10-08), ranked by the real engine.",
    mockedStages: false,
    withResultsPreview: false,
    steps: buildTimeline("recorded-barcelona", recordedTimeline()),
  },
  "recorded-no-exact": {
    id: "recorded-no-exact",
    label: "No exact match",
    description: "The same recorded run with a EUR 5 budget, so no restaurant fully matches.",
    mockedStages: false,
    withResultsPreview: false,
    steps: buildTimeline("recorded-barcelona-5", recordedTimeline({ budgetMax: 5 })),
  },
  "full-demo": {
    id: "full-demo",
    label: "Full demo",
    description: "Real Phase 2 events, then simulated menu and review research.",
    mockedStages: true,
    withResultsPreview: true,
    steps: buildTimeline("demo-full", [...discovery(29, true), ...simulatedResearch(5600)]),
  },
  phase2: {
    id: "phase2",
    label: "Discovery only",
    description: "Exactly what the backend emits today: discovery and shortlist.",
    mockedStages: false,
    withResultsPreview: false,
    steps: buildTimeline("demo-phase2", discovery(29, true)),
  },
  "no-results": {
    id: "no-results",
    label: "No restaurants",
    description: "Places returned nothing.",
    mockedStages: false,
    withResultsPreview: false,
    steps: buildTimeline("demo-empty", discovery(0, false)),
  },
  "places-down": {
    id: "places-down",
    label: "Places down",
    description: "Google Places failed.",
    mockedStages: false,
    withResultsPreview: false,
    steps: buildTimeline("demo-down", [
      { at: 0, event: { type: "run.started" } },
      { at: 700, event: { type: "understood", request: REQUEST } },
      { at: 1100, event: { type: "discover.started", city: "Barcelona" } },
      { at: 1300, event: { type: "tool", name: "places", label: 'Places text search: "italian restaurants in Barcelona"' } },
      { at: 2400, event: { type: "error", code: "places_server", message: "Places API returned HTTP 503", recoverable: true } },
    ]),
  },
  timeout: {
    id: "timeout",
    label: "Timeout",
    description: "The run hit its deadline with partial research.",
    mockedStages: true,
    withResultsPreview: false,
    steps: buildTimeline("demo-timeout", [
      ...discovery(29, true),
      ...simulatedResearch(5600).filter((e) => e.at < 5600 + 4200),
      { at: 5600 + 4300, event: { type: "error", code: "deadline", message: "Run deadline reached", recoverable: true } },
    ]),
  },
};

export const SCENARIO_LIST: ReplayScenario[] = Object.values(SCENARIOS);

export function getScenario(id: string | undefined): ReplayScenario {
  return (id && (SCENARIOS as Record<string, ReplayScenario>)[id]) || SCENARIOS.recorded;
}
