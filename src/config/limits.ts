export const FETCH_LIMITS = {
  timeoutMs: 8_000,
  maxRedirects: 3,
  maxHtmlBytes: 5 * 1024 * 1024,
  maxPdfBytes: 15 * 1024 * 1024,
  maxImageBytes: 8 * 1024 * 1024,
  maxPdfPages: 10,
  maxImagesPerMenu: 6,
  allowedPorts: [80, 443],
} as const;

export const RUN_LIMITS = {
  globalDeadlineMs: 90_000,
  perRestaurantMs: 40_000,
  shortlistSize: 5,
  finalRecommendations: 3,
  geminiCallsExpected: 15,
  geminiCallsCeiling: 45,
  tavilyCreditsPerRun: 40,
  geminiConcurrency: 3,
  researchConcurrency: 5,
} as const;

export const REQUEST_LIMITS = {
  maxBodyBytes: 16 * 1024,
  maxTextChars: 1_000,
} as const;

export type FetchLimits = typeof FETCH_LIMITS;
