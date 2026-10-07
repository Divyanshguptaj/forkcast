import { z } from "zod";
import { httpUrl } from "./common";

export const ReviewKind = z.enum(["platform_review", "web_snippet"]);

export const ReviewSchema = z.object({
  id: z.string().min(1),
  kind: ReviewKind,
  rating: z.number().min(0).max(5).optional(),
  text: z.string().min(1).max(1200),
  language: z.string().max(10).optional(),
  publishedAt: z.string().optional(),
  sourceId: z.string().min(1),
  attribution: z
    .object({
      authorName: z.string().optional(),
      authorUrl: httpUrl.optional(),
      mapsUri: httpUrl.optional(),
    })
    .optional(),
  allowedForLlm: z.boolean(),
});

export const InsightPointSchema = z.object({
  text: z.string().min(1).max(400),
  supportingReviewIds: z.array(z.string().min(1)).min(1),
});

export const EvidenceStrength = z.enum(["none", "weak", "moderate", "strong"]);

export const ReviewInsightSchema = z.object({
  sampleSize: z.number().int().min(0),
  analyzedSampleSize: z.number().int().min(0),
  positiveSummary: z.array(InsightPointSchema).default([]),
  negativeSummary: z.array(InsightPointSchema).default([]),
  contextRelevant: z.array(InsightPointSchema).default([]),
  commonPraise: z.array(z.string()).default([]),
  commonComplaints: z.array(z.string()).default([]),
  mentionedDishes: z.array(z.string()).default([]),
  contextSentiment: z.number().min(-1).max(1).nullable(),
  evidenceStrength: EvidenceStrength,
  placesReviewTextAnalyzed: z.boolean(),
});

export type Review = z.infer<typeof ReviewSchema>;
export type InsightPoint = z.infer<typeof InsightPointSchema>;
export type ReviewInsight = z.infer<typeof ReviewInsightSchema>;
