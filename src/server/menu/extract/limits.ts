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
  llmConcurrency: 6,
  fetchConcurrency: 4,
  llmTimeoutMs: 60_000,
  maxDishesPerRestaurant: 150,
};
