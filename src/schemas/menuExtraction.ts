import { z } from "zod";
import { Confidence, httpUrl, SourceTier } from "./common";
import { ItemLanguage, PriceStatus } from "./menu";
import { MenuMediaType, ResolverDocumentKind } from "./menuResolution";

export const DietStatus = z.enum(["confirmed", "possible", "not_suitable", "unknown"]);
export const DietBasis = z.enum(["menu_label", "ingredients", "lexicon", "model_inference", "none"]);

export const DietVerdictSchema = z
  .object({
    status: DietStatus,
    basis: DietBasis,
    evidence: z.string().max(300),
    confidence: Confidence,
  })
  .superRefine((v, ctx) => {
    if (v.status === "confirmed" && (v.basis === "model_inference" || v.basis === "none" || v.evidence.trim().length === 0)) {
      ctx.addIssue({ code: "custom", path: ["status"], message: "confirmed requires a menu label or ingredient evidence" });
    }
  });

export const DishDietSchema = z.object({
  vegetarian: DietVerdictSchema,
  vegan: DietVerdictSchema,
  pescatarian: DietVerdictSchema,
  glutenFree: DietVerdictSchema,
});

export const PriceBasis = z.enum(["text_adjacent", "text_elsewhere", "image_single_read", "image_agreed", "image_conflict"]);

export const DishPriceSchema = z
  .object({
    label: z.string().max(60).optional(),
    amount: z.number().min(0.01).max(1000).optional(),
    alternateAmount: z.number().min(0.01).max(1000).optional(),
    currency: z.string().length(3).default("EUR"),
    raw: z.string().max(40).optional(),
    status: PriceStatus,
    confidence: Confidence.optional(),
    basis: PriceBasis.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.status === "absent" && (p.amount !== undefined || p.alternateAmount !== undefined)) ctx.addIssue({ code: "custom", path: ["amount"], message: "amount must be omitted when status is absent" });
    if (p.status !== "absent" && p.amount === undefined) ctx.addIssue({ code: "custom", path: ["status"], message: "status implies an amount but none is set" });
    if (p.alternateAmount !== undefined && p.status !== "disputed") ctx.addIssue({ code: "custom", path: ["alternateAmount"], message: "alternateAmount is only valid for a disputed price" });
  });

export function isBudgetGradePrice(price: Pick<z.infer<typeof DishPriceSchema>, "status" | "amount">): price is { status: "verified" | "ocr_agreed"; amount: number } {
  return (price.status === "verified" || price.status === "ocr_agreed") && price.amount !== undefined;
}

export const ExtractionMethod = z.enum(["html_text", "pdf_text", "vision"]);

export const DishSourceSchema = z.object({
  documentId: z.string().min(1),
  url: httpUrl,
  tier: SourceTier,
  method: ExtractionMethod,
  page: z.number().int().min(1).optional(),
  evidence: z.string().max(300).optional(),
});

export const DishOffering = z.enum(["a_la_carte", "set_menu", "dessert"]);

export const ExtractedDishSchema = z.object({
  id: z.string().min(1),
  restaurantId: z.string().min(1),
  originalName: z.string().min(1).max(200),
  translatedName: z.string().max(200).optional(),
  originalDescription: z.string().max(600).optional(),
  translatedDescription: z.string().max(600).optional(),
  originalLanguage: ItemLanguage,
  section: z.string().max(120).optional(),
  offering: DishOffering,
  setMenuId: z.string().max(80).optional(),
  prices: z.array(DishPriceSchema).max(6),
  priceConflict: z.boolean(),
  diet: DishDietSchema,
  extractionConfidence: Confidence,
  sources: z.array(DishSourceSchema).min(1),
});

export const SetMenuSchema = z.object({
  id: z.string().min(1),
  documentId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(400).optional(),
  prices: z.array(DishPriceSchema).max(4),
});

export const DocumentStatus = z.enum(["extracted", "partial", "empty", "skipped", "failed"]);

export const ExtractionUsageSchema = z.object({
  geminiRequests: z.number().int().min(0),
  visionRequests: z.number().int().min(0),
  priceCheckRequests: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  bytesFetched: z.number().int().min(0),
});

export const ExtractedDocumentSchema = z.object({
  documentId: z.string().min(1),
  url: httpUrl,
  tier: SourceTier,
  mediaType: MenuMediaType,
  documentKind: ResolverDocumentKind,
  method: ExtractionMethod.optional(),
  status: DocumentStatus,
  reason: z.string().max(200).optional(),
  languages: z.array(ItemLanguage).default([]),
  pageCount: z.number().int().min(1).optional(),
  dishCount: z.number().int().min(0),
  omittedNonMatchingCount: z.number().int().min(0).default(0),
  droppedDishCount: z.number().int().min(0).default(0),
  warnings: z.array(z.string().max(200)).default([]),
});

export const MenuExtractionSchema = z.object({
  restaurantId: z.string().min(1),
  restaurantName: z.string().min(1),
  status: z.enum(["extracted", "partial", "unavailable", "failed"]),
  reason: z.string().max(200).optional(),
  documents: z.array(ExtractedDocumentSchema),
  dishes: z.array(ExtractedDishSchema),
  setMenus: z.array(SetMenuSchema),
  warnings: z.array(z.string().max(200)).default([]),
  usage: ExtractionUsageSchema,
  durationMs: z.number().min(0),
});

export type DietStatusValue = z.infer<typeof DietStatus>;
export type DietBasisValue = z.infer<typeof DietBasis>;
export type DietVerdict = z.infer<typeof DietVerdictSchema>;
export type DishDiet = z.infer<typeof DishDietSchema>;
export type DishPrice = z.infer<typeof DishPriceSchema>;
export type PriceBasisValue = z.infer<typeof PriceBasis>;
export type ExtractionMethodValue = z.infer<typeof ExtractionMethod>;
export type ExtractedDish = z.infer<typeof ExtractedDishSchema>;
export type SetMenu = z.infer<typeof SetMenuSchema>;
export type ExtractedDocument = z.infer<typeof ExtractedDocumentSchema>;
export type ExtractionUsage = z.infer<typeof ExtractionUsageSchema>;
export type MenuExtraction = z.infer<typeof MenuExtractionSchema>;
