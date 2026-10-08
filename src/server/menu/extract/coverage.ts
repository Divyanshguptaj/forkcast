import { normalizeText } from "@/lib/text";
import type { ExtractedDish } from "@/schemas/menuExtraction";

const PRIORITY: Record<string, number> = { confirmed: 0, possible: 1, unknown: 2, not_suitable: 3 };

const sectionKey = (d: ExtractedDish) => normalizeText(d.section ?? "").replace(/[^a-z0-9 ]/g, "").trim() || "other";

function rank(d: ExtractedDish): number {
  const diet = Math.min(PRIORITY[d.diet.vegetarian.status], PRIORITY[d.diet.vegan.status]);
  const priced = d.prices.some((p) => p.status === "verified" || p.status === "ocr_agreed") ? 0 : 1;
  return diet * 2 + priced;
}

export function representativeDishes(dishes: ExtractedDish[], cap: number): ExtractedDish[] {
  if (dishes.length <= cap) return dishes;
  const groups = new Map<string, ExtractedDish[]>();
  for (const d of dishes) groups.set(sectionKey(d), [...(groups.get(sectionKey(d)) ?? []), d]);
  const queues = [...groups.values()].map((g) => [...g].sort((a, b) => rank(a) - rank(b)));
  const chosen = new Set<ExtractedDish>();
  for (let round = 0; chosen.size < cap; round++) {
    let added = false;
    for (const queue of queues) {
      if (chosen.size >= cap) break;
      if (queue[round]) {
        chosen.add(queue[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return dishes.filter((d) => chosen.has(d));
}
