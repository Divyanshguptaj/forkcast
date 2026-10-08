import { normalizeText } from "@/lib/text";
import type { Constraint } from "@/schemas/recommendations";
import type { UserRequest } from "@/schemas/request";

const DIET_LABEL: Record<string, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  pescatarian: "Pescatarian",
  gluten_free: "Gluten-free",
  halal: "Halal",
  kosher: "Kosher",
};

const MEAL_LABEL: Record<string, string> = { breakfast: "Breakfast", brunch: "Brunch", lunch: "Lunch", dinner: "Dinner" };

const slug = (value: string) => normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export function buildConstraints(request: UserRequest, cuisines: string[] = request.cuisines): Constraint[] {
  const out: Constraint[] = [];
  const add = (c: Constraint) => {
    if (!out.some((o) => o.id === c.id)) out.push(c);
  };

  for (const diet of request.diet) add({ id: `diet:${diet}`, kind: "diet", strength: "hard", label: DIET_LABEL[diet] ?? diet, value: diet, blocking: true });
  for (const allergy of request.allergies) add({ id: `allergy:${slug(allergy)}`, kind: "allergy", strength: "hard", label: `Allergy: ${allergy}`, value: allergy, blocking: false });
  for (const food of request.dislikedFoods) add({ id: `dislike:${slug(food)}`, kind: "dislike", strength: "hard", label: `No ${food}`, value: food, blocking: false });
  if (request.budget) {
    add({ id: "budget:max", kind: "budget", strength: "hard", label: `Up to €${request.budget.max} per person (checked per dish)`, value: String(request.budget.max), blocking: true });
  }
  for (const text of request.mustHave) add({ id: `must:${slug(text)}`, kind: "must_have", strength: "hard", label: `Must have: ${text}`, value: text, blocking: true });
  for (const cuisine of cuisines) add({ id: `cuisine:${slug(cuisine)}`, kind: "cuisine", strength: "soft", label: `${cuisine.charAt(0).toUpperCase()}${cuisine.slice(1)} cuisine`, value: cuisine, blocking: false });
  if (request.meal !== "any") add({ id: `meal:${request.meal}`, kind: "meal", strength: "soft", label: MEAL_LABEL[request.meal] ?? request.meal, value: request.meal, blocking: false });
  for (const text of request.preferences) add({ id: `pref:${slug(text)}`, kind: "preference", strength: "soft", label: `Preference: ${text}`, value: text, blocking: false });
  return out;
}
