const PRO_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.businessStatus",
  "places.googleMapsUri",
] as const;

const ENTERPRISE_FIELDS = [
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.websiteUri",
  "places.regularOpeningHours",
] as const;

const VEGETARIAN_SIGNAL_FIELD = "places.servesVegetarianFood";

export function buildDiscoveryFieldMask(opts: { includeVegetarianSignal: boolean }): string {
  const fields: string[] = [...PRO_FIELDS, ...ENTERPRISE_FIELDS];
  if (opts.includeVegetarianSignal) fields.push(VEGETARIAN_SIGNAL_FIELD);
  return fields.join(",");
}
