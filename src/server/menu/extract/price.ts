import { normalizeText } from "@/lib/text";

export interface ParsedPrice {
  amount: number;
  currency: string;
  raw: string;
  label?: string;
}

export const MIN_PRICE = 0.5;
export const MAX_PRICE = 500;

const CURRENCIES: Array<[RegExp, string]> = [
  [/€|\beur(?:os?)?\b/i, "EUR"],
  [/\$|\busd\b/i, "USD"],
  [/£|\bgbp\b/i, "GBP"],
];

export function detectCurrency(raw: string): string {
  for (const [pattern, code] of CURRENCIES) if (pattern.test(raw)) return code;
  return "EUR";
}

export function parseAmount(token: string): number | undefined {
  const cleaned = token.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return undefined;
  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandSep).join("").replace(decimalSep, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const parts = cleaned.split(sep);
    if (parts.length > 2) normalized = parts.join("");
    else if (parts[1].length === 3 && parts[0].length >= 1 && parts[0] !== "0") normalized = parts.join("");
    else normalized = `${parts[0]}.${parts[1]}`;
  } else {
    normalized = cleaned;
  }
  const value = Number(normalized);
  return Number.isFinite(value) && value >= MIN_PRICE && value <= MAX_PRICE ? Number(value.toFixed(2)) : undefined;
}

const NUMBER = /(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/g;

export function parsePriceText(raw: string): ParsedPrice[] {
  const text = raw.trim();
  if (!text || text.length > 80) return [];
  const currency = detectCurrency(text);
  const out: ParsedPrice[] = [];
  const pattern = new RegExp(`([A-Za-zÀ-ÿ.]{1,16}(?:\\s[A-Za-zÀ-ÿ.]{1,16})?)?\\s*[:=]?\\s*(?:€|\\$|£)?\\s*${NUMBER.source}\\s*(?:€|eur(?:os?)?|\\$|£)?`, "gi");
  for (const m of text.matchAll(pattern)) {
    const amount = parseAmount(m[2]);
    if (amount === undefined) continue;
    const label = m[1]?.trim().replace(/[:=.]+$/, "");
    out.push({ amount, currency, raw: m[0].trim(), ...(label && !/^(?:eur|euros?|usd|gbp)$/i.test(label) ? { label } : {}) });
    if (out.length >= 4) break;
  }
  return out;
}

export function amountRepresentations(amount: number): string[] {
  const fixed = amount.toFixed(2);
  const reps = new Set<string>([fixed, fixed.replace(".", ",")]);
  if (Number.isInteger(amount)) {
    reps.add(String(amount));
    reps.add(`${amount},-`);
  } else if (Number((amount * 10).toFixed(6)) % 1 === 0) {
    const one = amount.toFixed(1);
    reps.add(one);
    reps.add(one.replace(".", ","));
  }
  return [...reps];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function textHasAmount(text: string, amount: number): boolean {
  return amountRepresentations(amount).some((rep) => new RegExp(`(?<![\\d.,])${escapeRegExp(rep)}(?![\\d]|[.,]\\d)`).test(text));
}

export type PriceCheck = "verified" | "unverified" | "not_found";

const WINDOW_BEFORE = 90;
const WINDOW_AFTER = 280;

export function checkPriceInSource(sourceText: string, dishName: string, amount: number): PriceCheck {
  if (!textHasAmount(sourceText, amount)) return "not_found";
  const haystack = normalizeText(sourceText);
  const needle = normalizeText(dishName).replace(/\s+/g, " ").trim();
  if (needle.length < 3) return "unverified";
  let from = 0;
  for (let hit = haystack.indexOf(needle, from); hit !== -1; hit = haystack.indexOf(needle, from)) {
    const window = haystack.slice(Math.max(0, hit - WINDOW_BEFORE), hit + needle.length + WINDOW_AFTER);
    if (textHasAmount(window, amount)) return "verified";
    from = hit + needle.length;
  }
  return "unverified";
}
