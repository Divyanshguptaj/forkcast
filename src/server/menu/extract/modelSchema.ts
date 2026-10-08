import { z } from "zod";

function lenientArray<T extends z.ZodType>(item: T, max: number) {
  return z
    .array(z.unknown())
    .default([])
    .transform((items) => {
      const out: Array<z.infer<T>> = [];
      for (const raw of items) {
        const parsed = item.safeParse(raw);
        if (parsed.success) out.push(parsed.data);
        if (out.length >= max) break;
      }
      return out;
    });
}

const text = (max: number) => z.string().max(max).nullish().transform((v) => (v == null || v.trim() === "" ? undefined : v.trim()));

const ModelVerdict = z.object({
  status: z.enum(["confirmed", "possible", "not_suitable", "unknown"]),
  basis: z.enum(["menu_label", "ingredients", "name_only", "unknown"]),
  evidence: z.string().max(400).nullish().transform((v) => v ?? ""),
});

export const ModelDishSchema = z.object({
  originalName: z.string().min(1).max(200),
  translatedName: text(200),
  originalDescription: text(600),
  translatedDescription: text(600),
  originalLanguage: z.enum(["ca", "es", "en", "other"]).catch("other"),
  section: text(120),
  setMenuId: text(80),
  priceRaw: text(60),
  evidence: text(300),
  page: z.number().int().min(1).max(500).nullish().transform((v) => v ?? undefined),
  vegetarian: ModelVerdict,
  vegan: ModelVerdict,
});

export const ModelSetMenuSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(120),
  description: text(400),
  priceRaw: text(60),
});

export const ModelDocumentSchema = z.object({
  documentId: z.string().min(1).max(160),
  verdict: z.enum(["food_menu", "set_menu", "dessert_menu", "drinks_only", "legal_or_other", "wrong_restaurant", "unreadable"]),
  reason: text(300),
  languages: z.array(z.enum(["ca", "es", "en", "other"]).catch("other")).default([]).transform((l) => l.slice(0, 4)),
  omittedNonMatchingCount: z.number().int().min(0).max(1000).catch(0),
  setMenus: lenientArray(ModelSetMenuSchema, 12),
  dishes: lenientArray(ModelDishSchema, 60),
});

export const ModelExtractionSchema = z.object({ documents: lenientArray(ModelDocumentSchema, 6) });

export const PriceCheckSchema = z.object({
  lines: z.array(z.object({ dish: z.string().max(200), price: z.string().max(40).nullish().transform((v) => v ?? undefined) })).max(120),
});

export type ModelDish = z.infer<typeof ModelDishSchema>;
export type ModelDocument = z.infer<typeof ModelDocumentSchema>;
export type ModelExtraction = z.infer<typeof ModelExtractionSchema>;

const str = (nullable = true) => ({ type: "STRING", nullable });
const verdictSchema = (withEvidence: boolean) => ({
  type: "OBJECT",
  properties: {
    status: { type: "STRING", enum: ["confirmed", "possible", "not_suitable", "unknown"] },
    basis: { type: "STRING", enum: ["menu_label", "ingredients", "name_only", "unknown"] },
    ...(withEvidence ? { evidence: str() } : {}),
  },
  required: ["status", "basis"],
});

export const EXTRACTION_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    documents: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          documentId: str(false),
          verdict: { type: "STRING", enum: ["food_menu", "set_menu", "dessert_menu", "drinks_only", "legal_or_other", "wrong_restaurant", "unreadable"] },
          reason: str(),
          languages: { type: "ARRAY", items: { type: "STRING", enum: ["ca", "es", "en", "other"] } },
          omittedNonMatchingCount: { type: "INTEGER" },
          setMenus: {
            type: "ARRAY",
            items: { type: "OBJECT", properties: { id: str(false), name: str(false), description: str(), priceRaw: str() }, required: ["id", "name"] },
          },
          dishes: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                originalName: str(false),
                translatedName: str(),
                originalDescription: str(),
                originalLanguage: { type: "STRING", enum: ["ca", "es", "en", "other"] },
                section: str(),
                setMenuId: str(),
                priceRaw: str(),
                page: { type: "INTEGER", nullable: true },
                vegetarian: verdictSchema(true),
                vegan: verdictSchema(false),
              },
              required: ["originalName", "translatedName", "originalLanguage", "section", "priceRaw", "vegetarian", "vegan"],
            },
          },
        },
        required: ["documentId", "verdict", "omittedNonMatchingCount", "dishes"],
      },
    },
  },
  required: ["documents"],
} as const;

export const PRICE_CHECK_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: { type: "ARRAY", items: { type: "OBJECT", properties: { dish: str(false), price: str() }, required: ["dish"] } },
  },
  required: ["lines"],
} as const;
