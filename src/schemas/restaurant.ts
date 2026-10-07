import { z } from "zod";
import { httpUrl, LatLng } from "./common";
import { ReviewSchema } from "./reviews";

export const RestaurantCandidateSchema = z.object({
  placeId: z.string().min(1),
  name: z.string().min(1),
  address: z.string().optional(),
  location: LatLng,
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().min(0).optional(),
  priceLevel: z.number().int().min(0).max(4).optional(),
  types: z.array(z.string()).default([]),
  distanceKm: z.number().min(0).optional(),
  businessStatus: z.enum(["OPERATIONAL", "CLOSED_TEMPORARILY", "CLOSED_PERMANENTLY"]).optional(),
  sourceId: z.string().min(1),
});

const HoursPoint = z.object({
  day: z.number().int().min(0).max(6),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
});

export const OpeningPeriodSchema = z.object({
  open: HoursPoint,
  close: HoursPoint.optional(),
});

export const OpeningHoursSchema = z.object({
  weekdayText: z.array(z.string()).default([]),
  periods: z.array(OpeningPeriodSchema).default([]),
  openNow: z.boolean().optional(),
});

export const RestaurantDetailsSchema = RestaurantCandidateSchema.extend({
  websiteUrl: httpUrl.optional(),
  websiteHttpsCandidate: httpUrl.optional(),
  primaryType: z.string().optional(),
  mapsUrl: httpUrl.optional(),
  phone: z.string().optional(),
  openingHours: OpeningHoursSchema.optional(),
  servesVegetarianFood: z.boolean().optional(),
  servesBreakfast: z.boolean().optional(),
  servesLunch: z.boolean().optional(),
  servesDinner: z.boolean().optional(),
  sampledReviews: z.array(ReviewSchema).default([]),
});

export type OpeningHours = z.infer<typeof OpeningHoursSchema>;
export type RestaurantCandidate = z.infer<typeof RestaurantCandidateSchema>;
export type RestaurantDetails = z.infer<typeof RestaurantDetailsSchema>;
