import type { RecommendRequestBodyType, UserRequest } from "@/schemas/request";

export type MealValue = UserRequest["meal"];
export type DietValue = UserRequest["diet"][number];

export interface ComposerState {
  text: string;
  city: string;
  meal: MealValue;
  diet: DietValue[];
  cuisines: string[];
  budgetMax: number | null;
  allergies: string[];
  mustHave: string[];
  partySize: number | null;
}

export const DEFAULT_COMPOSER: ComposerState = {
  text: "",
  city: "Barcelona",
  meal: "any",
  diet: [],
  cuisines: [],
  budgetMax: null,
  allergies: [],
  mustHave: [],
  partySize: null,
};

export const CITY_OPTIONS = ["Barcelona"] as const;

export const MEAL_OPTIONS: ReadonlyArray<{ value: MealValue; label: string; emoji: string }> = [
  { value: "breakfast", label: "Breakfast", emoji: "🥐" },
  { value: "brunch", label: "Brunch", emoji: "🥞" },
  { value: "lunch", label: "Lunch", emoji: "🥗" },
  { value: "dinner", label: "Dinner", emoji: "🌙" },
  { value: "any", label: "Any meal", emoji: "🍽️" },
];

export const DIET_OPTIONS: ReadonlyArray<{ value: DietValue; label: string; emoji?: string }> = [
  { value: "vegetarian", label: "Vegetarian", emoji: "🌱" },
  { value: "vegan", label: "Vegan", emoji: "🌿" },
  { value: "pescatarian", label: "Pescatarian", emoji: "🐟" },
  { value: "gluten_free", label: "Gluten-free", emoji: "🌾" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
];

export const CUISINE_OPTIONS: ReadonlyArray<{ value: string; emoji: string }> = [
  { value: "Italian", emoji: "🍝" },
  { value: "Spanish", emoji: "🥘" },
  { value: "Catalan", emoji: "🍅" },
  { value: "Tapas", emoji: "🍤" },
  { value: "Japanese", emoji: "🍣" },
  { value: "Mediterranean", emoji: "🫒" },
  { value: "Indian", emoji: "🍛" },
  { value: "Mexican", emoji: "🌮" },
];

export const MUST_HAVE_OPTIONS = ["Quiet", "Outdoor seating", "Good for groups", "Wheelchair accessible"] as const;

export const BUDGET_MIN = 10;
export const BUDGET_MAX = 100;

export interface ExampleQuery {
  id: string;
  emoji: string;
  text: string;
  patch: Partial<ComposerState>;
}

export const EXAMPLE_QUERIES: readonly ExampleQuery[] = [
  { id: "tapas", emoji: "🍤", text: "Vegetarian tapas in Barcelona under €25", patch: { meal: "dinner", diet: ["vegetarian"], cuisines: ["Tapas"], budgetMax: 25, mustHave: [] } },
  { id: "italian", emoji: "🍝", text: "Romantic Italian dinner, around €40", patch: { meal: "dinner", diet: [], cuisines: ["Italian"], budgetMax: 40, mustHave: ["Quiet"] } },
  { id: "brunch", emoji: "🥞", text: "Vegan brunch somewhere relaxed", patch: { meal: "brunch", diet: ["vegan"], cuisines: [], budgetMax: null, mustHave: ["Quiet"] } },
];

export function toggleIn<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function toRecommendBody(state: ComposerState): RecommendRequestBodyType {
  const text = state.text.trim();
  return {
    text: text || undefined,
    form: {
      city: state.city,
      meal: state.meal,
      diet: state.diet,
      cuisines: state.cuisines,
      budget: state.budgetMax === null ? undefined : { max: state.budgetMax, currency: "EUR", perPerson: true },
      allergies: state.allergies,
      preferences: state.mustHave,
      partySize: state.partySize ?? undefined,
      rawText: text || undefined,
    },
  };
}

export function hasRequest(state: ComposerState): boolean {
  return state.text.trim().length > 0 || state.diet.length > 0 || state.cuisines.length > 0 || state.budgetMax !== null || state.meal !== "any";
}

export function summarize(state: ComposerState): string[] {
  const parts: string[] = [state.city];
  const meal = MEAL_OPTIONS.find((m) => m.value === state.meal);
  if (meal && meal.value !== "any") parts.push(meal.label);
  for (const d of state.diet) parts.push(DIET_OPTIONS.find((o) => o.value === d)?.label ?? d);
  parts.push(...state.cuisines);
  if (state.budgetMax !== null) parts.push(`Under €${state.budgetMax}`);
  return parts;
}

export function advancedCount(state: ComposerState): number {
  return state.allergies.length + state.mustHave.length + (state.partySize ? 1 : 0);
}
