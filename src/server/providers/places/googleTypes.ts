import { z } from "zod";

const hoursPoint = z.object({
  day: z.number().int().min(0).max(6).default(0),
  hour: z.number().int().min(0).max(23).default(0),
  minute: z.number().int().min(0).max(59).default(0),
});

export const GooglePlaceSchema = z.object({
  id: z.string().min(1),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
  types: z.array(z.string()).optional(),
  primaryType: z.string().optional(),
  businessStatus: z.string().optional(),
  googleMapsUri: z.string().optional(),
  rating: z.number().optional(),
  userRatingCount: z.number().optional(),
  priceLevel: z.string().optional(),
  websiteUri: z.string().optional(),
  regularOpeningHours: z
    .object({
      openNow: z.boolean().optional(),
      periods: z.array(z.object({ open: hoursPoint, close: hoursPoint.optional() })).optional(),
      weekdayDescriptions: z.array(z.string()).optional(),
    })
    .optional(),
  servesVegetarianFood: z.boolean().optional(),
});

export const SearchTextResponseSchema = z.object({
  places: z.array(z.unknown()).optional(),
});

export type GooglePlace = z.infer<typeof GooglePlaceSchema>;
