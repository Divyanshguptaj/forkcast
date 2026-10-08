import { normalizeText } from "@/lib/text";
import { isBudgetGradePrice, type DishDiet, type DishPrice, type ExtractedDish, type SetMenu } from "@/schemas/menuExtraction";
import type { Constraint, ConstraintKindValue, DishRoleValue, MatchedDish, VerdictValue } from "@/schemas/recommendations";
import { allergenWords, dishRole, dislikeWords, hasWord, matchedWords } from "./lexicons";

export interface DishOutcome {
  constraintId: string;
  kind: ConstraintKindValue;
  verdict: VerdictValue;
  plausible: boolean;
  blocking: boolean;
  note: string;
}

export type InternalFit = "exact" | "possible" | "near_miss" | "unknown" | "excluded";

export interface DishEval {
  dish: ExtractedDish;
  role: DishRoleValue;
  outcomes: DishOutcome[];
  fit: InternalFit;
  price: MatchedDish["price"];
  dietStrength: number;
  overBudgetBy?: number;
}

export const DIET_KEY: Record<string, keyof DishDiet | undefined> = { vegetarian: "vegetarian", vegan: "vegan", pescatarian: "pescatarian", gluten_free: "glutenFree" };
const DIET_STRENGTH: Record<string, number> = { confirmed: 1, possible: 0.4, unknown: 0.1, not_suitable: 0 };
const cents = (n: number) => Math.round(n * 100);
const money = (n: number) => `€${n.toFixed(2)}`;

export const dishText = (d: ExtractedDish) => normalizeText([d.originalName, d.translatedName, d.originalDescription, d.translatedDescription].filter(Boolean).join(" "));

function dietOutcome(dish: ExtractedDish, c: Constraint): DishOutcome & { strength: number } {
  const base = { constraintId: c.id, kind: c.kind, blocking: c.blocking } as const;
  const key = DIET_KEY[c.value];
  if (!key) {
    return { ...base, verdict: "uncertain", plausible: true, note: `Menus rarely state ${c.label.toLowerCase()} status; confirm with the restaurant`, strength: 0 };
  }
  const v = dish.diet[key];
  const strength = DIET_STRENGTH[v.status];
  if (v.status === "confirmed") return { ...base, verdict: "met", plausible: true, note: v.basis === "menu_label" ? `Menu labels it ${c.label.toLowerCase()}` : `Listed ingredients are ${c.label.toLowerCase()}`, strength };
  if (v.status === "not_suitable") return { ...base, verdict: "unmet", plausible: false, note: v.evidence ? `Not ${c.label.toLowerCase()}: ${v.evidence}` : `Not ${c.label.toLowerCase()}`, strength };
  if (v.status === "possible") return { ...base, verdict: "uncertain", plausible: true, note: `Likely ${c.label.toLowerCase()} from the dish name, but the menu doesn't say`, strength };
  return { ...base, verdict: "uncertain", plausible: false, note: `The menu gives no ${c.label.toLowerCase()} information for this dish`, strength };
}

function allergyOutcome(dish: ExtractedDish, c: Constraint): DishOutcome {
  const base = { constraintId: c.id, kind: c.kind, blocking: c.blocking } as const;
  const { words } = allergenWords(c.value);
  const hits = matchedWords(dishText(dish), words);
  if (hits.length > 0) return { ...base, verdict: "unmet", plausible: false, note: `Mentions ${hits[0]}` };
  return { ...base, verdict: "uncertain", plausible: true, note: "Allergens are not listed for this dish" };
}

function dislikeOutcome(dish: ExtractedDish, c: Constraint): DishOutcome {
  const base = { constraintId: c.id, kind: c.kind, blocking: c.blocking } as const;
  const hits = matchedWords(dishText(dish), dislikeWords(c.value));
  if (hits.length > 0) return { ...base, verdict: "unmet", plausible: false, note: `Mentions ${hits[0]}` };
  return { ...base, verdict: "met", plausible: true, note: `No ${c.value} mentioned` };
}

const GROUP_MENU = /\b(group|groups|grupo|grupos|grup|grups|colla|event|evento|events|esdeveniment|party|banquet|banquete)\b/;

export function choosePrice(dish: ExtractedDish, setMenus: Map<string, SetMenu>): MatchedDish["price"] {
  const setMenu = dish.setMenuId ? setMenus.get(dish.setMenuId) : undefined;
  const prices: DishPrice[] = setMenu ? setMenu.prices : dish.prices;
  const withName = <T extends object>(p: T) => (setMenu ? { ...p, setMenuName: setMenu.name.slice(0, 120) } : p);
  if (setMenu && GROUP_MENU.test(normalizeText(setMenu.name))) {
    const listed = setMenu.prices.find((p) => p.amount !== undefined && (p.status === "verified" || p.status === "ocr_agreed" || p.status === "unverified"));
    return { currency: "EUR", status: "absent" as const, setMenuName: setMenu.name.slice(0, 120), groupMenu: { name: setMenu.name.slice(0, 120), ...(listed?.amount !== undefined ? { amount: listed.amount } : {}) } };
  }

  const graded = prices.filter((p) => isBudgetGradePrice(p) && p.currency === "EUR").sort((a, b) => (a.amount as number) - (b.amount as number));
  const pick = graded[0] ?? prices.find((p) => p.status === "unverified" && p.amount !== undefined) ?? prices.find((p) => p.status === "disputed") ?? prices.find((p) => p.amount !== undefined);
  if (!pick || pick.amount === undefined) return withName({ currency: "EUR", status: "absent" as const });
  return withName({
    amount: pick.amount,
    currency: pick.currency,
    ...(pick.label ? { label: pick.label } : {}),
    status: pick.status,
    ...(pick.confidence !== undefined ? { confidence: pick.confidence } : {}),
    ...(pick.alternateAmount !== undefined ? { alternateAmount: pick.alternateAmount } : {}),
  });
}

function budgetOutcome(price: MatchedDish["price"], c: Constraint): DishOutcome & { over?: number } {
  const base = { constraintId: c.id, kind: c.kind, blocking: c.blocking } as const;
  const max = Number(c.value);
  if (price.groupMenu) {
    return { ...base, verdict: "uncertain", plausible: true, note: `Only listed on the group set menu "${price.groupMenu.name}"${price.groupMenu.amount !== undefined ? ` (${money(price.groupMenu.amount)})` : ""}, which may need a group booking, so there is no individual price` };
  }
  const graded = (price.status === "verified" || price.status === "ocr_agreed") && price.amount !== undefined;
  if (graded && price.currency !== "EUR") return { ...base, verdict: "uncertain", plausible: true, note: `Price is in ${price.currency}; Forkcast does not convert currencies` };
  if (graded) {
    const amount = price.amount as number;
    if (cents(amount) <= cents(max)) return { ...base, verdict: "met", plausible: true, note: `${money(amount)} is within €${max}${price.status === "ocr_agreed" ? " (read twice from a photo)" : " (price verified on the menu)"}` };
    return { ...base, verdict: "unmet", plausible: false, note: `${money(amount)} is over €${max}`, over: Math.round((amount - max) * 100) / 100 };
  }
  if (price.status === "disputed") return { ...base, verdict: "uncertain", plausible: true, note: `Price disputed between readings (${price.amount !== undefined ? money(price.amount) : "?"} vs ${price.alternateAmount !== undefined ? money(price.alternateAmount) : "?"}); not used` };
  if (price.status === "unverified" && price.amount !== undefined) return { ...base, verdict: "uncertain", plausible: true, note: `${money(price.amount)} could not be verified against the menu text` };
  return { ...base, verdict: "uncertain", plausible: true, note: "The menu lists no price for this dish" };
}

export function evaluateDish(dish: ExtractedDish, setMenus: Map<string, SetMenu>, constraints: Constraint[]): DishEval {
  const role = dishRole(dish.section, dish.originalName, dish.offering, dish.course);
  const price = choosePrice(dish, setMenus);
  const outcomes: DishOutcome[] = [];
  const strengths: number[] = [];
  let overBudgetBy: number | undefined;

  for (const c of constraints) {
    if (c.kind === "diet") {
      const { strength, ...o } = dietOutcome(dish, c);
      outcomes.push(o);
      strengths.push(strength);
    } else if (c.kind === "allergy") outcomes.push(allergyOutcome(dish, c));
    else if (c.kind === "dislike") outcomes.push(dislikeOutcome(dish, c));
    else if (c.kind === "budget") {
      const { over, ...o } = budgetOutcome(price, c);
      outcomes.push(o);
      overBudgetBy = over;
    }
  }

  if (role === "drink") {
    return { dish, role, outcomes: [], fit: "excluded", price, dietStrength: 0 };
  }

  const unmet = outcomes.filter((o) => o.verdict === "unmet");
  const dietConfirmed = outcomes.filter((o) => o.kind === "diet").every((o) => o.verdict === "met");
  let fit: InternalFit;
  if (unmet.length > 0) {
    const budgetOnly = unmet.every((o) => o.kind === "budget") && dietConfirmed && outcomes.filter((o) => o.kind !== "budget" && o.blocking).every((o) => o.verdict === "met");
    fit = budgetOnly ? "near_miss" : "excluded";
  } else {
    const blockingUncertain = outcomes.filter((o) => o.blocking && o.verdict === "uncertain");
    fit = blockingUncertain.length === 0 ? "exact" : blockingUncertain.every((o) => o.plausible) ? "possible" : "unknown";
  }

  return {
    dish,
    role,
    outcomes,
    fit,
    price,
    dietStrength: strengths.length ? strengths.reduce((a, b) => a + b, 0) / strengths.length : 1,
    ...(overBudgetBy !== undefined && fit === "near_miss" ? { overBudgetBy } : {}),
  };
}

export function textMatches(corpus: string, phrase: string): boolean {
  const norm = normalizeText(phrase);
  const tokens = norm.split(" ").filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  return tokens.every((t) => hasWord(corpus, [t]));
}
