import type { RecommendationCardShellProps } from "@/components/results/RecommendationCardShell";

/* DEV / DEMO DATA. Every dish, percentage, quote and sentence below is invented for visual development. */

export const RESULT_PREVIEW: RecommendationCardShellProps[] = [
  {
    rank: 1,
    name: "Osteria Alba",
    matchPercent: 92,
    rating: 4.8,
    ratingCount: 3120,
    priceLevel: 2,
    distanceKm: 0.5,
    why: ["Several vegetarian mains on a menu we could read in full", "Menu prices fit your €30 budget", "Diners mention it fills up, but mostly after 8 PM"],
    vegetarianCount: 4,
    dishes: [
      { originalName: "Pizza Margherita", translatedName: "Margherita pizza", price: 11.5, priceStatus: "verified", vegetarian: "confirmed_vegetarian" },
      { originalName: "Gnocchi al pesto", translatedName: "Gnocchi with pesto", price: 13.5, priceStatus: "verified", vegetarian: "likely_vegetarian" },
    ],
    liked: ["Generous vegetarian choice", "Friendly, quick service"],
    thingsToKnow: ["Can get crowded around 8 PM. Reviews suggest arriving earlier."],
    beatsNext: "Clearer vegetarian menu and a better fit for your quiet-evening preference.",
    links: {},
    sources: [
      { label: "Rating and price level: Google Places", kind: "retrieved" },
      { label: "Dishes and prices: official menu", kind: "extracted" },
      { label: "Crowd timing: diner comments", kind: "inferred" },
    ],
    mock: true,
  },
  {
    rank: 2,
    name: "Trattoria Marina",
    matchPercent: 88,
    rating: 4.8,
    ratingCount: 2140,
    priceLevel: 2,
    distanceKm: 1.1,
    why: ["Photo menu lists vegetarian dishes", "Highly rated by thousands of diners"],
    vegetarianCount: 3,
    dishes: [
      { originalName: "Pa amb tomàquet", translatedName: "Bread with tomato", price: 4.5, priceStatus: "ocr_agreed", vegetarian: "likely_vegetarian" },
      { originalName: "Escalivada amb formatge de cabra", translatedName: "Roasted vegetables with goat cheese", priceStatus: "disputed", vegetarian: "likely_vegetarian" },
    ],
    liked: ["Authentic flavours"],
    thingsToKnow: ["The menu was read from a photo, so some prices are hidden."],
    beatsNext: "More dishes we could confirm, though the photo menu lowers our confidence.",
    links: {},
    sources: [
      { label: "Rating: Google Places", kind: "retrieved" },
      { label: "Dishes: photo of the menu", kind: "uncertain" },
    ],
    mock: true,
  },
  {
    rank: 3,
    name: "Pasta Atelier",
    matchPercent: 81,
    rating: 4.7,
    ratingCount: 980,
    priceLevel: 2,
    distanceKm: 1,
    why: ["Fresh pasta with vegetarian options"],
    vegetarianCount: 2,
    dishes: [
      { originalName: "Pasta fresca al pomodoro", translatedName: "Fresh tomato pasta", priceStatus: "absent", vegetarian: "likely_vegetarian" },
    ],
    liked: ["Fresh pasta"],
    thingsToKnow: ["This menu lists no prices.", "We couldn't reach review sources for this place."],
    links: {},
    sources: [{ label: "Rating: Google Places", kind: "retrieved" }],
    mock: true,
  },
];
