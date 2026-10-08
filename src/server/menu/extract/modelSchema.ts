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

const ModelDishObject = z.object({
  originalName: z.string().min(1).max(200),
  translatedName: text(200),
  originalDescription: text(600),
  translatedDescription: text(600),
  originalLanguage: z.enum(["ca", "es", "en", "other"]).catch("other"),
  section: text(120),
  setMenuId: text(80),
  priceRaw: text(60),
  evidence: text(300),
  course: z.enum(["starter", "main", "side", "dessert", "other"]).nullish().catch(undefined).transform((v) => v ?? undefined),
  page: z.number().int().min(1).max(500).nullish().transform((v) => v ?? undefined),
  vegetarian: ModelVerdict,
  vegan: ModelVerdict.optional().transform((v) => v ?? { status: "unknown" as const, basis: "unknown" as const, evidence: "" }),
});

const WIRE_KEYS: Record<string, string> = { n: "originalName", t: "translatedName", d: "originalDescription", l: "originalLanguage", s: "section", m: "setMenuId", p: "priceRaw", c: "course", g: "page", v: "vegetarian", x: "vegan" };
const WIRE_VERDICT: Record<string, string> = { s: "status", b: "basis", e: "evidence" };

function expandKeys(value: unknown, map: Record<string, string>): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) out[map[key] ?? key] = v;
  return out;
}

function expandDish(raw: unknown): unknown {
  const dish = expandKeys(raw, WIRE_KEYS) as Record<string, unknown> | unknown;
  if (typeof dish !== "object" || dish === null) return dish;
  const record = dish as Record<string, unknown>;
  return { ...record, vegetarian: expandKeys(record.vegetarian, WIRE_VERDICT), vegan: expandKeys(record.vegan, WIRE_VERDICT) };
}

export const ModelDishSchema = z.preprocess(expandDish, ModelDishObject);

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
  dishes: lenientArray(ModelDishSchema, 120),
});

export const ModelExtractionSchema = z.object({ documents: lenientArray(ModelDocumentSchema, 6) });

export const PriceCheckSchema = z.object({
  lines: z.array(z.object({ dish: z.string().max(200), price: z.string().max(40).nullish().transform((v) => v ?? undefined) })).max(120),
});

export function mergeModelDocuments(documentId: string, parts: ModelDocument[]): ModelDocument {
  const usable = parts.find((p) => p.verdict !== "unreadable" && p.dishes.length > 0) ?? parts.find((p) => p.verdict !== "unreadable") ?? parts[0];
  const seen = new Set<string>();
  const setMenus = parts.flatMap((p) => p.setMenus).filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  return {
    documentId,
    verdict: usable.verdict,
    reason: usable.reason,
    languages: [...new Set(parts.flatMap((p) => p.languages))].slice(0, 4),
    omittedNonMatchingCount: parts.reduce((n, p) => n + p.omittedNonMatchingCount, 0),
    setMenus,
    dishes: parts.flatMap((p) => p.dishes),
  };
}

export type ModelDish = z.infer<typeof ModelDishSchema>;
export type ModelDocument = z.infer<typeof ModelDocumentSchema>;
export type ModelExtraction = z.infer<typeof ModelExtractionSchema>;

const str = (description?: string, nullable = true) => ({ type: "STRING", nullable, ...(description ? { description } : {}) });
const verdictSchema = (withEvidence: boolean) => ({
  type: "OBJECT",
  properties: {
    s: { type: "STRING", enum: ["confirmed", "possible", "not_suitable", "unknown"], description: "status" },
    b: { type: "STRING", enum: ["menu_label", "ingredients", "name_only", "unknown"], description: "basis" },
    ...(withEvidence ? { e: str("verbatim quote supporting a confirmed or not_suitable status") } : {}),
  },
  required: ["s", "b"],
});

export function extractionJsonSchema(opts: { vegan: boolean } = { vegan: true }) {
  return {
    type: "OBJECT",
    properties: {
      documents: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            documentId: str(undefined, false),
            verdict: { type: "STRING", enum: ["food_menu", "set_menu", "dessert_menu", "drinks_only", "legal_or_other", "wrong_restaurant", "unreadable"] },
            reason: str(),
            languages: { type: "ARRAY", items: { type: "STRING", enum: ["ca", "es", "en", "other"] } },
            omittedNonMatchingCount: { type: "INTEGER" },
            setMenus: {
              type: "ARRAY",
              items: { type: "OBJECT", properties: { id: str(undefined, false), name: str(undefined, false), description: str(), priceRaw: str() }, required: ["id", "name"] },
            },
            dishes: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  n: str("name exactly as printed", false),
                  t: str("English translation, null if already English"),
                  d: str("printed description, only if it lists ingredients"),
                  l: { type: "STRING", enum: ["ca", "es", "en", "other"], description: "language of the name" },
                  s: str("menu section heading"),
                  m: str("set menu id this dish belongs to"),
                  p: str("price exactly as printed beside the dish"),
                  c: { type: "STRING", enum: ["starter", "main", "side", "dessert", "other"], nullable: true, description: "course" },
                  g: { type: "INTEGER", nullable: true, description: "page number" },
                  v: verdictSchema(true),
                  ...(opts.vegan ? { x: verdictSchema(false) } : {}),
                },
                required: ["n", "t", "l", "s", "p", "v", ...(opts.vegan ? ["x"] : [])],
              },
            },
          },
          required: ["documentId", "verdict", "omittedNonMatchingCount", "dishes"],
        },
      },
    },
    required: ["documents"],
  };
}

export const EXTRACTION_JSON_SCHEMA = extractionJsonSchema({ vegan: true });

export const PRICE_CHECK_JSON_SCHEMA = {
  type: "OBJECT",
  properties: {
    lines: { type: "ARRAY", items: { type: "OBJECT", properties: { dish: str(undefined, false), price: str() }, required: ["dish"] } },
  },
  required: ["lines"],
} as const;
