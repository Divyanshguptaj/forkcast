import type { CandidateSummary, MenuResolution } from "@/schemas/menuResolution";
import type { LlmProvider, LlmStructuredRequest } from "@/server/providers/types";
import type { ResolverRestaurant } from "@/server/menu/resolver";

export function cand(over: Partial<CandidateSummary> & { url: string; id?: string }): CandidateSummary {
  return {
    id: over.id ?? "r1#c1",
    normalizedUrl: over.url,
    tier: "official_site",
    mediaType: "pdf",
    documentKind: "food_menu",
    readability: "readable",
    menuLikelihood: 0.8,
    identityConfidence: 1,
    confidence: 0.9,
    discoveredVia: "site_link",
    signals: [],
    selected: true,
    ...over,
  };
}

export function resolved(restaurant: ResolverRestaurant, selected: CandidateSummary[]): MenuResolution {
  return {
    status: "resolved",
    restaurantId: restaurant.placeId,
    restaurantName: restaurant.name,
    candidates: selected,
    stages: [],
    warnings: [],
    usage: { directFetches: 0, tavilySearches: 0, tavilyExtracts: 0, tavilyCredits: 0, geminiCalls: 0, bytesFetched: 0 },
    durationMs: 1,
    selected,
    confidence: 0.9,
  };
}

export interface FakeLlm extends LlmProvider {
  calls: Array<{ label: string; parts: LlmStructuredRequest<unknown>["parts"]; system: string; models?: string[] }>;
}

export function fakeLlm(handler: (req: LlmStructuredRequest<unknown>, call: number) => unknown): FakeLlm {
  const llm: FakeLlm = {
    calls: [],
    async generateStructured<T>(req: LlmStructuredRequest<T>) {
      llm.calls.push({ label: req.label, parts: req.parts, system: req.system, models: req.models });
      const raw = handler(req as LlmStructuredRequest<unknown>, llm.calls.length);
      if (raw instanceof Error) throw raw;
      return { data: req.schema.parse(raw), model: "fake", durationMs: 1, inputTokens: 1000, outputTokens: 200 };
    },
  };
  return llm;
}

export const verdict = (status: string, basis = "unknown", evidence = "") => ({ status, basis, evidence });
export const unknownDiet = { vegetarian: verdict("unknown"), vegan: verdict("unknown") };

export function dish(name: string, over: Record<string, unknown> = {}) {
  return { originalName: name, originalLanguage: "es", ...unknownDiet, ...over };
}

export function modelDoc(documentId: string, dishes: unknown[], over: Record<string, unknown> = {}) {
  return { documentId, verdict: "food_menu", languages: ["es"], omittedNonMatchingCount: 0, setMenus: [], dishes, ...over };
}
