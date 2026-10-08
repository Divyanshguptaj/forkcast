import { z } from "zod";
import { httpUrl, SourceTier } from "./common";
import { MenuStage } from "./menu";

export const MenuMediaType = z.enum(["html", "pdf", "image", "viewer", "external_host", "unknown"]);

export const ResolverDocumentKind = z.enum([
  "food_menu",
  "set_menu_or_groups",
  "dessert_menu",
  "drinks_or_wine",
  "not_a_menu",
  "unknown",
]);

export const Readability = z.enum(["readable", "viewer", "js_only", "blocked", "unsupported_format", "fetch_failed", "not_probed"]);

export const ResolverUnreadableReason = z.enum(["flipbook_viewer", "blocked", "js_only", "unsupported_format", "fetch_failed"]);
export const ResolverUnavailableReason = z.enum(["no_website", "no_menu_found", "identity_mismatch"]);
export const ResolverFailureReason = z.enum(["aborted", "internal_error"]);

export const DiscoveryVia = z.enum([
  "places_website",
  "site_link",
  "site_iframe",
  "site_embedded",
  "site_image",
  "sitemap",
  "search",
  "search_assets",
  "search_third_party",
]);

export const CandidateSummarySchema = z.object({
  id: z.string().min(1),
  url: httpUrl,
  normalizedUrl: z.string().min(1),
  tier: SourceTier,
  mediaType: MenuMediaType,
  documentKind: ResolverDocumentKind,
  readability: Readability,
  menuLikelihood: z.number().min(0).max(1),
  identityConfidence: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  discoveredVia: DiscoveryVia,
  discoveredFrom: httpUrl.optional(),
  anchorText: z.string().max(120).optional(),
  signals: z.array(z.string()).default([]),
  selected: z.boolean(),
  rejectedReason: z.string().max(160).optional(),
});

export const StageAttemptSchema = z.object({
  stage: MenuStage,
  found: z.boolean(),
  candidates: z.number().int().min(0),
  directFetches: z.number().int().min(0),
  tavilySearches: z.number().int().min(0),
  tavilyExtracts: z.number().int().min(0),
  queries: z.array(z.string()).default([]),
  note: z.string().max(200).optional(),
});

export const ResolverUsageSchema = z.object({
  directFetches: z.number().int().min(0),
  tavilySearches: z.number().int().min(0),
  tavilyExtracts: z.number().int().min(0),
  tavilyCredits: z.number().min(0),
  geminiCalls: z.number().int().min(0),
  bytesFetched: z.number().int().min(0),
});

const base = {
  restaurantId: z.string().min(1),
  restaurantName: z.string().min(1),
  candidates: z.array(CandidateSummarySchema),
  stages: z.array(StageAttemptSchema),
  warnings: z.array(z.string()).default([]),
  usage: ResolverUsageSchema,
  httpsUpgrade: z
    .object({ attempted: z.boolean(), succeeded: z.boolean(), url: httpUrl.optional() })
    .optional(),
  durationMs: z.number().min(0),
};

export const MenuResolutionSchema = z.discriminatedUnion("status", [
  z.object({
    ...base,
    status: z.literal("resolved"),
    selected: z.array(CandidateSummarySchema).min(1),
    officialMenuUrl: httpUrl.optional(),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    ...base,
    status: z.literal("found_but_unreadable"),
    selected: z.array(CandidateSummarySchema).max(0),
    officialMenuUrl: httpUrl,
    unreadableReason: ResolverUnreadableReason,
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    ...base,
    status: z.literal("unavailable"),
    selected: z.array(CandidateSummarySchema).max(0),
    unavailableReason: ResolverUnavailableReason,
  }),
  z.object({
    ...base,
    status: z.literal("failed"),
    selected: z.array(CandidateSummarySchema).max(0),
    failureReason: ResolverFailureReason,
    message: z.string().max(300),
  }),
]);

export type MenuMediaTypeValue = z.infer<typeof MenuMediaType>;
export type ResolverDocumentKindValue = z.infer<typeof ResolverDocumentKind>;
export type ReadabilityValue = z.infer<typeof Readability>;
export type ResolverUnreadableReasonValue = z.infer<typeof ResolverUnreadableReason>;
export type DiscoveryViaValue = z.infer<typeof DiscoveryVia>;
export type CandidateSummary = z.infer<typeof CandidateSummarySchema>;
export type StageAttempt = z.infer<typeof StageAttemptSchema>;
export type ResolverUsage = z.infer<typeof ResolverUsageSchema>;
export type MenuResolution = z.infer<typeof MenuResolutionSchema>;
