export interface ExtractLimits {
  maxDocsPerRestaurant: number;
  maxDocsTotal: number;
  includeSecondaryMenus: boolean;
  maxPdfPages: number;
  maxTextChars: number;
  maxVisionPages: number;
  maxVisionBytes: number;
  maxVisionDocsPerRestaurant: number;
  maxTextDocsPerCall: number;
  maxCharsPerCall: number;
  maxLlmRequests: number;
  chunkChars: number;
  maxChunksPerDoc: number;
  maxOutputTokens: number;
  priceCheckMaxOutputTokens: number;
  maxInputTokensPerRun: number;
  maxDishesPerDocument: number;
  llmConcurrency: number;
  fetchConcurrency: number;
  llmTimeoutMs: number;
  maxDishesPerRestaurant: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxDocsPerRestaurant: 2,
  maxDocsTotal: 6,
  includeSecondaryMenus: false,
  maxPdfPages: 12,
  maxTextChars: 30_000,
  maxVisionPages: 12,
  maxVisionBytes: 12 * 1024 * 1024,
  maxVisionDocsPerRestaurant: 2,
  maxTextDocsPerCall: 1,
  maxCharsPerCall: 45_000,
  maxLlmRequests: 10,
  chunkChars: 16_000,
  maxChunksPerDoc: 2,
  maxOutputTokens: 7_000,
  priceCheckMaxOutputTokens: 2_500,
  maxInputTokensPerRun: 160_000,
  maxDishesPerDocument: 60,
  llmConcurrency: 6,
  fetchConcurrency: 4,
  llmTimeoutMs: 60_000,
  maxDishesPerRestaurant: 150,
};
