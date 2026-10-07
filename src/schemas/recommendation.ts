import { z } from "zod";
import { httpUrl, SourceSchema } from "./common";
import { MenuItemSchema, MenuResultSchema } from "./menu";
import { RestaurantDetailsSchema } from "./restaurant";
import { ReviewInsightSchema } from "./reviews";
import { UserRequestSchema } from "./request";

const factor = z.number().min(0).max(100).nullable();

export const ScoreBreakdownSchema = z.object({
  dietCompatibility: factor,
  relevantReviews: factor,
  budgetMatch: factor,
  rating: factor,
  menuConfidence: factor,
  distance: factor,
  mealCuisineFit: factor,
  softPreferences: factor,
  total: z.number().min(0).max(100),
});

export const RecommendationLinkSchema = z.object({
  label: z.string().min(1).max(60),
  url: httpUrl,
  kind: z.enum(["website", "menu", "maps", "review"]),
});

export const ExplanationPointSchema = z.object({
  text: z.string().min(1).max(300),
  factRefs: z.array(z.string()).min(1),
});

export const RecommendationSchema = z.object({
  rank: z.number().int().min(1),
  restaurant: RestaurantDetailsSchema,
  matchScore: z.number().min(0).max(100),
  scoreBreakdown: ScoreBreakdownSchema,
  why: z.array(ExplanationPointSchema),
  aheadOfNext: z.array(z.string().max(200)).default([]),
  vegetarianItems: z.array(MenuItemSchema),
  priceSummary: z
    .object({
      min: z.number(),
      max: z.number(),
      currency: z.literal("EUR"),
      basis: z.enum(["menu_items", "price_level"]),
    })
    .optional(),
  menu: MenuResultSchema,
  reviews: ReviewInsightSchema,
  caveats: z.array(z.string().max(200)).default([]),
  allergyWarning: z.string().max(200).optional(),
  links: z.array(RecommendationLinkSchema),
  sourceIds: z.array(z.string()),
});

export const ExcludedRestaurantSchema = z.object({
  name: z.string(),
  placeId: z.string(),
  reason: z.string().max(200),
});

export const RunStatsSchema = z.object({
  candidates: z.number().int().min(0),
  shortlisted: z.number().int().min(0),
  geminiCalls: z.number().int().min(0),
  tavilyCredits: z.number().min(0),
  durationMs: z.number().min(0),
});

export const RecommendationResponseSchema = z.object({
  query: UserRequestSchema,
  recommendations: z.array(RecommendationSchema),
  excluded: z.array(ExcludedRestaurantSchema).default([]),
  sources: z.array(SourceSchema),
  disclaimers: z.array(z.string()).default([]),
  stats: RunStatsSchema,
});

export type ScoreBreakdown = z.infer<typeof ScoreBreakdownSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type RecommendationResponse = z.infer<typeof RecommendationResponseSchema>;
