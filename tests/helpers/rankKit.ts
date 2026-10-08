import { readFileSync } from "node:fs";
import type { DishPrice, DietVerdict, ExtractedDish, MenuExtraction, SetMenu } from "@/schemas/menuExtraction";
import type { RestaurantDetails } from "@/schemas/restaurant";
import { UserRequestSchema, type UserRequest } from "@/schemas/request";
import type { RecommendCandidate } from "@/server/ranking";

type Status = DietVerdict["status"];

const verdict = (status: Status, basis: DietVerdict["basis"] = status === "confirmed" ? "menu_label" : status === "possible" ? "model_inference" : "none"): DietVerdict => ({
  status,
  basis,
  evidence: status === "confirmed" ? "(V)" : "",
  confidence: status === "confirmed" ? 0.9 : 0.4,
});

export interface DishSpec {
  id?: string;
  name?: string;
  translated?: string;
  description?: string;
  section?: string;
  veg?: Status;
  vegan?: Status;
  pesc?: Status;
  gf?: Status;
  price?: number | null;
  priceStatus?: DishPrice["status"];
  alternate?: number;
  currency?: string;
  offering?: ExtractedDish["offering"];
  setMenuId?: string;
  confidence?: number;
  tier?: ExtractedDish["sources"][number]["tier"];
}

let counter = 0;

export function dish(spec: DishSpec = {}, restaurantId = "r1"): ExtractedDish {
  const n = ++counter;
  const name = spec.name ?? `Plato ${n}`;
  const status = spec.priceStatus ?? (spec.price == null ? "absent" : "verified");
  const price: DishPrice =
    spec.price == null && status === "absent"
      ? { status: "absent", currency: "EUR" }
      : { amount: spec.price ?? 10, currency: spec.currency ?? "EUR", status, ...(spec.alternate ? { alternateAmount: spec.alternate } : {}) };
  return {
    id: spec.id ?? `${restaurantId}#doc~${n}`,
    restaurantId,
    originalName: name,
    ...(spec.translated ? { translatedName: spec.translated } : {}),
    ...(spec.description ? { originalDescription: spec.description } : {}),
    originalLanguage: "es",
    ...(spec.section ? { section: spec.section } : {}),
    offering: spec.offering ?? "a_la_carte",
    ...(spec.setMenuId ? { setMenuId: spec.setMenuId } : {}),
    prices: [price],
    priceConflict: false,
    diet: {
      vegetarian: verdict(spec.veg ?? "unknown"),
      vegan: verdict(spec.vegan ?? "unknown"),
      pescatarian: verdict(spec.pesc ?? (spec.veg === "confirmed" ? "confirmed" : "unknown")),
      glutenFree: verdict(spec.gf ?? "unknown"),
    },
    extractionConfidence: spec.confidence ?? 0.9,
    sources: [{ documentId: `${restaurantId}#doc`, url: `https://${restaurantId}.example/carta.pdf`, tier: spec.tier ?? "official_site", method: "pdf_text" }],
  };
}

export function extraction(restaurantId: string, dishes: ExtractedDish[], over: Partial<MenuExtraction> = {}, setMenus: SetMenu[] = []): MenuExtraction {
  return {
    restaurantId,
    restaurantName: restaurantId,
    status: "extracted",
    documents: [{ documentId: `${restaurantId}#doc`, url: `https://${restaurantId}.example/carta.pdf`, tier: "official_site", mediaType: "pdf", documentKind: "food_menu", method: "pdf_text", status: "extracted", languages: ["es"], dishCount: dishes.length, omittedNonMatchingCount: 0, droppedDishCount: 0, warnings: [] }],
    dishes,
    setMenus,
    warnings: [],
    usage: { geminiRequests: 1, visionRequests: 0, priceCheckRequests: 0, inputTokens: 0, outputTokens: 0, bytesFetched: 0 },
    durationMs: 1,
    ...over,
  };
}

export function restaurant(id: string, over: Partial<RestaurantDetails> = {}): RestaurantDetails {
  return {
    placeId: id,
    name: over.name ?? `Restaurante ${id}`,
    address: `Carrer ${id}, Barcelona`,
    location: { lat: 41.39, lng: 2.17 },
    rating: 4.5,
    ratingCount: 500,
    priceLevel: 2,
    types: ["italian_restaurant", "restaurant", "food"],
    primaryType: "italian_restaurant",
    sourceId: "places",
    websiteUrl: `https://${id}.example/`,
    mapsUrl: `https://maps.google.com/?cid=${id}`,
    sampledReviews: [],
    servesDinner: true,
    servesLunch: true,
    ...over,
  };
}

export function candidate(id: string, extractionValue: MenuExtraction | undefined, over: Partial<RestaurantDetails> = {}, shortlistScore = 0.8): RecommendCandidate {
  return { restaurant: restaurant(id, over), shortlistScore, extraction: extractionValue };
}

export function request(over: Partial<UserRequest> = {}): UserRequest {
  return UserRequestSchema.parse({ city: "Barcelona", meal: "dinner", ...over });
}

export const budget = (max: number) => ({ max, currency: "EUR" as const, perPerson: true as const });

export function loadFixture(name: string): { request: UserRequest; cuisines: string[]; candidates: RecommendCandidate[] } {
  return JSON.parse(readFileSync(`fixtures/phase6/${name}.json`, "utf8"));
}
