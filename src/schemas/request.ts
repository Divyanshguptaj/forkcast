import { z } from "zod";
import { LatLng } from "./common";

export const Meal = z.enum(["breakfast", "brunch", "lunch", "dinner", "any"]);
export const Diet = z.enum([
  "vegetarian",
  "vegan",
  "pescatarian",
  "gluten_free",
  "halal",
  "kosher",
]);

const shortList = (max = 10) => z.array(z.string().trim().min(1).max(80)).max(max).default([]);

export const UserRequestSchema = z.object({
  city: z.string().trim().min(1).max(80),
  country: z.string().trim().max(80).optional(),
  location: LatLng.optional(),
  meal: Meal.default("any"),
  diet: z.array(Diet).max(6).default([]),
  allergies: shortList(),
  dislikedFoods: shortList(),
  cuisines: shortList(),
  budget: z
    .object({
      min: z.number().min(0).max(1000).optional(),
      max: z.number().min(0).max(1000),
      currency: z.literal("EUR"),
      perPerson: z.literal(true).default(true),
    })
    .refine((b) => b.min === undefined || b.min <= b.max, {
      message: "budget.min must be <= budget.max",
    })
    .optional(),
  preferences: shortList(),
  mustHave: shortList(),
  partySize: z.number().int().min(1).max(50).optional(),
  maxDistanceKm: z.number().positive().max(50).optional(),
  rawText: z.string().max(1000).optional(),
  reviewSearchTerms: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
});

export const RecommendRequestBody = z
  .object({
    text: z.string().trim().min(1).max(1000).optional(),
    form: UserRequestSchema.partial().optional(),
  })
  .refine((b) => b.text !== undefined || b.form !== undefined, {
    message: "Provide text or form",
  });

export type UserRequest = z.infer<typeof UserRequestSchema>;
export type RecommendRequestBodyType = z.infer<typeof RecommendRequestBody>;
