import type { SourceTierValue } from "@/schemas/common";
import type { DishDiet } from "@/schemas/menuExtraction";
import type {
  Constraint,
  ExcludedRestaurant,
  MatchedDish,
  MatchedRestaurant,
  RecommendationSet,
  RecommendationTierValue,
} from "@/schemas/recommendations";
import type { UserRequest } from "@/schemas/request";
import { buildConstraints } from "./constraints";
import type { DishEval } from "./dishMatch";
import { evaluateRestaurant, type Evaluated, type RecommendCandidate } from "./restaurant";
import { dishCredits, scoreRestaurant } from "./score";

export interface RecommendLimits {
  maxExact: number;
  maxAlternatives: number;
  maxExactDishes: number;
  maxPossibleDishes: number;
  maxNearMissDishes: number;
}

export const DEFAULT_RECOMMEND_LIMITS: RecommendLimits = { maxExact: 3, maxAlternatives: 3, maxExactDishes: 4, maxPossibleDishes: 2, maxNearMissDishes: 3 };

export interface RecommendInput {
  request: UserRequest;
  cuisines?: string[];
  candidates: RecommendCandidate[];
  limits?: Partial<RecommendLimits>;
}

const TIER_ORDER: Record<RecommendationTierValue, number> = { exact: 0, partial: 1, uncertain: 2, near_miss: 3 };
const CATEGORY: Record<RecommendationTierValue, string> = { exact: "Matches everything", partial: "Partial match", uncertain: "Needs checking", near_miss: "Over budget" };
const DIET_KEY: Record<string, keyof DishDiet | undefined> = { vegetarian: "vegetarian", vegan: "vegan", pescatarian: "pescatarian", gluten_free: "glutenFree" };

const SOURCE_PHRASE: Record<SourceTierValue, string> = {
  official_site: "the restaurant's official website",
  official_linked: "a page linked from the official website",
  official_domain_search: "a file on the official domain",
  unverified_asset: "a file whose owner could not be confirmed",
  third_party: "a third-party site",
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (n: number) => `€${n.toFixed(2)}`;

function toMatchedDish(e: DishEval, fit: MatchedDish["fit"], constraints: Constraint[]): MatchedDish {
  const src = e.dish.sources[0];
  const diets = constraints
    .filter((c) => c.kind === "diet" && DIET_KEY[c.value])
    .map((c) => {
      const v = e.dish.diet[DIET_KEY[c.value] as keyof DishDiet];
      return { diet: c.value, status: v.status, basis: v.basis, evidence: v.evidence.slice(0, 300) };
    });
  return {
    dishId: e.dish.id,
    name: e.dish.originalName,
    ...(e.dish.translatedName ? { translatedName: e.dish.translatedName } : {}),
    ...(e.dish.section ? { section: e.dish.section } : {}),
    offering: e.dish.offering,
    role: e.role,
    fit,
    price: e.price,
    diet: diets,
    outcomes: e.outcomes.map((o) => ({ constraintId: o.constraintId, kind: o.kind, verdict: o.verdict, note: o.note.slice(0, 200) })),
    confidence: e.dish.extractionConfidence,
    source: {
      documentId: src.documentId,
      url: src.url,
      tier: src.tier,
      method: src.method,
      ...(src.page ? { page: src.page } : {}),
      ...(src.evidence ? { evidence: src.evidence } : {}),
    },
  };
}

function pickDishes(ev: Evaluated, constraints: Constraint[], limits: RecommendLimits): MatchedDish[] {
  const order = new Map(dishCredits(ev).map((c, i) => [c.eval, i]));
  const byCredit = (a: DishEval, b: DishEval) => (order.get(a) ?? 0) - (order.get(b) ?? 0);
  return [
    ...[...ev.exactAll].sort(byCredit).slice(0, limits.maxExactDishes).map((e) => toMatchedDish(e, "exact", constraints)),
    ...[...ev.possible].sort(byCredit).slice(0, limits.maxPossibleDishes).map((e) => toMatchedDish(e, "possible", constraints)),
    ...(ev.tier === "near_miss" ? [...ev.nearMiss].sort((a, b) => (a.overBudgetBy ?? 0) - (b.overBudgetBy ?? 0)).slice(0, limits.maxNearMissDishes).map((e) => toMatchedDish(e, "near_miss", constraints)) : []),
  ];
}

function dishLabel(d: MatchedDish): string {
  const name = d.translatedName ?? d.name;
  const priced = (d.price.status === "verified" || d.price.status === "ocr_agreed") && d.price.amount !== undefined;
  if (!priced) return name;
  return d.price.setMenuName ? `${name} (set menu ${money(d.price.amount as number)})` : `${name} (${money(d.price.amount as number)})`;
}

function buildReasons(ev: Evaluated, dishes: MatchedDish[], constraints: Constraint[]): MatchedRestaurant["reasons"] {
  const reasons: MatchedRestaurant["reasons"] = [];
  const exact = dishes.filter((d) => d.fit === "exact");
  const likely = dishes.filter((d) => d.fit === "possible");
  const dietLabels = constraints.filter((c) => c.kind === "diet").map((c) => c.label.toLowerCase());
  const requirement = dietLabels.length ? dietLabels.join(" and ") : "your requirements";

  if (exact.length > 0) {
    const top = exact.slice(0, 2);
    reasons.push({
      text: `${plural(ev.exactAll.length, "dish", "dishes")} confirmed ${requirement === "your requirements" ? "to match" : requirement} on the menu, such as ${top.map(dishLabel).join(" and ")}.`,
      dishIds: top.map((d) => d.dishId),
      documentIds: [...new Set(top.map((d) => d.source.documentId))],
    });
  } else if (likely.length > 0) {
    const dietOk = (d: MatchedDish) => d.diet.every((x) => x.status === "confirmed");
    const priceBlocked = likely.filter(dietOk);
    const priceBlockedCount = ev.possible.filter((e) => e.outcomes.filter((o) => o.kind === "diet").every((o) => o.verdict === "met")).length;
    const top = (priceBlocked.length > 0 ? priceBlocked : likely).slice(0, 2);
    reasons.push({
      text:
        priceBlocked.length > 0
          ? `${plural(priceBlockedCount, "dish", "dishes")} confirmed ${requirement === "your requirements" ? "to match" : requirement}, such as ${top.map(dishLabel).join(" and ")}, but none has a price that can be checked against your budget.`
          : `${plural(ev.possible.length, "dish", "dishes")} look ${requirement === "your requirements" ? "suitable" : requirement}, such as ${top.map(dishLabel).join(" and ")}, but the menu doesn't confirm it.`,
      dishIds: top.map((d) => d.dishId),
      documentIds: [...new Set(top.map((d) => d.source.documentId))],
    });
  } else if (dishes.length > 0 && ev.tier === "near_miss") {
    const top = dishes.slice(0, 2);
    reasons.push({ text: `${top.map(dishLabel).join(" and ")} fit your diet, but every price is above your budget.`, dishIds: top.map((d) => d.dishId), documentIds: [...new Set(top.map((d) => d.source.documentId))] });
  }

  const types = ev.candidate.restaurant.types;
  const typed = constraints.filter((c) => c.kind === "diet").map((c) => c.value).map((d) => (types.includes(`${d}_restaurant`) ? d : d === "vegetarian" && types.includes("vegan_restaurant") ? "vegan" : undefined)).find(Boolean);
  if (typed && ev.tier !== "exact") reasons.push({ text: `Google lists it as a ${typed} restaurant, which supports the dish readings but does not confirm them.`, dishIds: [], documentIds: [] });

  const budget = ev.outcomes.find((o) => o.kind === "budget" && o.verdict === "met");
  if (budget) reasons.push({ text: `${budget.note}.`, dishIds: exact.filter((d) => d.price.amount !== undefined).slice(0, 2).map((d) => d.dishId), documentIds: [] });

  for (const o of ev.outcomes.filter((x) => (x.kind === "cuisine" || x.kind === "meal") && x.verdict === "met")) reasons.push({ text: `${o.label}: ${o.note}.`, dishIds: [], documentIds: [] });
  for (const o of ev.outcomes.filter((x) => (x.kind === "must_have" || x.kind === "preference") && x.verdict === "met")) reasons.push({ text: `${o.label}: ${o.note}.`, dishIds: [], documentIds: [] });

  const docs = ev.extraction.documents.filter((d) => d.status === "extracted" || d.status === "partial");
  if (docs.length > 0) {
    const best = [...docs].sort((a, b) => (a.tier === "official_site" ? 0 : 1) - (b.tier === "official_site" ? 0 : 1))[0];
    const format = best.method === "vision" ? "a photo or scan" : best.method === "pdf_text" ? "a PDF" : "a web page";
    reasons.push({ text: `Menu read from ${SOURCE_PHRASE[best.tier]} (${format}).`, dishIds: [], documentIds: [best.documentId] });
  }

  const r = ev.candidate.restaurant;
  if (r.rating !== undefined && r.ratingCount) reasons.push({ text: `Rated ${r.rating.toFixed(1)} from ${r.ratingCount.toLocaleString("en-US")} Google reviews.`, dishIds: [], documentIds: [] });
  return reasons.map((x) => ({ ...x, text: x.text.slice(0, 300) }));
}

function toRestaurant(ev: Evaluated, constraints: Constraint[], limits: RecommendLimits): Omit<MatchedRestaurant, "rank"> {
  const r = ev.candidate.restaurant;
  const dishes = pickDishes(ev, constraints, limits);
  const { components, total } = scoreRestaurant(ev);
  const docs = ev.extraction.documents.filter((d) => d.status === "extracted" || d.status === "partial");
  const menuSources = docs.map((d) => ({ documentId: d.documentId, url: d.url, tier: d.tier, ...(d.method ? { method: d.method } : {}), status: d.status }));
  const links: MatchedRestaurant["links"] = [];
  if (r.websiteUrl) links.push({ label: "Website", url: r.websiteUrl, kind: "website" });
  if (menuSources[0]) links.push({ label: "View menu", url: menuSources[0].url, kind: "menu" });
  if (r.mapsUrl) links.push({ label: "Google Maps", url: r.mapsUrl, kind: "maps" });

  return {
    restaurantId: r.placeId,
    name: r.name,
    ...(r.address ? { address: r.address } : {}),
    ...(r.rating !== undefined ? { rating: r.rating } : {}),
    ...(r.ratingCount !== undefined ? { ratingCount: r.ratingCount } : {}),
    ...(r.priceLevel !== undefined ? { priceLevel: r.priceLevel } : {}),
    ...(ev.candidate.distanceKm !== undefined ? { distanceKm: ev.candidate.distanceKm } : {}),
    tier: ev.tier,
    categoryLabel: CATEGORY[ev.tier],
    score: total,
    components,
    outcomes: ev.outcomes,
    dishes,
    exactDishCount: ev.exactAll.length,
    possibleDishCount: ev.possible.length,
    menuDishCount: ev.extraction.dishes.length,
    reasons: buildReasons(ev, dishes, constraints),
    unmet: ev.unmet,
    uncertainties: ev.uncertainties,
    menuStatus: ev.extraction.status === "partial" ? "partial" : "extracted",
    menuSources,
    links,
  };
}

export function compareRecommendations(a: Omit<MatchedRestaurant, "rank">, b: Omit<MatchedRestaurant, "rank">, discovery: Map<string, number>): number {
  return (
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier] ||
    b.score - a.score ||
    (discovery.get(b.restaurantId) ?? 0) - (discovery.get(a.restaurantId) ?? 0) ||
    (b.ratingCount ?? 0) - (a.ratingCount ?? 0) ||
    a.restaurantId.localeCompare(b.restaurantId)
  );
}

export function recommend(input: RecommendInput): RecommendationSet {
  const limits = { ...DEFAULT_RECOMMEND_LIMITS, ...input.limits };
  const constraints = buildConstraints(input.request, input.cuisines);
  const evaluated: Evaluated[] = [];
  const excluded: ExcludedRestaurant[] = [];
  const discovery = new Map(input.candidates.map((c) => [c.restaurant.placeId, c.shortlistScore]));

  for (const cand of input.candidates) {
    const out = evaluateRestaurant(cand, constraints);
    if ("tier" in out) evaluated.push(out);
    else excluded.push({ restaurantId: cand.restaurant.placeId, name: cand.restaurant.name, code: out.code, reason: out.reason });
  }

  const built = evaluated.map((ev) => toRestaurant(ev, constraints, limits)).sort((a, b) => compareRecommendations(a, b, discovery));
  const exact = built.filter((b) => b.tier === "exact");
  const others = built.filter((b) => b.tier !== "exact");
  const shownExact = exact.slice(0, limits.maxExact);
  const shownOthers = others.slice(0, limits.maxAlternatives);
  for (const cut of [...exact.slice(limits.maxExact), ...others.slice(limits.maxAlternatives)]) {
    excluded.push({ restaurantId: cut.restaurantId, name: cut.name, code: "below_cutoff", reason: cut.tier === "exact" ? `Ranked below the top ${limits.maxExact} matches.` : `Ranked below the top ${limits.maxAlternatives} alternatives.` });
  }
  const recommendations: MatchedRestaurant[] = [...shownExact, ...shownOthers].map((r, i) => ({ ...r, rank: i + 1 }));

  const notices: string[] = [];
  const outcome: RecommendationSet["outcome"] = shownExact.length > 0 ? "exact_matches" : recommendations.length > 0 ? "alternatives_only" : "none";
  if (outcome === "alternatives_only") notices.push("No restaurant satisfied every requirement. These are the closest options, and each one shows what it is missing.");
  if (outcome === "none") notices.push("None of the restaurants could be confirmed against your requirements, so none is recommended.");
  const unreadable = excluded.filter((e) => e.code === "no_menu" || e.code === "menu_unreadable").length;
  if (unreadable > 0) notices.push(`${plural(unreadable, "restaurant")} could not be assessed because no readable menu was found.`);
  if (constraints.some((c) => c.kind === "budget")) notices.push("Budget is checked per dish using verified menu prices, not for a full meal. Unverified or disputed prices are never counted.");
  if (constraints.some((c) => c.kind === "allergy")) notices.push("Menus don't reliably list allergens. Always tell the restaurant about your allergies.");

  return {
    constraints,
    outcome,
    recommendations,
    excluded,
    notices,
    stats: {
      considered: input.candidates.length,
      withMenu: input.candidates.filter((c) => (c.extraction?.dishes.length ?? 0) > 0).length,
      exact: shownExact.length,
      alternatives: shownOthers.length,
      excluded: excluded.length,
    },
  };
}
