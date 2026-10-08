import { z } from "zod";
import { SourceTier } from "./common";
import { RecommendationResponseSchema } from "./recommendation";
import { RecommendationSetSchema } from "./recommendations";
import { MenuFormat, MenuItemPreviewSchema, MenuStage } from "./menu";
import { UserRequestSchema } from "./request";

const base = {
  runId: z.string().min(1),
  seq: z.number().int().min(0),
  ts: z.iso.datetime(),
};

export const RunMetricsSchema = z.object({
  totalMs: z.number().min(0),
  understandAndDiscoverMs: z.number().min(0),
  researchMs: z.number().min(0),
  rankMs: z.number().min(0),
  placesCalls: z.number().int().min(0),
  tavilyCredits: z.number().min(0),
  aiRequests: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheHits: z.number().int().min(0),
  estimatedCostUsd: z.number().min(0),
  partial: z.boolean(),
});

export type RunMetricsPublic = z.infer<typeof RunMetricsSchema>;

export const RestaurantStep = z.enum(["details", "menu", "translate", "diet", "reviews"]);
export const StepStatus = z.enum(["started", "progress", "done", "warning", "failed"]);
export const ToolName = z.enum(["places", "web_search", "web_extract", "fetch", "gemini", "vision"]);

export const AgentEventSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("run.started") }),
  z.object({ ...base, type: z.literal("understood"), request: UserRequestSchema }),
  z.object({ ...base, type: z.literal("discover.started"), city: z.string() }),
  z.object({ ...base, type: z.literal("discover.found"), count: z.number().int().min(0) }),
  z.object({
    ...base,
    type: z.literal("shortlist.done"),
    restaurants: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        rating: z.number().optional(),
        ratingCount: z.number().int().min(0).optional(),
        priceLevel: z.number().int().min(0).max(4).optional(),
        distanceKm: z.number().optional(),
        address: z.string().optional(),
        primaryType: z.string().optional(),
        mapsUrl: z.url().optional(),
      }),
    ),
  }),
  z.object({
    ...base,
    type: z.literal("restaurant.step"),
    id: z.string(),
    step: RestaurantStep,
    status: StepStatus,
    detail: z.string().max(200).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("menu.stage"),
    id: z.string(),
    stage: MenuStage,
    found: z.boolean(),
    candidates: z.number().int().min(0),
    sourceTier: SourceTier.optional(),
    documentKind: z.string().max(40).optional(),
    mediaType: z.string().max(40).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("menu.read"),
    id: z.string(),
    format: MenuFormat,
    languages: z.array(z.string()),
    usedVision: z.boolean(),
    dishCount: z.number().int().min(0).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("menu.extracted"),
    id: z.string(),
    status: z.enum(["extracted", "partial", "unavailable", "failed"]),
    documentCount: z.number().int().min(0),
    skippedCount: z.number().int().min(0),
    dishCount: z.number().int().min(0),
    reason: z.string().max(200).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("menu.items"),
    id: z.string(),
    items: z.array(MenuItemPreviewSchema).max(40),
  }),
  z.object({
    ...base,
    type: z.literal("menu.resolved"),
    id: z.string(),
    status: z.enum(["found", "partial", "found_but_unreadable", "unavailable"]),
    documentCount: z.number().int().min(0),
    officialMenuUrl: z.url().optional(),
    sourceTier: SourceTier.optional(),
    reason: z.string().max(40).optional(),
  }),
  z.object({
    ...base,
    type: z.literal("reviews.terms"),
    id: z.string().optional(),
    terms: z.array(z.string()),
  }),
  z.object({
    ...base,
    type: z.literal("reviews.read"),
    id: z.string(),
    positive: z.number().int().min(0),
    negative: z.number().int().min(0),
    relevant: z.number().int().min(0),
  }),
  z.object({
    ...base,
    type: z.literal("tool"),
    id: z.string().optional(),
    name: ToolName,
    label: z.string().max(160),
  }),
  z.object({ ...base, type: z.literal("rank.done") }),
  z.object({ ...base, type: z.literal("run.metrics"), metrics: RunMetricsSchema }),
  z.object({ ...base, type: z.literal("recommendations.ready"), payload: RecommendationSetSchema }),
  z.object({ ...base, type: z.literal("explain.done") }),
  z.object({ ...base, type: z.literal("result"), payload: RecommendationResponseSchema }),
  z.object({
    ...base,
    type: z.literal("error"),
    code: z.string(),
    message: z.string().max(300),
    recoverable: z.boolean(),
  }),
]);

export type AgentEvent = z.infer<typeof AgentEventSchema>;
export type AgentEventType = AgentEvent["type"];
