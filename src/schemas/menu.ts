import { z } from "zod";
import { Confidence, httpUrl, SourceTier } from "./common";

export const DocumentKind = z.enum([
  "food_menu",
  "drinks_or_wine",
  "set_menu_or_groups",
  "not_a_menu",
]);

export const MenuFormat = z.enum([
  "html",
  "pdf_text",
  "pdf_scanned",
  "image",
  "third_party_html",
]);

export const ReadQuality = z.enum(["good", "partial", "poor"]);

export const PriceStatus = z.enum([
  "verified",
  "ocr_agreed",
  "unverified",
  "disputed",
  "absent",
]);

export const VegetarianStatus = z.enum([
  "confirmed_vegetarian",
  "likely_vegetarian",
  "unknown",
  "contains_meat_or_fish",
]);

export const VeganStatus = z.enum([
  "confirmed_vegan",
  "likely_vegan",
  "unknown",
  "not_vegan",
]);

export const ItemLanguage = z.enum(["ca", "es", "en", "other"]);

export const ItemDietSchema = z
  .object({
    vegetarian: VegetarianStatus,
    vegan: VeganStatus,
    evidence: z.string().max(300),
    confidence: Confidence,
  })
  .superRefine((d, ctx) => {
    const confirmed = d.vegetarian === "confirmed_vegetarian" || d.vegan === "confirmed_vegan";
    if (confirmed && d.evidence.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence"],
        message: "confirmed diet status requires evidence",
      });
    }
  });

export const ItemEvidenceSchema = z.object({
  page: z.number().int().min(1).optional(),
  lineText: z.string().max(300).optional(),
  imageUrl: httpUrl.optional(),
});

export const MenuItemSchema = z
  .object({
    originalName: z.string().min(1).max(200),
    translatedName: z.string().min(1).max(200),
    originalDescription: z.string().max(600).optional(),
    translatedDescription: z.string().max(600).optional(),
    originalLanguage: ItemLanguage,
    section: z.string().max(120).optional(),
    priceRaw: z.string().max(40).optional(),
    price: z.number().min(0.01).max(1000).optional(),
    currency: z.literal("EUR").default("EUR"),
    priceStatus: PriceStatus,
    diet: ItemDietSchema,
    extractionConfidence: Confidence,
    evidence: ItemEvidenceSchema.optional(),
    documentId: z.string().min(1),
    sourceUrl: httpUrl,
  })
  .superRefine((item, ctx) => {
    const noNumber = item.priceStatus === "absent";
    if (noNumber && item.price !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["price"],
        message: `price must be omitted when priceStatus is ${item.priceStatus}`,
      });
    }
    if (!noNumber && item.price === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["priceStatus"],
        message: "priceStatus implies a price but none is set",
      });
    }
  });

export const MenuDocumentSchema = z.object({
  id: z.string().min(1),
  url: httpUrl,
  tier: SourceTier,
  format: MenuFormat,
  documentKind: DocumentKind,
  languages: z.array(ItemLanguage).default([]),
  readQuality: ReadQuality,
  confidence: Confidence,
  hasPrices: z.boolean(),
  pageCount: z.number().int().min(1).optional(),
  imageCount: z.number().int().min(1).optional(),
  omittedMeatFishCount: z.number().int().min(0).optional(),
  lastUpdatedHint: z.string().max(80).optional(),
  sourceId: z.string().min(1),
  items: z.array(MenuItemSchema),
});

export const UnreadableReason = z.enum([
  "flipbook_viewer",
  "blocked",
  "js_only",
  "image_unreadable",
  "fetch_failed",
  "parse_failed",
  "too_large",
]);

export const UnavailableReason = z.enum([
  "no_website",
  "no_menu_found",
  "identity_mismatch",
]);

export const MenuStage = z.enum(["site", "search", "assets", "third_party"]);

export const StageTriedSchema = z.object({
  stage: MenuStage,
  found: z.boolean(),
  candidates: z.number().int().min(0),
  note: z.string().max(200).optional(),
});

export const MenuCandidateSchema = z.object({
  id: z.string().min(1),
  url: httpUrl,
  discoveredVia: z.enum([
    "places_website",
    "site_link",
    "site_asset",
    "tavily_search",
    "tavily_extract",
    "third_party_search",
  ]),
  tier: SourceTier,
  anchorText: z.string().max(120).optional(),
  contentTypeHint: z.enum(["html", "pdf", "image", "unknown"]).default("unknown"),
  identity: z.object({
    domainMatchesOfficial: z.boolean(),
    nameMatch: z.boolean(),
    cityMatch: z.boolean(),
  }),
  menuLikelihood: z.number().min(0).max(1).optional(),
});

const resultBase = {
  stagesTried: z.array(StageTriedSchema).default([]),
  confidence: Confidence,
  hasPrices: z.boolean(),
};

export const MenuResultSchema = z.discriminatedUnion("status", [
  z.object({
    ...resultBase,
    status: z.literal("found"),
    documents: z.array(MenuDocumentSchema).min(1),
    officialMenuUrl: httpUrl.optional(),
  }),
  z.object({
    ...resultBase,
    status: z.literal("partial"),
    documents: z.array(MenuDocumentSchema).min(1),
    officialMenuUrl: httpUrl.optional(),
    note: z.string().max(200).optional(),
  }),
  z.object({
    ...resultBase,
    status: z.literal("found_but_unreadable"),
    documents: z.array(MenuDocumentSchema).default([]),
    officialMenuUrl: httpUrl,
    unreadableReason: UnreadableReason,
  }),
  z.object({
    ...resultBase,
    status: z.literal("unavailable"),
    documents: z.array(MenuDocumentSchema).max(0).default([]),
    unavailableReason: UnavailableReason,
  }),
]);

export const MenuItemPreviewSchema = z.object({
  originalName: z.string(),
  translatedName: z.string(),
  price: z.number().optional(),
  priceStatus: PriceStatus,
  vegetarian: VegetarianStatus,
});

export type DocumentKindValue = z.infer<typeof DocumentKind>;
export type MenuFormatValue = z.infer<typeof MenuFormat>;
export type PriceStatusValue = z.infer<typeof PriceStatus>;
export type VegetarianStatusValue = z.infer<typeof VegetarianStatus>;
export type MenuItem = z.infer<typeof MenuItemSchema>;
export type MenuDocument = z.infer<typeof MenuDocumentSchema>;
export type MenuCandidate = z.infer<typeof MenuCandidateSchema>;
export type MenuResult = z.infer<typeof MenuResultSchema>;
export type MenuItemPreview = z.infer<typeof MenuItemPreviewSchema>;
export type UnreadableReasonValue = z.infer<typeof UnreadableReason>;
