import { normalizeText } from "@/lib/text";
import type { DietVerdict, DishDiet, DishPrice, ExtractedDish } from "@/schemas/menuExtraction";

const collapse = (value: string) => normalizeText(value).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

function offeringKey(d: ExtractedDish): string {
  return d.setMenuId ? `set:${d.setMenuId.split("~").pop()}` : d.offering === "dessert" ? "dessert" : "carta";
}

function sameSection(a: ExtractedDish, b: ExtractedDish): boolean {
  if (!a.section || !b.section) return true;
  return collapse(a.section) === collapse(b.section);
}

function matches(a: ExtractedDish, b: ExtractedDish): boolean {
  if (offeringKey(a) !== offeringKey(b)) return false;
  if (!sameSection(a, b)) return false;
  const an = collapse(a.originalName);
  const bn = collapse(b.originalName);
  if (an === bn) return true;
  const at = a.translatedName ? collapse(a.translatedName) : undefined;
  const bt = b.translatedName ? collapse(b.translatedName) : undefined;
  if (at && (at === bn || (bt && at === bt))) return true;
  if (bt && bt === an) return true;
  return false;
}

const RANK: Record<DietVerdict["status"], number> = { confirmed: 3, not_suitable: 2, possible: 1, unknown: 0 };

function mergeVerdict(a: DietVerdict, b: DietVerdict): DietVerdict {
  const conflict = (a.status === "confirmed" && b.status === "not_suitable") || (a.status === "not_suitable" && b.status === "confirmed");
  if (conflict) return { status: "unknown", basis: "lexicon", evidence: "Sources disagree about this dish", confidence: 0.2 };
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] > RANK[b.status] ? a : b;
  return a.confidence >= b.confidence ? a : b;
}

function mergeDiet(a: DishDiet, b: DishDiet): DishDiet {
  return {
    vegetarian: mergeVerdict(a.vegetarian, b.vegetarian),
    vegan: mergeVerdict(a.vegan, b.vegan),
    pescatarian: mergeVerdict(a.pescatarian, b.pescatarian),
    glutenFree: mergeVerdict(a.glutenFree, b.glutenFree),
  };
}

function priceKey(p: DishPrice): string {
  return `${collapse(p.label ?? "")}|${p.amount ?? "none"}|${p.currency}`;
}

function mergePrices(a: DishPrice[], b: DishPrice[]): { prices: DishPrice[]; conflict: boolean } {
  const withAmount = (list: DishPrice[]) => list.filter((p) => p.amount !== undefined);
  const known = new Map<string, DishPrice>();
  for (const p of [...withAmount(a), ...withAmount(b)]) {
    const key = priceKey(p);
    const existing = known.get(key);
    if (!existing || (existing.status !== "verified" && p.status === "verified")) known.set(key, p);
  }
  if (known.size === 0) return { prices: [{ status: "absent", currency: "EUR" }], conflict: false };
  const labels = new Map<string, Set<number>>();
  for (const p of known.values()) {
    const label = collapse(p.label ?? "");
    labels.set(label, (labels.get(label) ?? new Set()).add(p.amount as number));
  }
  const conflict = [...labels.values()].some((amounts) => amounts.size > 1);
  return { prices: [...known.values()].slice(0, 6), conflict };
}

export function mergeDishes(dishes: ExtractedDish[]): ExtractedDish[] {
  const merged: ExtractedDish[] = [];
  for (const dish of dishes) {
    const existing = merged.find((m) => matches(m, dish));
    if (!existing) {
      merged.push({ ...dish, sources: [...dish.sources] });
      continue;
    }
    const { prices, conflict } = mergePrices(existing.prices, dish.prices);
    existing.prices = prices;
    existing.priceConflict = existing.priceConflict || dish.priceConflict || conflict;
    existing.diet = mergeDiet(existing.diet, dish.diet);
    existing.translatedName ??= dish.translatedName;
    existing.originalDescription ??= dish.originalDescription;
    existing.translatedDescription ??= dish.translatedDescription;
    existing.extractionConfidence = Math.max(existing.extractionConfidence, dish.extractionConfidence);
    for (const source of dish.sources) {
      if (!existing.sources.some((s) => s.documentId === source.documentId && s.page === source.page)) existing.sources.push(source);
    }
  }
  return merged;
}
