import type { ModelDish, ModelDocument } from "./modelSchema";
import { parsePriceText } from "./price";

const SECTION_LINE = /^[\p{Lu}\d\s'’·&/,.\-–]{3,40}$/u;
const TRAILING_PRICE = /^(.{3,90}?)[\s.·…_\-–]*((?:€\s?)?\d{1,3}(?:[.,]\d{1,2})?\s?(?:€|eur)?)$/i;
const PAGE_MARKER = /^\[page (\d+)\]$/i;

export interface DeterministicDish {
  name: string;
  priceRaw: string;
  section?: string;
  page?: number;
  line: string;
}

export function deterministicDishes(text: string, max = 80): DeterministicDish[] {
  const out: DeterministicDish[] = [];
  let section: string | undefined;
  let page: number | undefined;
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const marker = PAGE_MARKER.exec(line);
    if (marker) {
      page = Number(marker[1]);
      continue;
    }
    const priced = TRAILING_PRICE.exec(line);
    if (priced && /[A-Za-zÀ-ÿ]{3}/.test(priced[1]) && parsePriceText(priced[2]).length === 1) {
      out.push({ name: priced[1].trim().replace(/[:.]+$/, ""), priceRaw: priced[2].trim(), section, page, line: line.slice(0, 300) });
      if (out.length >= max) break;
      continue;
    }
    if (line.length <= 40 && SECTION_LINE.test(line) && /[\p{Lu}]{3}/u.test(line)) section = line;
  }
  return out;
}

export function deterministicDocument(documentId: string, text: string): ModelDocument {
  const dishes: ModelDish[] = deterministicDishes(text).map((d) => ({
    originalName: d.name,
    translatedName: undefined,
    originalDescription: undefined,
    translatedDescription: undefined,
    originalLanguage: "other",
    section: d.section,
    setMenuId: undefined,
    course: undefined,
    priceRaw: d.priceRaw,
    evidence: d.line,
    page: d.page,
    vegetarian: { status: "unknown", basis: "unknown", evidence: "" },
    vegan: { status: "unknown", basis: "unknown", evidence: "" },
  }));
  return { documentId, verdict: dishes.length ? "food_menu" : "unreadable", reason: "deterministic line parser (model unavailable)", languages: [], omittedNonMatchingCount: 0, setMenus: [], dishes };
}
