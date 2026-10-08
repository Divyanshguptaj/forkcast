/* Estimated list prices in USD. These are assumptions to be checked against current provider pricing, not billed amounts. */
export const PRICE_ASSUMPTIONS = {
  geminiInputPerMillionTokens: 0.3,
  geminiOutputPerMillionTokens: 2.5,
  tavilyPerCredit: 0.008,
  placesTextSearchPerRequest: 0.035,
} as const;

export interface CostEstimate {
  gemini: number;
  tavily: number;
  places: number;
  totalUsd: number;
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;

export function estimateCost(usage: { placesCalls: number; tavilyCredits: number; inputTokens: number; outputTokens: number }): CostEstimate {
  const gemini = (usage.inputTokens * PRICE_ASSUMPTIONS.geminiInputPerMillionTokens + usage.outputTokens * PRICE_ASSUMPTIONS.geminiOutputPerMillionTokens) / 1_000_000;
  const tavily = usage.tavilyCredits * PRICE_ASSUMPTIONS.tavilyPerCredit;
  const places = usage.placesCalls * PRICE_ASSUMPTIONS.placesTextSearchPerRequest;
  return { gemini: round(gemini), tavily: round(tavily), places: round(places), totalUsd: round(gemini + tavily + places) };
}
