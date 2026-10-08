import type { DietBasisValue, DietStatusValue, DietVerdict, DishDiet } from "@/schemas/menuExtraction";
import { readLexicon } from "./lexiconDiet";

export interface ModelVerdict {
  status: DietStatusValue;
  basis: "menu_label" | "ingredients" | "name_only" | "unknown";
  evidence: string;
}

export interface AssessInput {
  name: string;
  description?: string;
  evidenceLine?: string;
  modelVegetarian?: ModelVerdict;
  modelVegan?: ModelVerdict;
  evidenceInSource: (quote: string) => boolean;
}

const verdict = (status: DietStatusValue, basis: DietBasisValue, evidence: string, confidence: number): DietVerdict => ({
  status,
  basis,
  evidence: evidence.slice(0, 300),
  confidence,
});

const UNKNOWN = verdict("unknown", "none", "", 0.2);
const list = (items: string[]) => items.slice(0, 4).join(", ");

const collapse = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function looksLikeIngredientList(evidence: string, name: string): boolean {
  const e = collapse(evidence);
  const n = collapse(name);
  if (e.length < 12 || e === n || n.startsWith(e) || e.startsWith(n) && e.length - n.length < 10) return false;
  return /[,;]| y | i | and | amb | con | with /i.test(evidence);
}

function trustedEvidence(m: ModelVerdict | undefined, input: AssessInput, requireIngredients = false): m is ModelVerdict {
  if (!m || m.evidence.trim().length < 3 || !input.evidenceInSource(m.evidence)) return false;
  return requireIngredients ? looksLikeIngredientList(m.evidence, input.name) : true;
}

function ownLine(input: AssessInput): string | undefined {
  if (!input.evidenceLine) return undefined;
  const name = collapse(input.name).slice(0, 12);
  return name.length >= 4 && collapse(input.evidenceLine).includes(name) ? input.evidenceLine : undefined;
}

export function assessDiet(input: AssessInput): DishDiet {
  const lex = readLexicon(input.name, input.description, ownLine(input));
  const hasAmbiguity = lex.ambiguous.length > 0;
  const meat = lex.meat.length > 0;
  const fish = lex.fish.length > 0;
  const animal = lex.animalProducts.length > 0;
  const mv = input.modelVegetarian;
  const mg = input.modelVegan && !input.modelVegan.evidence && mv ? { ...input.modelVegan, evidence: mv.evidence } : input.modelVegan;

  // vegetarian
  let vegetarian: DietVerdict;
  if (meat || fish) {
    vegetarian = lex.vegLabel
      ? verdict("unknown", "lexicon", `Label "${lex.vegLabel}" conflicts with ${list([...lex.meat, ...lex.fish])}`, 0.2)
      : verdict("not_suitable", "lexicon", `Names ${list([...lex.meat, ...lex.fish])}`, 0.85);
  } else if (lex.vegLabel) {
    vegetarian = verdict("confirmed", "menu_label", `Menu label "${lex.vegLabel}"`, 0.9);
  } else if (mv?.status === "confirmed" && mv.basis === "ingredients" && trustedEvidence(mv, input, true) && !hasAmbiguity) {
    vegetarian = verdict("confirmed", "ingredients", mv.evidence, 0.8);
  } else if (mv?.status === "not_suitable" && trustedEvidence(mv, input)) {
    vegetarian = verdict("not_suitable", "ingredients", mv.evidence, 0.6);
  } else if (mv && (mv.status === "confirmed" || mv.status === "possible")) {
    const note = hasAmbiguity ? ` (could hide stock or meat: ${list(lex.ambiguous)})` : "";
    vegetarian = verdict("possible", "model_inference", `Usually vegetarian, not stated by the menu${note}`, 0.5);
  } else {
    vegetarian = UNKNOWN;
  }

  // vegan
  let vegan: DietVerdict;
  if ((meat || fish) && lex.veganLabel) {
    vegan = verdict("unknown", "lexicon", `Label "${lex.veganLabel}" conflicts with ${list([...lex.meat, ...lex.fish])}`, 0.2);
  } else if (meat || fish) {
    vegan = verdict("not_suitable", "lexicon", `Names ${list([...lex.meat, ...lex.fish])}`, 0.85);
  } else if (lex.veganLabel && !animal) {
    vegan = verdict("confirmed", "menu_label", `Menu label "${lex.veganLabel}"`, 0.9);
  } else if (lex.veganLabel && animal) {
    vegan = verdict("possible", "menu_label", `Labelled "${lex.veganLabel}" but names ${list(lex.animalProducts)}`, 0.4);
  } else if (animal) {
    vegan = verdict("not_suitable", "lexicon", `Names ${list(lex.animalProducts)}`, 0.8);
  } else if (mg?.status === "confirmed" && mg.basis === "ingredients" && trustedEvidence(mg, input, true) && !hasAmbiguity) {
    vegan = verdict("confirmed", "ingredients", mg.evidence, 0.75);
  } else if (mg?.status === "not_suitable" && trustedEvidence(mg, input)) {
    vegan = verdict("not_suitable", "ingredients", mg.evidence, 0.6);
  } else if (vegetarian.status !== "not_suitable" && mg && (mg.status === "confirmed" || mg.status === "possible") && !hasAmbiguity) {
    vegan = verdict("possible", "model_inference", "Plant-based by name only; menu does not say", 0.4);
  } else {
    vegan = UNKNOWN;
  }

  // pescatarian
  let pescatarian: DietVerdict;
  if (meat) pescatarian = verdict("not_suitable", "lexicon", `Names ${list(lex.meat)}`, 0.85);
  else if (vegetarian.status === "confirmed") pescatarian = verdict("confirmed", vegetarian.basis, vegetarian.evidence, vegetarian.confidence);
  else if (fish) pescatarian = verdict("possible", "lexicon", `Names ${list(lex.fish)}; stock or sauce may contain meat`, 0.55);
  else if (vegetarian.status === "possible") pescatarian = verdict("possible", "model_inference", vegetarian.evidence, 0.5);
  else pescatarian = UNKNOWN;

  // gluten free: only ever excluded or label-confirmed
  let glutenFree: DietVerdict;
  if (lex.glutenFreeLabel) glutenFree = verdict("confirmed", "menu_label", `Menu label "${lex.glutenFreeLabel}"`, 0.85);
  else if (lex.gluten.length > 0) glutenFree = verdict("not_suitable", "lexicon", `Names ${list(lex.gluten)}`, 0.7);
  else glutenFree = UNKNOWN;

  return { vegetarian, vegan, pescatarian, glutenFree };
}

export function countByStatus(dishes: Array<{ diet: DishDiet }>, diet: keyof DishDiet): Record<DietStatusValue, number> {
  const out: Record<DietStatusValue, number> = { confirmed: 0, possible: 0, not_suitable: 0, unknown: 0 };
  for (const d of dishes) out[d.diet[diet].status]++;
  return out;
}
