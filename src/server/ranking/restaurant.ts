import { normalizeText } from "@/lib/text";
import type { ExtractedDish, MenuExtraction, SetMenu } from "@/schemas/menuExtraction";
import type { Constraint, ConstraintOutcome, ExclusionCodeValue, RecommendationTierValue } from "@/schemas/recommendations";
import type { RestaurantDetails } from "@/schemas/restaurant";
import { hasServiceInWindow } from "../discovery/filter";
import { PRICE_LEVEL_EUR } from "../discovery/shortlist";
import { DIET_KEY, dishText, evaluateDish, textMatches, type DishEval } from "./dishMatch";
import { CUISINE_DISH_WORDS, KNOWN_CUISINES, allergenWords, hasWord, mealRoles } from "./lexicons";

export interface RecommendCandidate {
  restaurant: RestaurantDetails;
  shortlistScore: number;
  distanceKm?: number;
  extraction?: MenuExtraction;
}

export interface Evaluated {
  candidate: RecommendCandidate;
  extraction: MenuExtraction;
  evals: DishEval[];
  exact: DishEval[];
  exactAll: DishEval[];
  possible: DishEval[];
  nearMiss: DishEval[];
  outcomes: ConstraintOutcome[];
  tier: RecommendationTierValue;
  unmet: string[];
  uncertainties: string[];
}

export interface Excluded {
  candidate: RecommendCandidate;
  code: ExclusionCodeValue;
  reason: string;
}

const money = (n: number) => `€${n.toFixed(2)}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const cap = (word: string) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
const article = (word: string) => (/^[aeiou]/i.test(word) ? "an" : "a");
const nameOf = (e: DishEval) => e.dish.translatedName ?? e.dish.originalName;

function dedupeEvals(evals: DishEval[]): DishEval[] {
  const best = new Map<string, DishEval>();
  const rank = { exact: 3, possible: 2, near_miss: 1, unknown: 0, excluded: 0 } as const;
  for (const e of evals) {
    const key = `${normalizeText(e.dish.translatedName ?? e.dish.originalName).replace(/[^a-z0-9]+/g, " ").trim()}|${e.price.amount ?? ""}`;
    const existing = best.get(key);
    if (!existing || rank[e.fit] > rank[existing.fit] || (rank[e.fit] === rank[existing.fit] && e.dish.extractionConfidence > existing.dish.extractionConfidence)) best.set(key, e);
  }
  return [...best.values()];
}

function cuisineOutcome(c: Constraint, cand: RecommendCandidate, evals: DishEval[]): Pick<ConstraintOutcome, "verdict" | "note"> {
  const cuisine = normalizeText(c.value);
  const r = cand.restaurant;
  const types = [...r.types, r.primaryType ?? ""].map((t) => t.toLowerCase()).filter(Boolean);
  const slug = cuisine.replace(/\s+/g, "_");
  if (types.some((t) => t === `${slug}_restaurant` || t.includes(slug))) return { verdict: "met", note: `Google lists it as ${article(c.value)} ${cap(c.value)} restaurant` };
  if (normalizeText(r.name).includes(cuisine)) return { verdict: "met", note: `The restaurant name mentions ${cap(c.value)}` };
  const words = CUISINE_DISH_WORDS[cuisine];
  if (words && evals.length > 0) {
    const matches = evals.filter((e) => hasWord(dishText(e.dish), words)).length;
    if (matches >= 3 && matches / evals.length >= 0.2) return { verdict: "met", note: `${plural(matches, "dish")} on the menu are typical ${cap(c.value)} dishes` };
  }
  const other = types.find((t) => t.endsWith("_restaurant") && KNOWN_CUISINES.includes(t.replace(/_restaurant$/, "")) && t !== `${slug}_restaurant`);
  if (other) {
    const kind = cap(other.replace(/_restaurant$/, "").replace(/_/g, " "));
    return { verdict: "unmet", note: `Google lists it as ${article(kind)} ${kind} restaurant` };
  }
  return { verdict: "uncertain", note: `No ${cap(c.value)} cuisine evidence in Google data or on the menu` };
}

function mealOutcome(c: Constraint, r: RestaurantDetails): Pick<ConstraintOutcome, "verdict" | "note"> {
  const flags = { breakfast: r.servesBreakfast, lunch: r.servesLunch, dinner: r.servesDinner } as const;
  const served = c.value === "brunch" ? (r.servesBreakfast === true || r.servesLunch === true ? true : r.servesBreakfast === false && r.servesLunch === false ? false : undefined) : flags[c.value as keyof typeof flags];
  if (served === true) return { verdict: "met", note: `Google lists ${c.value} service` };
  if (served === false) return { verdict: "unmet", note: `Google says it does not serve ${c.value}` };
  const hours = hasServiceInWindow(r, c.value);
  if (hours === true) return { verdict: "met", note: `Opening hours cover ${c.value} time` };
  if (hours === false) return { verdict: "unmet", note: `Opening hours do not cover ${c.value} time` };
  return { verdict: "uncertain", note: `No ${c.value} service information` };
}

function freeTextOutcome(c: Constraint, corpus: string, evals: DishEval[], r: RestaurantDetails): Pick<ConstraintOutcome, "verdict" | "note"> {
  if (!textMatches(corpus, c.value)) return { verdict: "uncertain", note: `"${c.value}" can't be confirmed from the menu or Google data` };
  const dish = evals.find((e) => textMatches(dishText(e.dish), c.value));
  return { verdict: "met", note: dish ? `Found on the menu: ${nameOf(dish)}` : `Found in the restaurant details (${r.name})` };
}

function priceLevelHint(r: RestaurantDetails): string {
  const band = r.priceLevel !== undefined ? PRICE_LEVEL_EUR[r.priceLevel] : undefined;
  return band ? ` Google's price level ${"€".repeat(Math.max(1, r.priceLevel ?? 1))} suggests roughly €${band.entry}-${band.typical} per person, which is only an estimate.` : "";
}

function excludedFor(cand: RecommendCandidate, code: ExclusionCodeValue, reason: string): Excluded {
  return { candidate: cand, code, reason: reason.slice(0, 300) };
}

export function evaluateRestaurant(cand: RecommendCandidate, constraints: Constraint[]): Evaluated | Excluded {
  const ext = cand.extraction;
  if (!ext) return excludedFor(cand, "no_menu", "No menu was found for this restaurant, so nothing could be checked against your requirements.");
  if (ext.status === "failed") return excludedFor(cand, "menu_unreadable", `The menu could not be read${ext.reason ? ` (${ext.reason})` : ""}.`);
  if (ext.status === "unavailable" || ext.dishes.length === 0) return excludedFor(cand, "no_menu", `No readable menu${ext.reason ? `: ${ext.reason}` : ""}.`);

  const setMenus = new Map<string, SetMenu>(ext.setMenus.map((s) => [s.id, s]));
  const evals = dedupeEvals(ext.dishes.map((d: ExtractedDish) => evaluateDish(d, setMenus, constraints)));
  const exactAll = evals.filter((e) => e.fit === "exact");
  const possible = evals.filter((e) => e.fit === "possible");
  const nearMiss = evals.filter((e) => e.fit === "near_miss");

  const mealConstraint = constraints.find((c) => c.kind === "meal");
  const meal = mealConstraint ? mealRoles(mealConstraint.value) : undefined;
  const exact = meal ? exactAll.filter((e) => meal.roles.has(e.role)) : exactAll;

  const outcomes: ConstraintOutcome[] = [];
  const unmet: string[] = [];
  const uncertainties: string[] = [];
  const corpus = normalizeText([cand.restaurant.name, ...cand.restaurant.types, ...evals.map((e) => dishText(e.dish))].join(" "));
  const outcomeOf = (e: DishEval, id: string) => e.outcomes.find((o) => o.constraintId === id);

  for (const c of constraints) {
    const base = { constraintId: c.id, kind: c.kind, strength: c.strength, label: c.label } as const;
    if (c.kind === "diet" && !DIET_KEY[c.value]) {
      outcomes.push({ ...base, verdict: "uncertain", note: `Menus rarely state ${c.label.toLowerCase()} status; confirm with the restaurant` });
    } else if (c.kind === "diet") {
      const confirmed = evals.filter((e) => outcomeOf(e, c.id)?.verdict === "met");
      const likely = evals.filter((e) => outcomeOf(e, c.id)?.verdict === "uncertain" && outcomeOf(e, c.id)?.plausible);
      const allUnmet = evals.every((e) => outcomeOf(e, c.id)?.verdict === "unmet");
      if (confirmed.length > 0) outcomes.push({ ...base, verdict: "met", dishCount: confirmed.length, note: `${plural(confirmed.length, "dish", "dishes")} confirmed ${c.label.toLowerCase()} by menu labels or ingredient lists` });
      else if (likely.length > 0) outcomes.push({ ...base, verdict: "uncertain", dishCount: likely.length, note: `${plural(likely.length, "dish", "dishes")} look ${c.label.toLowerCase()}, but no menu label or ingredient list confirms it` });
      else if (allUnmet) outcomes.push({ ...base, verdict: "unmet", dishCount: 0, note: `Every dish we read is not ${c.label.toLowerCase()}` });
      else outcomes.push({ ...base, verdict: "uncertain", dishCount: 0, note: `The menu gives no ${c.label.toLowerCase()} information` });
    } else if (c.kind === "allergy") {
      const set = evals.filter((e) => outcomeOf(e, c.id)?.verdict === "unmet").length;
      outcomes.push({ ...base, verdict: "uncertain", note: `${set > 0 ? `${plural(set, "dish", "dishes")} mentioning ${allergenWords(c.value).key} set aside. ` : ""}Menus don't list allergens reliably; tell the staff about your ${c.value} allergy` });
    } else if (c.kind === "dislike") {
      const set = evals.filter((e) => outcomeOf(e, c.id)?.verdict === "unmet").length;
      outcomes.push({ ...base, verdict: "met", note: set > 0 ? `${plural(set, "dish", "dishes")} mentioning ${c.value} set aside` : `No dish we read mentions ${c.value}` });
    } else if (c.kind === "budget") {
      const metDishes = exactAll.filter((e) => outcomeOf(e, c.id)?.verdict === "met");
      const priced = evals.filter((e) => e.price.amount !== undefined).length;
      if (metDishes.length > 0) {
        const mains = metDishes.filter((e) => e.role === "main" || e.role === "set_menu");
        const cheapest = [...(mains.length > 0 ? mains : metDishes)].sort((a, b) => (a.price.amount as number) - (b.price.amount as number))[0];
        outcomes.push({ ...base, verdict: "met", dishCount: metDishes.length, note: `${plural(metDishes.length, "matching dish", "matching dishes")} with a verified price within €${c.value}; cheapest ${mains.length > 0 ? "main" : "dish"} is ${nameOf(cheapest)} at ${money(cheapest.price.amount as number)}` });
      } else if (possible.length > 0) {
        const reason = possible.map((e) => outcomeOf(e, c.id)).find((o) => o?.verdict === "uncertain")?.note;
        outcomes.push({ ...base, verdict: "uncertain", note: priced === 0 ? `This menu lists no prices, so the €${c.value} budget can't be checked.${priceLevelHint(cand.restaurant)}` : (reason ?? `No matching dish has a verified price within €${c.value}`) });
      } else if (nearMiss.length > 0) {
        const cheapest = [...nearMiss].sort((a, b) => (a.overBudgetBy ?? 0) - (b.overBudgetBy ?? 0))[0];
        outcomes.push({ ...base, verdict: "unmet", note: `The cheapest matching dish, ${nameOf(cheapest)}, is ${money(cheapest.price.amount as number)}, €${(cheapest.overBudgetBy ?? 0).toFixed(2)} over your €${c.value} budget` });
      } else outcomes.push({ ...base, verdict: "uncertain", note: `No dish could be checked against the €${c.value} budget` });
    } else if (c.kind === "cuisine") {
      outcomes.push({ ...base, ...cuisineOutcome(c, cand, evals) });
    } else if (c.kind === "meal") {
      outcomes.push({ ...base, ...mealOutcome(c, cand.restaurant) });
    } else {
      outcomes.push({ ...base, ...freeTextOutcome(c, corpus, evals, cand.restaurant) });
    }
  }

  const dietOutcomes = outcomes.filter((o) => o.kind === "diet");
  const cuisineOutcomes = outcomes.filter((o) => o.kind === "cuisine");
  const mealOutcomeRow = outcomes.find((o) => o.kind === "meal");

  if (exactAll.length === 0 && possible.length === 0 && nearMiss.length === 0) {
    const unmetDiet = evals.filter((e) => e.outcomes.some((o) => o.kind === "diet" && o.verdict === "unmet")).length;
    const unmetDislike = evals.filter((e) => e.outcomes.some((o) => (o.kind === "dislike" || o.kind === "allergy") && o.verdict === "unmet")).length;
    const dietLabel = constraints.filter((c) => c.kind === "diet").map((c) => c.label.toLowerCase()).join(" and ");
    if (unmetDiet === evals.length && unmetDiet > 0) {
      return excludedFor(cand, "diet_unmet", `We read ${plural(evals.length, "dish", "dishes")} and none is ${dietLabel}.`);
    }
    if (unmetDiet > 0 && unmetDiet >= unmetDislike && dietOutcomes.length > 0) {
      return excludedFor(cand, "no_dietary_evidence", `${unmetDiet} of ${evals.length} dishes are not ${dietLabel}, and the menu doesn't say whether the other ${evals.length - unmetDiet} are, so none can be recommended safely.`);
    }
    if (unmetDislike > 0) return excludedFor(cand, "dislike_unmet", `${plural(unmetDislike, "dish", "dishes")} were set aside for ingredients you avoid and nothing else qualified.`);
    if (dietOutcomes.length > 0) return excludedFor(cand, "no_dietary_evidence", `The menu doesn't say whether its ${plural(evals.length, "dish", "dishes")} are ${dietLabel}, so none can be recommended safely.`);
    return excludedFor(cand, "no_matching_dish", "No dish on the menu matched your requirements.");
  }

  let tier: RecommendationTierValue;
  const restaurantBlockers = outcomes.filter((o) => o.strength === "hard" && o.kind === "must_have" && o.verdict !== "met");
  const softUnmet = [...(cuisineOutcomes.length > 0 && cuisineOutcomes.every((o) => o.verdict === "unmet") ? cuisineOutcomes : []), ...(mealOutcomeRow?.verdict === "unmet" ? [mealOutcomeRow] : [])];

  if (exact.length > 0) {
    if (restaurantBlockers.length > 0) tier = "uncertain";
    else if (softUnmet.length > 0) tier = "partial";
    else tier = "exact";
  } else if (exactAll.length > 0) {
    tier = "partial";
    unmet.push(`Only sides, starters or desserts match your requirements; no ${meal?.label ?? "main course"} does.`);
  } else if (possible.length > 0) tier = "uncertain";
  else tier = "near_miss";

  for (const o of softUnmet) unmet.push(`${o.label}: ${o.note}.`);
  if (tier === "near_miss") for (const o of outcomes.filter((x) => x.kind === "budget" && x.verdict === "unmet")) unmet.push(`${o.label}: ${o.note}.`);
  for (const o of outcomes) if (o.verdict === "uncertain" && !(o.kind === "diet" && DIET_KEY[o.constraintId.slice(5)])) uncertainties.push(`${o.label}: ${o.note}.`);
  const dietNames = constraints.filter((c) => c.kind === "diet").map((c) => c.label.toLowerCase()).join(" and ") || "matching";
  const isDietMet = (e: DishEval) => e.outcomes.filter((o) => o.kind === "diet").every((o) => o.verdict === "met");
  const dietUnconfirmed = possible.filter((e) => !isDietMet(e)).length;
  const priceUnconfirmed = possible.filter((e) => isDietMet(e)).length;
  if (dietUnconfirmed > 0) uncertainties.push(`${plural(dietUnconfirmed, "more dish", "more dishes")} look ${dietNames}, but the menu doesn't confirm it.`);
  if (priceUnconfirmed > 0 && constraints.some((c) => c.kind === "budget")) uncertainties.push(`${plural(priceUnconfirmed, `${dietNames} dish`, `${dietNames} dishes`)} ${priceUnconfirmed === 1 ? "has" : "have"} no verified price within budget.`);
  if (ext.status === "partial") uncertainties.push("Only part of this menu could be read.");

  return { candidate: cand, extraction: ext, evals, exact, exactAll, possible, nearMiss, outcomes, tier, unmet, uncertainties: [...new Set(uncertainties)] };
}
