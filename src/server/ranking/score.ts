import type { SourceTierValue } from "@/schemas/common";
import type { ScoreComponent } from "@/schemas/recommendations";
import type { DishEval } from "./dishMatch";
import { ROLE_WEIGHT } from "./lexicons";
import type { Evaluated } from "./restaurant";

/* Scoring model.
   Components are scored 0-1 and combined with fixed weights, renormalised over the components that apply to the request.
   - dishFit, dietStrength, budgetFit (65%): evidence for what the user asked for.
   - cuisineFit, mealFit (15%): context the user asked for that cannot be checked per dish.
   - evidenceQuality (10%): how trustworthy the menu data is.
   - discovery (10%): rating, proximity and search relevance from the discovery stage.
   Weights are ordinal priors, not fitted values. Menu size does not add credit: dishFit saturates at DISH_SLOTS dishes. */
export const SCORE_WEIGHTS = { dishFit: 0.3, dietStrength: 0.2, budgetFit: 0.15, cuisineFit: 0.1, mealFit: 0.05, evidenceQuality: 0.1, discovery: 0.1 } as const;

export const DISH_SLOTS = 3;
const POSSIBLE_CREDIT = 0.35;
const NEAR_MISS_CREDIT = 0.2;

export const SOURCE_RELIABILITY: Record<SourceTierValue, number> = {
  official_site: 1,
  official_linked: 0.95,
  official_domain_search: 0.85,
  unverified_asset: 0.6,
  third_party: 0.5,
};

const round = (n: number, digits = 3) => Number(n.toFixed(digits));

interface Credit {
  eval: DishEval;
  credit: number;
}

export function dishCredits(ev: Evaluated): Credit[] {
  const credits: Credit[] = [
    ...ev.exactAll.map((e) => ({ eval: e, credit: ROLE_WEIGHT[e.role] })),
    ...ev.possible.map((e) => ({ eval: e, credit: ROLE_WEIGHT[e.role] * POSSIBLE_CREDIT })),
    ...ev.nearMiss.map((e) => ({ eval: e, credit: ROLE_WEIGHT[e.role] * NEAR_MISS_CREDIT })),
  ];
  return credits.sort((a, b) => b.credit - a.credit || b.eval.dish.extractionConfidence - a.eval.dish.extractionConfidence || a.eval.dish.id.localeCompare(b.eval.dish.id));
}

export function scoreRestaurant(ev: Evaluated): { components: ScoreComponent[]; total: number } {
  const top = dishCredits(ev).slice(0, DISH_SLOTS);
  const outcomes = ev.outcomes;
  const rows: Array<Omit<ScoreComponent, "contribution" | "weight"> & { key: keyof typeof SCORE_WEIGHTS }> = [];

  rows.push({
    key: "dishFit",
    label: "Matching dishes",
    value: Math.min(1, top.reduce((n, c) => n + c.credit, 0) / DISH_SLOTS),
    note: `${ev.exactAll.length} verified and ${ev.possible.length} likely matching dishes; credit stops growing after ${DISH_SLOTS} dishes`,
  });

  if (outcomes.some((o) => o.kind === "diet")) {
    rows.push({
      key: "dietStrength",
      label: "Dietary evidence",
      value: top.length ? top.reduce((n, c) => n + c.eval.dietStrength, 0) / top.length : 0,
      note: "Confirmed by a menu label or ingredient list counts fully; name-only guesses count 0.4",
    });
  }

  const budget = outcomes.find((o) => o.kind === "budget");
  if (budget) {
    rows.push({
      key: "budgetFit",
      label: "Budget",
      value: budget.verdict === "met" ? 1 : budget.verdict === "uncertain" ? 0.3 : 0,
      note: budget.verdict === "met" ? "A matching dish has a verified price within budget" : budget.verdict === "uncertain" ? "No verified price; budget can't be confirmed" : "Matching dishes are over budget",
    });
  }

  const cuisine = outcomes.filter((o) => o.kind === "cuisine");
  if (cuisine.length > 0) {
    const value = Math.max(...cuisine.map((o) => (o.verdict === "met" ? 1 : o.verdict === "uncertain" ? 0.4 : 0)));
    rows.push({ key: "cuisineFit", label: "Cuisine", value, note: cuisine.map((o) => o.note).join("; ") });
  }

  const meal = outcomes.find((o) => o.kind === "meal");
  if (meal) rows.push({ key: "mealFit", label: "Meal", value: meal.verdict === "met" ? 1 : meal.verdict === "uncertain" ? 0.5 : 0, note: meal.note });

  const tiers = ev.extraction.documents.filter((d) => d.status === "extracted" || d.status === "partial").map((d) => SOURCE_RELIABILITY[d.tier]);
  const reliability = tiers.length ? Math.max(...tiers) : 0.5;
  const confidence = top.length ? top.reduce((n, c) => n + c.eval.dish.extractionConfidence, 0) / top.length : 0;
  rows.push({
    key: "evidenceQuality",
    label: "Menu reliability",
    value: reliability * confidence * (ev.extraction.status === "partial" ? 0.9 : 1),
    note: `Source reliability ${reliability.toFixed(2)} x extraction confidence ${confidence.toFixed(2)}${ev.extraction.status === "partial" ? " x 0.9 (partial menu)" : ""}`,
  });

  rows.push({ key: "discovery", label: "Rating and proximity", value: ev.candidate.shortlistScore, note: "Google rating (shrunk by review count), distance and search relevance from discovery" });

  const weightSum = rows.reduce((n, r) => n + SCORE_WEIGHTS[r.key], 0);
  const components: ScoreComponent[] = rows.map((r) => {
    const weight = SCORE_WEIGHTS[r.key] / weightSum;
    const value = r.value === null ? null : Math.min(1, Math.max(0, r.value));
    return { key: r.key, label: r.label, value: value === null ? null : round(value), weight: round(weight), contribution: round(value === null ? 0 : value * weight * 100, 1), note: r.note.slice(0, 300) };
  });
  const total = Math.min(100, Math.max(0, Math.round(components.reduce((n, c) => n + c.contribution, 0))));
  return { components, total };
}
