import { normalizeText } from "@/lib/text";
import type { SourceTier } from "@/schemas/common";
import type { DishPrice, ExtractedDish, ExtractionMethodValue, SetMenu } from "@/schemas/menuExtraction";
import type { ResolverDocumentKindValue } from "@/schemas/menuResolution";
import type { z } from "zod";
import { assessDiet } from "./dietAssessor";
import type { ModelDish, ModelDocument } from "./modelSchema";
import { checkPriceInSource, parsePriceText } from "./price";

type Tier = z.infer<typeof SourceTier>;

export interface SourceDoc {
  documentId: string;
  restaurantId: string;
  url: string;
  tier: Tier;
  documentKind: ResolverDocumentKindValue;
  method: ExtractionMethodValue;
  text?: string;
}

const URL_LIKE = /https?:\/\/|www\./i;
const INSTRUCTION_LIKE = /ignore (?:all |any )?(?:previous|prior)|system prompt|as an ai|you must|mark (?:every|all)/i;

const collapse = (value: string) => normalizeText(value).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

export function quoteInSource(sourceNorm: string, quote: string): boolean {
  const q = collapse(quote);
  return q.length >= 3 && sourceNorm.includes(q);
}

export function nameInSource(sourceNorm: string, name: string): boolean {
  const n = collapse(name);
  if (n.length < 2) return false;
  if (sourceNorm.includes(n)) return true;
  const tokens = n.split(" ").filter((t) => t.length > 2);
  if (tokens.length < 2) return false;
  const present = tokens.filter((t) => sourceNorm.includes(t)).length;
  return present / tokens.length >= 0.85;
}

function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (URL_LIKE.test(value) || INSTRUCTION_LIKE.test(value)) return undefined;
  return value;
}

export interface BuildContext {
  source: SourceDoc;
  offeringDefault: ExtractedDish["offering"];
  setMenuIds: Set<string>;
}

export interface BuildResult {
  dishes: ExtractedDish[];
  setMenus: SetMenu[];
  dropped: number;
  warnings: string[];
}

function priceStatusForSource(source: SourceDoc, sourceNorm: string | undefined, name: string, amount: number): { status: DishPrice["status"]; keep: boolean } {
  if (source.method === "vision" || !sourceNorm || !source.text) return { status: "unverified", keep: true };
  const check = checkPriceInSource(source.text, name, amount);
  if (check === "not_found") return { status: "absent", keep: false };
  return { status: check === "verified" ? "verified" : "unverified", keep: true };
}

export function buildPrices(raw: string | undefined, source: SourceDoc, sourceNorm: string | undefined, name: string, warnings: string[]): DishPrice[] {
  if (!raw) return [{ status: "absent", currency: "EUR" }];
  const parsed = parsePriceText(raw);
  if (parsed.length === 0) return [{ status: "absent", currency: "EUR" }];
  const prices: DishPrice[] = [];
  for (const p of parsed) {
    const { status, keep } = priceStatusForSource(source, sourceNorm, name, p.amount);
    if (!keep) {
      warnings.push(`Price ${p.raw} for "${name}" is not in the source text; ignored`);
      continue;
    }
    prices.push({ ...(p.label ? { label: p.label.slice(0, 60) } : {}), amount: p.amount, currency: p.currency, raw: p.raw.slice(0, 40), status });
  }
  return prices.length ? prices : [{ status: "absent", currency: "EUR" }];
}

export function buildFromModel(doc: ModelDocument, ctx: BuildContext): BuildResult {
  const { source } = ctx;
  const sourceNorm = source.text ? collapse(source.text) : undefined;
  const warnings: string[] = [];
  let dropped = 0;

  const setMenus: SetMenu[] = doc.setMenus.map((s) => ({
    id: `${source.documentId}~${s.id}`.slice(0, 160),
    documentId: source.documentId,
    name: s.name,
    ...(cleanText(s.description) ? { description: s.description } : {}),
    prices: buildPrices(s.priceRaw, source, sourceNorm, s.name, warnings),
  }));
  const setIds = new Map(setMenus.map((s, i) => [doc.setMenus[i].id, s.id]));

  const dishes: ExtractedDish[] = [];
  doc.dishes.forEach((raw: ModelDish, index) => {
    const d: ModelDish = { ...raw, originalName: raw.originalName.split(/\r?\n/)[0].replace(/\s+/g, " ").trim() };
    if (!d.originalName) {
      dropped++;
      return;
    }
    if (URL_LIKE.test(d.originalName) || INSTRUCTION_LIKE.test(d.originalName)) {
      dropped++;
      return;
    }
    if (sourceNorm && !nameInSource(sourceNorm, d.originalName)) {
      dropped++;
      warnings.push(`Dropped "${d.originalName.slice(0, 40)}": name not found in the source text`);
      return;
    }
    const setId = d.setMenuId ? setIds.get(d.setMenuId) : undefined;
    const prices = setId ? [{ status: "absent" as const, currency: "EUR" }] : buildPrices(d.priceRaw, source, sourceNorm, d.originalName, warnings);

    const evidenceFn = (quote: string) => (sourceNorm ? quoteInSource(sourceNorm, quote) : false);
    const diet = assessDiet({
      name: d.originalName,
      description: d.originalDescription,
      evidenceLine: d.evidence,
      modelVegetarian: d.vegetarian,
      modelVegan: d.vegan,
      evidenceInSource: evidenceFn,
    });

    const priced = prices.some((p) => p.status === "verified");
    const nameVerified = Boolean(sourceNorm);
    const confidence = source.method === "vision" ? 0.6 : nameVerified ? (priced || prices[0].status === "absent" ? 0.9 : 0.75) : 0.6;

    const translated = d.translatedName && collapse(d.translatedName) !== collapse(d.originalName) ? cleanText(d.translatedName) : undefined;
    dishes.push({
      id: `${source.documentId}~${index}`.slice(0, 200),
      restaurantId: source.restaurantId,
      originalName: d.originalName,
      ...(translated ? { translatedName: translated } : {}),
      ...(cleanText(d.originalDescription) ? { originalDescription: d.originalDescription } : {}),
      ...(translated && cleanText(d.translatedDescription) ? { translatedDescription: d.translatedDescription } : {}),
      originalLanguage: d.originalLanguage,
      ...(d.section ? { section: d.section } : {}),
      offering: setId ? "set_menu" : ctx.offeringDefault,
      ...(setId ? { setMenuId: setId } : {}),
      prices,
      priceConflict: false,
      diet,
      extractionConfidence: confidence,
      sources: [
        {
          documentId: source.documentId,
          url: source.url,
          tier: source.tier,
          method: source.method,
          ...(d.page ? { page: d.page } : {}),
          ...(d.evidence && cleanText(d.evidence) ? { evidence: d.evidence.slice(0, 300) } : d.vegetarian.status === "confirmed" && d.vegetarian.evidence && cleanText(d.vegetarian.evidence) ? { evidence: d.vegetarian.evidence.slice(0, 300) } : {}),
        },
      ],
    });
  });

  return { dishes, setMenus, dropped, warnings };
}
