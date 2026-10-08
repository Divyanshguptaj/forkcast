import { z } from "zod";
import { Confidence, httpUrl, SourceTier } from "./common";
import { PriceStatus } from "./menu";
import { DietBasis, DietStatus, DishOffering, ExtractionMethod } from "./menuExtraction";

export const ConstraintKind = z.enum(["diet", "allergy", "dislike", "budget", "cuisine", "meal", "must_have", "preference"]);
export const ConstraintStrength = z.enum(["hard", "soft"]);
export const Verdict = z.enum(["met", "unmet", "uncertain"]);

export const ConstraintSchema = z.object({
  id: z.string().min(1),
  kind: ConstraintKind,
  strength: ConstraintStrength,
  label: z.string().min(1).max(80),
  value: z.string().max(80),
  blocking: z.boolean(),
});

export const ConstraintOutcomeSchema = z.object({
  constraintId: z.string().min(1),
  kind: ConstraintKind,
  strength: ConstraintStrength,
  label: z.string().max(80),
  verdict: Verdict,
  note: z.string().max(300),
  dishCount: z.number().int().min(0).optional(),
});

export const DishFit = z.enum(["exact", "possible", "near_miss"]);
export const DishRole = z.enum(["main", "starter", "side", "dessert", "set_menu", "other"]);

export const MatchedDishPriceSchema = z.object({
  amount: z.number().min(0.01).max(1000).optional(),
  currency: z.string().length(3),
  label: z.string().max(60).optional(),
  status: PriceStatus,
  confidence: Confidence.optional(),
  alternateAmount: z.number().min(0.01).max(1000).optional(),
  setMenuName: z.string().max(120).optional(),
  groupMenu: z.object({ name: z.string().max(120), amount: z.number().min(0.01).max(1000).optional() }).optional(),
});

export const MatchedDishSchema = z.object({
  dishId: z.string().min(1),
  name: z.string().min(1).max(200),
  translatedName: z.string().max(200).optional(),
  section: z.string().max(120).optional(),
  offering: DishOffering,
  role: DishRole,
  fit: DishFit,
  price: MatchedDishPriceSchema,
  diet: z.array(
    z.object({
      diet: z.string().max(30),
      status: DietStatus,
      basis: DietBasis,
      evidence: z.string().max(300),
    }),
  ),
  outcomes: z.array(z.object({ constraintId: z.string(), kind: ConstraintKind, verdict: Verdict, note: z.string().max(200) })),
  confidence: Confidence,
  source: z.object({
    documentId: z.string().min(1),
    url: httpUrl,
    tier: SourceTier,
    method: ExtractionMethod,
    page: z.number().int().min(1).optional(),
    evidence: z.string().max(300).optional(),
  }),
});

export const ScoreComponentSchema = z.object({
  key: z.enum(["dishFit", "dietStrength", "budgetFit", "cuisineFit", "mealFit", "evidenceQuality", "discovery"]),
  label: z.string().max(60),
  value: z.number().min(0).max(1).nullable(),
  weight: z.number().min(0).max(1),
  contribution: z.number().min(0).max(100),
  note: z.string().max(300),
});

export const RecommendationTier = z.enum(["exact", "partial", "uncertain", "near_miss"]);

export const ReasonSchema = z.object({
  text: z.string().min(1).max(300),
  dishIds: z.array(z.string()).default([]),
  documentIds: z.array(z.string()).default([]),
});

export const RecommendationLinkSchema = z.object({
  label: z.string().min(1).max(60),
  url: httpUrl,
  kind: z.enum(["website", "menu", "maps"]),
});

export const MenuSourceSchema = z.object({
  documentId: z.string().min(1),
  url: httpUrl,
  tier: SourceTier,
  method: ExtractionMethod.optional(),
  status: z.string().max(20),
});

export const MatchedRestaurantSchema = z.object({
  rank: z.number().int().min(1),
  restaurantId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().min(0).optional(),
  priceLevel: z.number().int().min(0).max(4).optional(),
  distanceKm: z.number().min(0).optional(),
  tier: RecommendationTier,
  categoryLabel: z.string().max(40),
  score: z.number().min(0).max(100),
  components: z.array(ScoreComponentSchema),
  outcomes: z.array(ConstraintOutcomeSchema),
  dishes: z.array(MatchedDishSchema),
  exactDishCount: z.number().int().min(0),
  possibleDishCount: z.number().int().min(0),
  menuDishCount: z.number().int().min(0),
  reasons: z.array(ReasonSchema),
  unmet: z.array(z.string().max(300)),
  uncertainties: z.array(z.string().max(300)),
  allergyWarning: z.string().max(300).optional(),
  menuStatus: z.enum(["extracted", "partial"]),
  menuSources: z.array(MenuSourceSchema),
  links: z.array(RecommendationLinkSchema),
});

export const ExclusionCode = z.enum(["no_menu", "menu_unreadable", "no_dietary_evidence", "diet_unmet", "budget_unmet", "dislike_unmet", "no_matching_dish", "below_cutoff"]);

export const ExcludedRestaurantSchema = z.object({
  restaurantId: z.string().min(1),
  name: z.string().min(1),
  code: ExclusionCode,
  reason: z.string().max(300),
});

export const RecommendationSetSchema = z.object({
  constraints: z.array(ConstraintSchema),
  outcome: z.enum(["exact_matches", "alternatives_only", "none"]),
  recommendations: z.array(MatchedRestaurantSchema),
  excluded: z.array(ExcludedRestaurantSchema),
  notices: z.array(z.string().max(300)),
  stats: z.object({
    considered: z.number().int().min(0),
    withMenu: z.number().int().min(0),
    exact: z.number().int().min(0),
    alternatives: z.number().int().min(0),
    excluded: z.number().int().min(0),
  }),
});

export type Constraint = z.infer<typeof ConstraintSchema>;
export type ConstraintKindValue = z.infer<typeof ConstraintKind>;
export type ConstraintOutcome = z.infer<typeof ConstraintOutcomeSchema>;
export type VerdictValue = z.infer<typeof Verdict>;
export type DishRoleValue = z.infer<typeof DishRole>;
export type MatchedDish = z.infer<typeof MatchedDishSchema>;
export type ScoreComponent = z.infer<typeof ScoreComponentSchema>;
export type RecommendationTierValue = z.infer<typeof RecommendationTier>;
export type MatchedRestaurant = z.infer<typeof MatchedRestaurantSchema>;
export type ExcludedRestaurant = z.infer<typeof ExcludedRestaurantSchema>;
export type ExclusionCodeValue = z.infer<typeof ExclusionCode>;
export type RecommendationSet = z.infer<typeof RecommendationSetSchema>;
