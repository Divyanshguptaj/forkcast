import { describe, expect, it } from "vitest";
import { ModelDocumentSchema } from "@/server/menu/extract/modelSchema";
import { mergeDishes } from "@/server/menu/extract/dedupe";
import { buildFromModel, type SourceDoc } from "@/server/menu/extract/validate";
import { recommend } from "@/server/ranking";
import { budget, candidate, dish, extraction, request } from "../helpers/rankKit";
import { dish as modelDish, modelDoc } from "../helpers/extractKit";

const SOURCE_TEXT = "MENU DEL DIA\nCroquetas de jamón 8,50 €\nEnsalada verde (V) 7,00 €\nMENÚ GRUPO\nPaella de verduras\nTarta de queso";
const source: SourceDoc = { documentId: "d1", restaurantId: "r1", url: "https://r1.example/menu.pdf", tier: "official_site", documentKind: "food_menu", method: "pdf_text", text: SOURCE_TEXT };
const build = (dishes: unknown[], offeringDefault: "a_la_carte" | "set_menu" = "a_la_carte", over: Record<string, unknown> = {}) =>
  buildFromModel(ModelDocumentSchema.parse(modelDoc("d1", dishes, over)), { source, offeringDefault, setMenuIds: new Set() });

describe("contradictory dietary evidence never produces a confirmed match", () => {
  it("turns disagreeing documents into unknown and then into no recommendation", () => {
    const a = dish({ name: "Pad thai", veg: "confirmed", price: 11 });
    const b = dish({ name: "Pad thai", veg: "not_suitable", price: 11 });
    const [merged] = mergeDishes([a, b]);
    expect(merged.diet.vegetarian.status).toBe("unknown");
    const set = recommend({ request: request({ diet: ["vegetarian"] }), candidates: [candidate("r1", extraction("r1", [merged]))] });
    expect(set.recommendations).toEqual([]);
    expect(set.excluded[0].code).toBe("no_dietary_evidence");
  });

  it("overrides a model 'confirmed' when the dish text names meat", () => {
    const out = build([modelDish("Croquetas de jamón", { priceRaw: "8,50 €", vegetarian: { status: "confirmed", basis: "menu_label", evidence: "Croquetas de jamón" } })]);
    expect(out.dishes[0].diet.vegetarian.status).toBe("not_suitable");
  });

  it("does not confirm vegetarian from a model claim that the source does not support", () => {
    const out = build([modelDish("Ensalada verde (V)", { priceRaw: "7,00 €", vegetarian: { status: "confirmed", basis: "ingredients", evidence: "lechuga, tomate y queso de cabra" } })]);
    expect(out.dishes[0].diet.vegetarian.status).toBe("confirmed");
    expect(out.dishes[0].diet.vegetarian.basis).toBe("menu_label");
    const unsupported = build([modelDish("Paella de verduras", { vegetarian: { status: "confirmed", basis: "ingredients", evidence: "arroz, verduras y caldo vegetal" } })]);
    expect(unsupported.dishes[0].diet.vegetarian.status).not.toBe("confirmed");
  });

  it("keeps vegan unconfirmed when only the vegetarian label exists", () => {
    const menu = extraction("r1", [dish({ name: "Ensalada verde (V)", veg: "confirmed", vegan: "unknown", price: 7 })]);
    const set = recommend({ request: request({ diet: ["vegan"] }), candidates: [candidate("r1", menu)] });
    expect(set.recommendations).toEqual([]);
  });
});

describe("allergy handling never claims safety", () => {
  const menu = extraction("r1", [dish({ name: "Risotto de verduras", veg: "confirmed", price: 12 }), dish({ name: "Pasta con pesto de piñones", veg: "confirmed", price: 12 })]);
  const set = recommend({ request: request({ diet: ["vegetarian"], allergies: ["nuts"] }), candidates: [candidate("r1", menu)] });

  it("attaches a warning and marks every dish as not verified", () => {
    const r = set.recommendations[0];
    expect(r.allergyWarning).toMatch(/cannot confirm that any dish is free of nuts/i);
    expect(r.dishes.map((d) => d.name)).toEqual(["Risotto de verduras"]);
    expect(r.dishes[0].outcomes.find((o) => o.kind === "allergy")?.verdict).toBe("uncertain");
  });

  it("never uses safe or free-from language about allergens", () => {
    const text = JSON.stringify(set);
    expect(text).not.toMatch(/allergen[- ]free|allergy[- ]safe|safe for|nut[- ]free|gluten[- ]free dish confirmed/i);
  });
});

describe("budget interpretation is explicit", () => {
  it("says the budget is checked per dish in the constraint and the notices", () => {
    const set = recommend({ request: request({ diet: ["vegetarian"], budget: budget(30) }), candidates: [candidate("r1", extraction("r1", [dish({ name: "Plato verde", veg: "confirmed", price: 12 })]))] });
    expect(set.constraints.find((c) => c.kind === "budget")?.label).toContain("checked per dish");
    expect(set.notices.join(" ")).toContain("per dish");
  });
});

describe("dish roles", () => {
  const roleOf = (name: string, section?: string) => {
    const set = recommend({ request: request({ diet: ["vegetarian"], meal: "any" }), candidates: [candidate("r1", extraction("r1", [dish({ name, section, veg: "confirmed", price: 10 })]))] });
    return set.recommendations[0].dishes[0].role;
  };

  it("recognises mains from several cuisines without a section", () => {
    for (const name of ["Pinsa romana", "Paneer tikka masala", "Vegetable ramen", "Burrito de frijoles", "Arroz con verduras", "Pad thai noodles", "Moussaka", "Falafel bowl"]) expect(roleOf(name), name).toBe("main");
  });

  it("recognises starters, sides and desserts", () => {
    expect(roleOf("Hummus", undefined)).toBe("starter");
    expect(roleOf("Patatas fritas")).toBe("side");
    expect(roleOf("Gelato al limone")).toBe("dessert");
  });

  it("keeps unknown dishes unknown and does not treat them as main courses", () => {
    expect(roleOf("Delicia de la casa")).toBe("other");
    const menu = extraction("r1", [dish({ name: "Delicia de la casa", veg: "confirmed", price: 10 })]);
    const r = recommend({ request: request({ diet: ["vegetarian"], meal: "dinner" }), candidates: [candidate("r1", menu)] }).recommendations[0];
    expect(r.tier).toBe("uncertain");
    expect(r.uncertainties.join(" ")).toContain("couldn't tell whether");
  });

  it("uses the course the model read when neither section nor name says anything", () => {
    const set = recommend({ request: request({ diet: ["vegetarian"], meal: "dinner" }), candidates: [candidate("r1", extraction("r1", [{ ...dish({ name: "Vegetariana", veg: "confirmed", price: 12 }), course: "main" }]))] });
    expect(set.recommendations[0].dishes[0].role).toBe("main");
    expect(set.recommendations[0].tier).toBe("exact");
  });

  it("lets a menu section override a model guess", () => {
    const set = recommend({ request: request({ diet: ["vegetarian"], meal: "any" }), candidates: [candidate("r1", extraction("r1", [{ ...dish({ name: "Vegetariana", section: "Postres", veg: "confirmed", price: 12 }), course: "main" }]))] });
    expect(set.recommendations[0].dishes[0].role).toBe("dessert");
  });

  it("uses the section when the name says nothing", () => {
    expect(roleOf("Delicia de la casa", "Segundos")).toBe("main");
    expect(roleOf("Delicia de la casa", "Postres")).toBe("dessert");
  });
});

describe("drinks are never recommended as dishes", () => {
  it("removes cocktails, wines and lemonades that leak out of a mixed menu", () => {
    const menu = extraction("r1", [
      dish({ name: "Aperol Spritz Went to Asia", veg: "confirmed", vegan: "confirmed", price: 6.5 }),
      dish({ name: "Limonata di fragole", veg: "confirmed", vegan: "confirmed", price: 4 }),
      dish({ name: "Chardonnay", section: "Vinos blancos", veg: "confirmed", vegan: "confirmed", price: 5 }),
      dish({ name: "Pasta al pomodoro", veg: "confirmed", vegan: "confirmed", price: 11 }),
      dish({ name: "Tarta de café", veg: "confirmed", price: 5, section: "Postres" }),
    ]);
    const r = recommend({ request: request({ diet: ["vegan"], meal: "any" }), candidates: [candidate("r1", menu)] }).recommendations[0];
    expect(r.dishes.map((d) => d.name)).toEqual(["Pasta al pomodoro"]);
    expect(r.exactDishCount).toBe(1);
  });

  it("does not mistake a pizza named Margherita or a coffee dessert for a drink", () => {
    const menu = extraction("r1", [dish({ name: "Margherita", veg: "confirmed", price: 9, section: "Pizzas" }), dish({ name: "Cheesecake de café", veg: "confirmed", price: 5 })]);
    const r = recommend({ request: request({ diet: ["vegetarian"], meal: "any" }), candidates: [candidate("r1", menu)] }).recommendations[0];
    expect(r.dishes.map((d) => d.name).sort()).toEqual(["Cheesecake de café", "Margherita"]);
  });
});

describe("set menus and group menus", () => {
  it("does not copy a set-menu price onto individual dishes of a set-menu document", () => {
    const out = build([modelDish("Paella de verduras", { priceRaw: "24 €" })], "set_menu");
    expect(out.dishes[0].offering).toBe("set_menu");
    expect(out.dishes[0].prices).toEqual([{ status: "absent", currency: "EUR" }]);
  });

  it("treats dishes under a group or event section as set-menu dishes without a price", () => {
    const out = build([modelDish("Tarta de queso", { priceRaw: "5,00 €", section: "MENÚ GRUPO" })]);
    expect(out.dishes[0].offering).toBe("set_menu");
    expect(out.dishes[0].prices[0].status).toBe("absent");
  });

  it("still prices a normal à-la-carte dish", () => {
    const out = build([modelDish("Ensalada verde (V)", { priceRaw: "7,00 €" })]);
    expect(out.dishes[0].prices[0]).toMatchObject({ amount: 7, status: "verified" });
  });

  it("never shows a group menu price as an individual dish price in recommendations", () => {
    const setMenus = [{ id: "g", documentId: "r1#doc", name: "Menú de grupos", prices: [{ amount: 36, currency: "EUR", status: "verified" as const }] }];
    const menu = extraction("r1", [dish({ name: "Paella de verduras (V)", veg: "confirmed", offering: "set_menu", setMenuId: "g", price: null })], {}, setMenus);
    const r = recommend({ request: request({ diet: ["vegetarian"], budget: budget(40) }), candidates: [candidate("r1", menu)] }).recommendations[0];
    expect(r.tier).toBe("uncertain");
    expect(r.dishes[0].price.amount).toBeUndefined();
    expect(r.dishes[0].price.groupMenu).toEqual({ name: "Menú de grupos", amount: 36 });
    expect(r.reasons.map((x) => x.text).join(" ")).not.toContain("€36");
  });
});

describe("outdated menus", () => {
  it("warns when the only menu file is dated before the current year", () => {
    const menu = extraction("r1", [dish({ name: "Risotto de verduras", veg: "confirmed", price: 12 })]);
    menu.documents[0].url = "https://r1.example/wp-content/uploads/2024/02/Menu-2024.pdf";
    const r = recommend({ request: request({ diet: ["vegetarian"] }), candidates: [candidate("r1", menu)], currentYear: 2026 }).recommendations[0];
    expect(r.uncertainties.join(" ")).toContain("dates from 2024");
    const fresh = recommend({ request: request({ diet: ["vegetarian"] }), candidates: [candidate("r1", menu)], currentYear: 2024 }).recommendations[0];
    expect(fresh.uncertainties.join(" ")).not.toContain("dates from");
  });

  it("prefers the newest dated menu file and drops older copies of the same menu", async () => {
    const { dropOutdatedDocuments } = await import("@/server/menu/extract/pipeline");
    const c = (url: string, kind = "food_menu") => ({ id: url, url, documentKind: kind }) as never;
    const kept = dropOutdatedDocuments([c("https://x.example/Menu-2025.pdf"), c("https://x.example/2026/Menu.pdf"), c("https://x.example/carta.pdf"), c("https://x.example/Postres-2023.pdf", "dessert_menu")]) as Array<{ url: string }>;
    expect(kept.map((d) => d.url)).toEqual(["https://x.example/2026/Menu.pdf", "https://x.example/carta.pdf", "https://x.example/Postres-2023.pdf"]);
  });
});
