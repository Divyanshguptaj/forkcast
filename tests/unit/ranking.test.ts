import { describe, expect, it } from "vitest";
import { RecommendationSetSchema, type MatchedRestaurant, type RecommendationSet } from "@/schemas/recommendations";
import { SCORE_WEIGHTS, buildConstraints, recommend, type RecommendCandidate } from "@/server/ranking";
import { budget, candidate, dish, extraction, loadFixture, request } from "../helpers/rankKit";

const run = (req: ReturnType<typeof request>, candidates: RecommendCandidate[], cuisines = req.cuisines): RecommendationSet => {
  const set = recommend({ request: req, cuisines, candidates });
  const parsed = RecommendationSetSchema.safeParse(set);
  expect(parsed.success, JSON.stringify(parsed.error?.issues.slice(0, 3))).toBe(true);
  return set;
};

const find = (set: RecommendationSet, id: string): MatchedRestaurant | undefined => set.recommendations.find((r) => r.restaurantId === id);

const vegMenu = (id: string, price = 12.5) =>
  extraction(id, [
    dish({ name: "Pizza Margherita (V)", translated: "Margherita pizza", section: "Pizzas", veg: "confirmed", price }),
    dish({ name: "Gnocchi al pesto", section: "Pastas", veg: "possible", price: 13.5 }),
  ]);

describe("constraints", () => {
  it("separates hard requirements from soft preferences without reinterpreting them", () => {
    const c = buildConstraints(request({ diet: ["vegan", "halal"], allergies: ["Peanuts"], dislikedFoods: ["mushrooms"], budget: budget(25), mustHave: ["terrace"], cuisines: ["italian"], preferences: ["quiet"] }));
    const by = (id: string) => c.find((x) => x.id === id)!;
    expect(by("diet:vegan")).toMatchObject({ strength: "hard", blocking: true });
    expect(by("diet:halal")).toMatchObject({ strength: "hard", blocking: true });
    expect(by("allergy:peanuts")).toMatchObject({ strength: "hard", blocking: false });
    expect(by("dislike:mushrooms")).toMatchObject({ strength: "hard", blocking: false });
    expect(by("budget:max")).toMatchObject({ strength: "hard", value: "25", blocking: true });
    expect(by("must:terrace")).toMatchObject({ strength: "hard", blocking: true });
    expect(by("cuisine:italian")).toMatchObject({ strength: "soft" });
    expect(by("meal:dinner")).toMatchObject({ strength: "soft" });
    expect(by("pref:quiet")).toMatchObject({ strength: "soft" });
  });

  it("emits nothing for an unconstrained request", () => {
    expect(buildConstraints(request({ meal: "any" }))).toEqual([]);
  });
});

describe("exact matches", () => {
  it("recommends a restaurant whose verified vegetarian dish is within budget, with grounded reasons", () => {
    const set = run(request({ diet: ["vegetarian"], cuisines: ["italian"], budget: budget(30) }), [candidate("a", vegMenu("a"))]);
    expect(set.outcome).toBe("exact_matches");
    const [r] = set.recommendations;
    expect(r).toMatchObject({ rank: 1, tier: "exact", categoryLabel: "Matches everything", restaurantId: "a" });
    expect(r.dishes[0]).toMatchObject({ name: "Pizza Margherita (V)", fit: "exact", price: { amount: 12.5, status: "verified" } });
    expect(r.dishes[0].diet[0]).toMatchObject({ diet: "vegetarian", status: "confirmed", basis: "menu_label" });
    expect(r.outcomes.filter((o) => o.strength === "hard").every((o) => o.verdict === "met")).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(2);
  });

  it("ranks several matching restaurants and keeps the unreadable one out with a reason", () => {
    const set = run(request({ diet: ["vegetarian"], budget: budget(30) }), [
      candidate("a", vegMenu("a"), {}, 0.7),
      candidate("b", vegMenu("b"), {}, 0.9),
      candidate("c", undefined),
    ]);
    expect(set.recommendations.map((r) => r.restaurantId)).toEqual(["b", "a"]);
    expect(set.excluded).toEqual([expect.objectContaining({ restaurantId: "c", code: "no_menu" })]);
    expect(set.notices.join(" ")).toContain("could not be assessed");
  });
});

describe("no exact match", () => {
  it("returns labelled alternatives and never relaxes diet or budget silently", () => {
    const over = extraction("over", [dish({ name: "Risotto de setas (V)", veg: "confirmed", price: 34 })]);
    const meat = extraction("meat", [dish({ name: "Entrecot", veg: "not_suitable", price: 12 })]);
    const wrongCuisine = candidate("jp", vegMenu("jp"), { types: ["japanese_restaurant", "restaurant"], primaryType: "japanese_restaurant", name: "Sushi Go" });
    const set = run(request({ diet: ["vegetarian"], cuisines: ["italian"], budget: budget(30) }), [candidate("over", over), candidate("meat", meat), wrongCuisine]);
    expect(set.outcome).toBe("alternatives_only");
    expect(set.notices[0]).toContain("No restaurant satisfied every requirement");
    const near = find(set, "over")!;
    expect(near.tier).toBe("near_miss");
    expect(near.unmet.join(" ")).toContain("€4.00 over your €30 budget");
    expect(near.dishes[0]).toMatchObject({ fit: "near_miss" });
    const partial = find(set, "jp")!;
    expect(partial.tier).toBe("partial");
    expect(partial.unmet.join(" ")).toContain("Japanese");
    expect(find(set, "meat")).toBeUndefined();
    expect(set.excluded).toContainEqual(expect.objectContaining({ restaurantId: "meat", code: "diet_unmet" }));
  });

  it("recommends nothing when nothing can be confirmed", () => {
    const set = run(request({ diet: ["vegan"] }), [candidate("a", extraction("a", [dish({ veg: "unknown" }), dish({ veg: "unknown" })])), candidate("b", undefined)]);
    expect(set.outcome).toBe("none");
    expect(set.recommendations).toEqual([]);
    expect(set.notices[0]).toContain("None of the restaurants could be confirmed");
    expect(set.excluded.map((e) => e.code).sort()).toEqual(["no_dietary_evidence", "no_menu"]);
  });
});

describe("dietary evidence", () => {
  it("never treats unknown dietary information as a match", () => {
    const set = run(request({ diet: ["vegetarian"] }), [candidate("a", extraction("a", [dish({ veg: "unknown", price: 8 }), dish({ veg: "unknown", price: 9 })]))]);
    expect(set.recommendations).toEqual([]);
    expect(set.excluded[0]).toMatchObject({ code: "no_dietary_evidence" });
  });

  it("keeps name-only (possible) matches separate from confirmed ones", () => {
    const set = run(request({ diet: ["vegetarian"] }), [candidate("a", extraction("a", [dish({ veg: "possible", price: 9 })])), candidate("b", extraction("b", [dish({ veg: "confirmed", price: 9 })]))]);
    expect(find(set, "b")?.tier).toBe("exact");
    const a = find(set, "a")!;
    expect(a.tier).toBe("uncertain");
    expect(a.dishes.every((d) => d.fit === "possible")).toBe(true);
    expect(a.uncertainties.join(" ")).toContain("doesn't confirm it");
    expect(a.rank).toBeGreaterThan(find(set, "b")!.rank);
  });

  it("distinguishes vegetarian from vegan", () => {
    const menu = (id: string, vegan: "confirmed" | "possible" | "not_suitable") => extraction(id, [dish({ veg: "confirmed", vegan, price: 11 })]);
    const veg = run(request({ diet: ["vegetarian"] }), [candidate("a", menu("a", "not_suitable"))]);
    expect(find(veg, "a")?.tier).toBe("exact");
    const vegan = run(request({ diet: ["vegan"] }), [candidate("a", menu("a", "not_suitable")), candidate("b", menu("b", "possible")), candidate("c", menu("c", "confirmed"))]);
    expect(find(vegan, "a")).toBeUndefined();
    expect(vegan.excluded).toContainEqual(expect.objectContaining({ restaurantId: "a", code: "diet_unmet" }));
    expect(find(vegan, "b")?.tier).toBe("uncertain");
    expect(find(vegan, "c")?.tier).toBe("exact");
  });

  it("says precisely why a restaurant was excluded when some dishes are unsuitable and the rest are unknown", () => {
    const menu = extraction("a", [dish({ veg: "not_suitable", vegan: "not_suitable" }), dish({ veg: "unknown", vegan: "unknown" }), dish({ veg: "unknown", vegan: "unknown" })]);
    const e = run(request({ diet: ["vegan"] }), [candidate("a", menu)]).excluded[0];
    expect(e.code).toBe("no_dietary_evidence");
    expect(e.reason).toContain("1 of 3 dishes are not vegan");
    expect(e.reason).toContain("the other 2");
  });

  it("requires every requested diet to be met at once", () => {
    const set = run(request({ diet: ["vegetarian", "gluten_free"] }), [
      candidate("both", extraction("both", [dish({ veg: "confirmed", gf: "confirmed", price: 10 })])),
      candidate("vegOnly", extraction("vegOnly", [dish({ veg: "confirmed", gf: "unknown", price: 10 })])),
      candidate("gfMeat", extraction("gfMeat", [dish({ veg: "not_suitable", gf: "confirmed", price: 10 })])),
    ]);
    expect(find(set, "both")?.tier).toBe("exact");
    expect(find(set, "vegOnly")).toBeUndefined();
    expect(find(set, "gfMeat")).toBeUndefined();
  });

  it("never reports halal or kosher as verified from a menu", () => {
    const set = run(request({ diet: ["halal"] }), [candidate("a", extraction("a", [dish({ price: 10 })]))]);
    const r = find(set, "a");
    expect(r?.tier).toBe("uncertain");
    expect(r?.uncertainties.join(" ")).toContain("confirm with the restaurant");
  });
});

describe("prices and budget", () => {
  const price = (p: Parameters<typeof dish>[0]) => candidate("a", extraction("a", [dish({ veg: "confirmed", ...p })]));

  it("treats the budget boundary inclusively and counts cents", () => {
    expect(find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [price({ price: 30 })]), "a")?.tier).toBe("exact");
    const over = find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [price({ price: 30.01 })]), "a")!;
    expect(over.tier).toBe("near_miss");
    expect(over.unmet.join(" ")).toContain("€0.01 over");
  });

  it("never uses a disputed price to claim the budget is met, but shows both readings", () => {
    const r = find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [price({ price: 4.5, priceStatus: "disputed", alternate: 14.5 })]), "a")!;
    expect(r.tier).toBe("uncertain");
    expect(r.dishes[0].price).toMatchObject({ amount: 4.5, status: "disputed", alternateAmount: 14.5 });
    expect(r.dishes[0].outcomes.find((o) => o.kind === "budget")?.note).toContain("disputed");
    expect(r.outcomes.find((o) => o.kind === "budget")?.verdict).toBe("uncertain");
    expect(r.reasons.join(" ")).not.toMatch(/within €30/);
  });

  it("does not count unverified prices against a strict budget", () => {
    const r = find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [price({ price: 12, priceStatus: "unverified" })]), "a")!;
    expect(r.tier).toBe("uncertain");
    expect(r.dishes[0].outcomes.find((o) => o.kind === "budget")?.verdict).toBe("uncertain");
  });

  it("accepts photo prices that a second read confirmed", () => {
    expect(find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [price({ price: 12, priceStatus: "ocr_agreed" })]), "a")?.tier).toBe("exact");
  });

  it("does not convert other currencies", () => {
    const r = find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [price({ price: 5, currency: "USD" })]), "a")!;
    expect(r.tier).toBe("uncertain");
    expect(r.dishes[0].outcomes.find((o) => o.kind === "budget")?.note).toContain("USD");
  });

  it("handles menus without prices and mentions Google's price level only as an estimate", () => {
    const r = find(run(request({ diet: ["vegetarian"], budget: budget(20) }), [candidate("a", extraction("a", [dish({ veg: "confirmed" }), dish({ veg: "confirmed" })]), { priceLevel: 2 })]), "a")!;
    expect(r.tier).toBe("uncertain");
    const note = r.outcomes.find((o) => o.kind === "budget")!.note;
    expect(note).toContain("lists no prices");
    expect(note).toContain("only an estimate");
    expect(r.dishes.every((d) => d.price.status === "absent")).toBe(true);
  });

  it("makes budget irrelevant when none was requested", () => {
    const r = find(run(request({ diet: ["vegetarian"] }), [price({})]), "a")!;
    expect(r.tier).toBe("exact");
    expect(r.components.find((c) => c.key === "budgetFit")).toBeUndefined();
  });

  it("does not use a group set-menu price as an individual budget claim", () => {
    const setMenus = [{ id: "m1", documentId: "a#doc", name: "MENÚ GRUPO", prices: [{ amount: 24, currency: "EUR", status: "verified" as const }] }];
    const menu = extraction("a", [dish({ name: "Supplì (V)", veg: "confirmed", offering: "set_menu", setMenuId: "m1", price: null })], {}, setMenus);
    const r = find(run(request({ diet: ["vegetarian"], budget: budget(30) }), [candidate("a", menu)]), "a")!;
    expect(r.tier).toBe("uncertain");
    expect(r.dishes[0].price).toMatchObject({ amount: 24, setMenuName: "MENÚ GRUPO" });
    expect(r.outcomes.find((o) => o.kind === "budget")?.note).toContain("group booking");
  });

  it("uses the price of a regular set menu", () => {
    const setMenus = [{ id: "m1", documentId: "a#doc", name: "Menú del día", prices: [{ amount: 15.5, currency: "EUR", status: "verified" as const }] }];
    const menu = extraction("a", [dish({ name: "Crema de calabaza (V)", veg: "confirmed", offering: "set_menu", setMenuId: "m1", price: null })], {}, setMenus);
    const r = find(run(request({ diet: ["vegetarian"], budget: budget(20) }), [candidate("a", menu)]), "a")!;
    expect(r.tier).toBe("exact");
    expect(r.dishes[0].price).toMatchObject({ amount: 15.5, setMenuName: "Menú del día" });
  });
});

describe("restaurants with problems", () => {
  it("excludes restaurants with no extracted dishes, with the right reason", () => {
    const empty = extraction("e", [], { status: "unavailable", reason: "no menu available (no_menu_found)" });
    const failed = extraction("f", [], { status: "failed", reason: "model unavailable" });
    const emptyExtracted = extraction("g", []);
    const set = run(request({ diet: ["vegetarian"] }), [candidate("e", empty), candidate("f", failed), candidate("g", emptyExtracted), candidate("h", undefined)]);
    expect(Object.fromEntries(set.excluded.map((e) => [e.restaurantId, e.code]))).toEqual({ e: "no_menu", f: "menu_unreadable", g: "no_menu", h: "no_menu" });
    expect(set.stats).toMatchObject({ considered: 4, withMenu: 0, exact: 0 });
  });

  it("keeps a partially read menu but states the limitation", () => {
    const menu = extraction("a", [dish({ veg: "confirmed", price: 10 })], { status: "partial" });
    const r = find(run(request({ diet: ["vegetarian"] }), [candidate("a", menu)]), "a")!;
    expect(r).toMatchObject({ tier: "exact", menuStatus: "partial" });
    expect(r.uncertainties).toContain("Only part of this menu could be read.");
  });

  it("preserves results for the other restaurants when one fails", () => {
    const set = run(request({ diet: ["vegetarian"] }), [candidate("ok", vegMenu("ok")), candidate("bad", extraction("bad", [], { status: "failed" }))]);
    expect(set.recommendations.map((r) => r.restaurantId)).toEqual(["ok"]);
  });
});

describe("ingredient and allergy constraints", () => {
  it("sets aside dishes with avoided ingredients, including Spanish and Catalan synonyms", () => {
    const menu = extraction("a", [
      dish({ name: "Risotto de setas", translated: "Mushroom risotto", veg: "confirmed", price: 14 }),
      dish({ name: "Escalivada", veg: "confirmed", price: 9 }),
      dish({ name: "Truita de bolets", veg: "confirmed", price: 9 }),
    ]);
    const r = find(run(request({ diet: ["vegetarian"], dislikedFoods: ["mushrooms"] }), [candidate("a", menu)]), "a")!;
    expect(r.dishes.map((d) => d.name)).toEqual(["Escalivada"]);
    expect(r.outcomes.find((o) => o.kind === "dislike")?.note).toContain("2 dishes mentioning mushrooms set aside");
  });

  it("excludes dishes that mention an allergen and always warns that allergens are unverified", () => {
    const menu = extraction("a", [dish({ name: "Pesto genovese con piñones y cacahuetes", veg: "confirmed", price: 12 }), dish({ name: "Risotto de verduras", veg: "confirmed", price: 8 })]);
    const set = run(request({ diet: ["vegetarian"], allergies: ["peanuts"] }), [candidate("a", menu)]);
    const r = find(set, "a")!;
    expect(r.dishes.map((d) => d.name)).toEqual(["Risotto de verduras"]);
    expect(r.tier).toBe("exact");
    expect(r.uncertainties.join(" ")).toContain("tell the staff about your peanuts allergy");
    expect(set.notices.join(" ")).toContain("Always tell the restaurant about your allergies");
  });

  it("excludes a restaurant when every dish mentions an avoided ingredient", () => {
    const set = run(request({ dislikedFoods: ["olives"] }), [candidate("a", extraction("a", [dish({ name: "Ensalada de aceitunas" })]))]);
    expect(set.excluded[0]).toMatchObject({ code: "dislike_unmet" });
  });

  it("keeps must-have requirements hard: unconfirmed ones demote to uncertain", () => {
    const menu = extraction("a", [dish({ name: "Gnocchi al pesto", veg: "confirmed", price: 10 })]);
    const found = find(run(request({ diet: ["vegetarian"], mustHave: ["gnocchi"] }), [candidate("a", menu)]), "a")!;
    expect(found.tier).toBe("exact");
    const missing = find(run(request({ diet: ["vegetarian"], mustHave: ["terrace"] }), [candidate("a", menu)]), "a")!;
    expect(missing.tier).toBe("uncertain");
    expect(missing.uncertainties.join(" ")).toContain("can't be confirmed");
  });

  it("treats free-text preferences as soft and unverified rather than failing the restaurant", () => {
    const r = find(run(request({ diet: ["vegetarian"], preferences: ["not too crowded"] }), [candidate("a", vegMenu("a"))]), "a")!;
    expect(r.tier).toBe("exact");
    expect(r.uncertainties.join(" ")).toContain("not too crowded");
  });
});

describe("meal and cuisine", () => {
  it("downgrades to a partial match when only desserts and sides match a meal request", () => {
    const menu = extraction("a", [dish({ name: "Tiramisu (V)", veg: "confirmed", section: "Postres", price: 6, offering: "dessert" })]);
    const r = find(run(request({ diet: ["vegetarian"], meal: "dinner" }), [candidate("a", menu)]), "a")!;
    expect(r.tier).toBe("partial");
    expect(r.unmet.join(" ")).toContain("no main course does");
    expect(find(run(request({ diet: ["vegetarian"], meal: "any" }), [candidate("a", menu)]), "a")?.tier).toBe("exact");
  });

  it("treats a meal Google says is not served as an unmet soft preference", () => {
    const r = find(run(request({ diet: ["vegetarian"], meal: "dinner" }), [candidate("a", vegMenu("a"), { servesDinner: false })]), "a")!;
    expect(r.tier).toBe("partial");
    expect(r.unmet.join(" ")).toContain("does not serve dinner");
  });

  it("uses menu dishes as cuisine evidence when Google gives none", () => {
    const menu = extraction("a", [dish({ name: "Pasta al pomodoro (V)", veg: "confirmed", price: 10 }), dish({ name: "Pizza margherita", veg: "possible", price: 9 }), dish({ name: "Risotto ai funghi", veg: "possible", price: 12 }), dish({ name: "Gnocchi", veg: "possible", price: 11 })]);
    const r = find(run(request({ diet: ["vegetarian"], cuisines: ["italian"] }), [candidate("a", menu, { types: ["restaurant"], primaryType: undefined, name: "La Mesa" })]), "a")!;
    expect(r.outcomes.find((o) => o.kind === "cuisine")).toMatchObject({ verdict: "met" });
    expect(r.outcomes.find((o) => o.kind === "cuisine")?.note).toContain("typical Italian dishes");
  });

  it("reports an unconfirmed cuisine as uncertain without failing the restaurant", () => {
    const r = find(run(request({ diet: ["vegetarian"], cuisines: ["thai"] }), [candidate("a", vegMenu("a"), { types: ["restaurant"], primaryType: undefined, name: "La Mesa" })]), "a")!;
    expect(r.tier).toBe("exact");
    expect(r.outcomes.find((o) => o.kind === "cuisine")?.verdict).toBe("uncertain");
  });
});

describe("duplicates, large menus and limits", () => {
  it("lists a dish once even when the menu repeats it", () => {
    const menu = extraction("a", [dish({ name: "Pizza Margherita (V)", veg: "confirmed", price: 11 }), dish({ name: "Pizza Margherita (V)", veg: "confirmed", price: 11 }), dish({ name: "Pizza Margherita (V)", translated: "Pizza Margherita (V)", veg: "confirmed", price: 11 })]);
    const r = find(run(request({ diet: ["vegetarian"] }), [candidate("a", menu)]), "a")!;
    expect(r.exactDishCount).toBe(1);
    expect(r.dishes).toHaveLength(1);
  });

  it("does not let a larger menu beat a smaller one of equal quality", () => {
    const small = extraction("small", [dish({ name: "Plato 1", veg: "confirmed", price: 10, section: "Platos" }), dish({ name: "Plato 2", veg: "confirmed", price: 11, section: "Platos" }), dish({ name: "Plato 3", veg: "confirmed", price: 12, section: "Platos" })]);
    const large = extraction("large", Array.from({ length: 200 }, (_, i) => dish({ name: `Plato grande ${i}`, veg: "confirmed", price: 10 + (i % 5), section: "Platos" })));
    const set = run(request({ diet: ["vegetarian"], budget: budget(30) }), [candidate("large", large, {}, 0.8), candidate("small", small, {}, 0.85)]);
    const [first, second] = set.recommendations;
    expect(first.restaurantId).toBe("small");
    expect(second.restaurantId).toBe("large");
    expect(first.score).toBe(second.score);
    expect(second.dishes.length).toBeLessThanOrEqual(6);
  });

  it("rewards three good options more than one but not more than three", () => {
    const withN = (n: number) => extraction("x", Array.from({ length: n }, (_, i) => dish({ name: `Plato ${i}`, veg: "confirmed", price: 10, section: "Platos" })));
    const score = (n: number) => run(request({ diet: ["vegetarian"] }), [candidate("x", withN(n))]).recommendations[0].score;
    expect(score(1)).toBeLessThan(score(3));
    expect(score(3)).toBe(score(10));
  });

  it("caps exact results and dishes per restaurant and records what was cut", () => {
    const many = Array.from({ length: 5 }, (_, i) => candidate(`r${i}`, extraction(`r${i}`, Array.from({ length: 12 }, (_, j) => dish({ name: `Plato ${j}`, veg: "confirmed", price: 10, section: "Platos" }))), {}, 0.9 - i * 0.01));
    const set = run(request({ diet: ["vegetarian"] }), many);
    expect(set.recommendations).toHaveLength(3);
    expect(set.recommendations.every((r) => r.dishes.length <= 4)).toBe(true);
    expect(set.excluded.filter((e) => e.code === "below_cutoff")).toHaveLength(2);
    expect(set.recommendations.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
});

describe("ranking determinism", () => {
  const cands = () => [
    candidate("c", vegMenu("c"), { ratingCount: 100 }, 0.8),
    candidate("a", vegMenu("a"), { ratingCount: 100 }, 0.8),
    candidate("b", vegMenu("b"), { ratingCount: 900 }, 0.8),
    candidate("d", vegMenu("d"), { ratingCount: 100 }, 0.9),
  ];

  it("breaks ties by discovery score, then review count, then id, whatever the input order", () => {
    const req = request({ diet: ["vegetarian"], budget: budget(30) });
    const orders = [cands(), [...cands()].reverse(), [cands()[2], cands()[0], cands()[3], cands()[1]]];
    const results = orders.map((o) => run(req, o).recommendations.map((r) => r.restaurantId));
    expect(results[0]).toEqual(["d", "b", "a", "c"].slice(0, 3));
    expect(results[1]).toEqual(results[0]);
    expect(results[2]).toEqual(results[0]);
  });

  it("is a pure function of its input", () => {
    const req = request({ diet: ["vegetarian"], budget: budget(30), cuisines: ["italian"] });
    const input = cands();
    expect(JSON.stringify(run(req, input))).toBe(JSON.stringify(run(req, [...input].reverse())));
    expect(JSON.stringify(run(req, input))).toBe(JSON.stringify(run(req, input)));
  });

  it("always ranks verified matches above uncertain ones, whatever the score", () => {
    const strongButUncertain = extraction("u", Array.from({ length: 6 }, () => dish({ veg: "possible", price: 9 })));
    const weakButVerified = extraction("v", [dish({ veg: "confirmed", price: 9, section: "Postres", offering: "a_la_carte", name: "Plato" })]);
    const set = run(request({ diet: ["vegetarian"] }), [candidate("u", strongButUncertain, {}, 1), candidate("v", weakButVerified, {}, 0.1)]);
    expect(set.recommendations.map((r) => r.restaurantId)).toEqual(["v", "u"]);
  });
});

describe("score model", () => {
  it("has weights that sum to one and renormalises over applicable components", () => {
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const r = find(run(request({ diet: ["vegetarian"], meal: "any" }), [candidate("a", vegMenu("a"))]), "a")!;
    expect(r.components.reduce((n, c) => n + c.weight, 0)).toBeCloseTo(1, 2);
    expect(r.components.map((c) => c.key)).toEqual(["dishFit", "dietStrength", "evidenceQuality", "discovery"]);
    expect(Math.abs(r.components.reduce((n, c) => n + c.contribution, 0) - r.score)).toBeLessThan(1);
  });

  it("stays stable under +/-30% changes to any single weight for a clear case", () => {
    const req = request({ diet: ["vegetarian"], budget: budget(30), cuisines: ["italian"] });
    const good = candidate("good", extraction("good", [dish({ veg: "confirmed", price: 12, section: "Platos" }), dish({ veg: "confirmed", price: 13, section: "Platos" }), dish({ veg: "confirmed", price: 14, section: "Platos" })]), {}, 0.7);
    const weak = candidate("weak", extraction("weak", [dish({ veg: "possible", price: 12, section: "Platos" })]), {}, 0.95, );
    const set = run(req, [good, weak]);
    const goodRow = find(set, "good")!;
    const weakRow = find(set, "weak")!;
    expect(goodRow.tier).toBe("exact");
    expect(weakRow.tier).toBe("uncertain");
    for (const key of Object.keys(SCORE_WEIGHTS) as Array<keyof typeof SCORE_WEIGHTS>) {
      for (const factor of [0.7, 1.3]) {
        const weights = { ...SCORE_WEIGHTS, [key]: SCORE_WEIGHTS[key] * factor };
        const total = (row: MatchedRestaurant) => {
          const sum = row.components.reduce((n, c) => n + weights[c.key], 0);
          return row.components.reduce((n, c) => n + (c.value ?? 0) * weights[c.key], 0) / sum;
        };
        expect(total(goodRow), `${key} x${factor}`).toBeGreaterThan(total(weakRow));
      }
    }
  });
});

describe("explanations are grounded in extracted data", () => {
  it("only cites dishes, documents, prices and links that exist in the extraction", () => {
    const fx = loadFixture("veg-italian-dinner-30");
    const set = run(fx.request, fx.candidates, fx.cuisines);
    expect(set.recommendations.length).toBeGreaterThan(0);
    for (const r of set.recommendations) {
      const source = fx.candidates.find((c) => c.restaurant.placeId === r.restaurantId)!;
      const extractedDishes = new Map(source.extraction!.dishes.map((d) => [d.id, d]));
      const documentIds = new Set(source.extraction!.documents.map((d) => d.documentId));
      const known = new Set(r.menuSources.map((s) => s.documentId));
      for (const d of r.dishes) {
        const original = extractedDishes.get(d.dishId);
        expect(original, d.dishId).toBeDefined();
        expect(d.name).toBe(original!.originalName);
        expect(documentIds.has(d.source.documentId)).toBe(true);
        if (d.price.amount !== undefined) {
          const amounts = [...original!.prices.map((p) => p.amount), ...source.extraction!.setMenus.flatMap((s) => s.prices.map((p) => p.amount))];
          expect(amounts).toContain(d.price.amount);
        }
      }
      const shown = new Set(r.dishes.map((d) => d.dishId));
      for (const reason of r.reasons) {
        for (const id of reason.dishIds) expect(shown.has(id), id).toBe(true);
        for (const id of reason.documentIds) expect(known.has(id) || documentIds.has(id), id).toBe(true);
        for (const amount of reason.text.matchAll(/€(\d+(?:\.\d+)?)/g)) {
          const value = Number(amount[1]);
          const priced = [...r.dishes.map((d) => d.price.amount), Number(set.constraints.find((c) => c.kind === "budget")?.value)];
          const extracted = source.extraction!.dishes.flatMap((d) => d.prices.map((p) => p.amount));
          expect([...priced, ...extracted].filter((x) => x !== undefined)).toContain(value);
        }
      }
      for (const link of r.links) expect([source.restaurant.websiteUrl, source.restaurant.mapsUrl, ...r.menuSources.map((s) => s.url)]).toContain(link.url);
    }
  });
});

describe("real Barcelona extraction (recorded 2026-10-08)", () => {
  const fx = loadFixture("veg-italian-dinner-30");
  const names = (set: RecommendationSet) => Object.fromEntries(set.recommendations.map((r) => [r.name.split(" ")[0], r.tier]));

  it("recommends the verified vegetarian Italian restaurants and demotes the group-menu-only one", () => {
    const set = run(fx.request, fx.candidates, fx.cuisines);
    expect(set.outcome).toBe("exact_matches");
    expect(names(set)).toMatchObject({ Made: "exact", Bistró: "exact", La: "exact", Osteria: "uncertain" });
    expect(set.excluded.map((e) => e.name)).toContainEqual(expect.stringContaining("Elio's"));
    const sicily = set.recommendations.find((r) => r.name === "Trattoria Marina")!;
    expect(sicily.dishes.filter((d) => d.fit === "exact").map((d) => d.name)).toContain("VEGETARIANA");
    const circolo = set.recommendations.find((r) => r.name.startsWith("Osteria"))!;
    expect(circolo.outcomes.find((o) => o.kind === "budget")?.note).toContain("group set menu");
  });

  it("applies a vegan request to the same menus without relaxing it", () => {
    const set = run({ ...fx.request, diet: ["vegan"] }, fx.candidates, fx.cuisines);
    for (const r of set.recommendations.filter((x) => x.tier === "exact")) {
      expect(r.dishes.filter((d) => d.fit === "exact").every((d) => d.diet.every((x) => x.diet === "vegan" && x.status === "confirmed"))).toBe(true);
    }
  });

  it("returns alternatives, not a silent relaxation, when the budget cannot be met", () => {
    const set = run({ ...fx.request, budget: { max: 5, currency: "EUR", perPerson: true } }, fx.candidates, fx.cuisines);
    expect(set.outcome).toBe("alternatives_only");
    expect(set.recommendations.every((r) => r.tier !== "exact")).toBe(true);
    expect(set.recommendations.every((r) => r.unmet.length > 0 || r.uncertainties.length > 0)).toBe(true);
    const paisano = set.recommendations.find((r) => r.name.startsWith("Bistró"))!;
    expect(paisano.tier).toBe("partial");
    expect(paisano.unmet.join(" ")).toContain("no main course does");
    expect(paisano.dishes[0].price.amount).toBeLessThanOrEqual(5);
  });

  it("handles the restaurant whose menu has no prices", () => {
    const stripped = fx.candidates.map((c) => (c.extraction ? { ...c, extraction: { ...c.extraction, dishes: c.extraction.dishes.map((d) => ({ ...d, prices: [{ status: "absent" as const, currency: "EUR" }], offering: "a_la_carte" as const, setMenuId: undefined })), setMenus: [] } } : c));
    const set = run(fx.request, stripped, fx.cuisines);
    expect(set.recommendations.every((r) => r.tier === "uncertain")).toBe(true);
    expect(set.recommendations[0].outcomes.find((o) => o.kind === "budget")?.note).toContain("lists no prices");
  });

  it("runs in a few milliseconds without any model call", () => {
    const t = performance.now();
    for (let i = 0; i < 20; i++) recommend({ request: fx.request, cuisines: fx.cuisines, candidates: fx.candidates });
    expect((performance.now() - t) / 20).toBeLessThan(150);
  });
});
