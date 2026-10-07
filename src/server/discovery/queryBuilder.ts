import type { NormalizedRequest } from "./normalizeRequest";

export type QueryPurpose = "primary" | "diet_supplement" | "second_cuisine";

export interface PlannedQuery {
  id: string;
  text: string;
  purpose: QueryPurpose;
  maxResults: number;
}

export const MAX_PLACES_QUERIES = 2;
export const RESULTS_PER_QUERY = 20;

const DIET_PRIORITY: Array<[string, string]> = [
  ["vegan", "vegan"],
  ["vegetarian", "vegetarian"],
  ["pescatarian", "pescatarian"],
  ["halal", "halal"],
  ["kosher", "kosher"],
  ["gluten_free", "gluten free"],
];

const MEAL_TERMS: Record<string, string> = {
  breakfast: "breakfast",
  brunch: "brunch",
};

function dietTerm(diets: readonly string[]): string | undefined {
  return DIET_PRIORITY.find(([key]) => diets.includes(key))?.[1];
}

function phrase(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function buildPlacesQueries(norm: NormalizedRequest): PlannedQuery[] {
  const city = norm.request.city;
  const meal = MEAL_TERMS[norm.request.meal];
  const [firstCuisine, secondCuisine] = norm.cuisines;
  const diet = dietTerm(norm.request.diet);

  const queries: PlannedQuery[] = [
    {
      id: "q1",
      text: phrase([meal, firstCuisine, "restaurants in", city]),
      purpose: "primary",
      maxResults: RESULTS_PER_QUERY,
    },
  ];

  if (diet) {
    queries.push({
      id: "q2",
      text: phrase([diet, meal, firstCuisine, "restaurants in", city]),
      purpose: "diet_supplement",
      maxResults: RESULTS_PER_QUERY,
    });
  } else if (secondCuisine) {
    queries.push({
      id: "q2",
      text: phrase([meal, secondCuisine, "restaurants in", city]),
      purpose: "second_cuisine",
      maxResults: RESULTS_PER_QUERY,
    });
  }

  return queries.slice(0, MAX_PLACES_QUERIES);
}
