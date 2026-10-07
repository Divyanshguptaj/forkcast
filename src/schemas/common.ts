import { z } from "zod";

export const httpUrl = z.url({ protocol: /^https?$/, hostname: z.regexes.domain });

export const SourceProvider = z.enum([
  "google_places",
  "official_website",
  "official_linked",
  "tavily_search",
  "third_party",
  "google_review",
  "web_snippet",
]);

export const SourceTier = z.enum([
  "official_site",
  "official_linked",
  "official_domain_search",
  "unverified_asset",
  "third_party",
]);

export const FactKind = z.enum(["retrieved", "extracted", "inferred"]);

export const SourceSchema = z.object({
  id: z.string().min(1),
  provider: SourceProvider,
  url: httpUrl.optional(),
  fetchedAt: z.iso.datetime(),
  tier: SourceTier.optional(),
  label: z.string().min(1).max(120),
});

export const Confidence = z.number().min(0).max(1);

export const sourced = <T extends z.ZodType>(value: T) =>
  z.object({
    value,
    sourceId: z.string().min(1),
    kind: FactKind,
  });

export const LatLng = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export type Source = z.infer<typeof SourceSchema>;
export type SourceTierValue = z.infer<typeof SourceTier>;
export type FactKindValue = z.infer<typeof FactKind>;
