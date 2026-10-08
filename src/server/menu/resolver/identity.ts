import { normalizeText } from "@/lib/text";
import { normalizeUrl, registrableDomain } from "./urlNormalize";

export interface RestaurantIdentity {
  name: string;
  address?: string;
  city: string;
  websiteUrl?: string;
}

export interface IdentityEvidence {
  url: string;
  text: string;
  linkedFromOfficial: boolean;
  linksToOfficialDomain?: boolean;
}

export interface IdentityAssessment {
  confidence: number;
  mismatch: boolean;
  reasons: string[];
}

export const IDENTITY_ACCEPT = 0.6;
export const IDENTITY_REJECT = 0.4;

const NAME_STOPWORDS = new Set([
  "restaurant",
  "restaurante",
  "restaurants",
  "bar",
  "cafe",
  "cafeteria",
  "bistro",
  "the",
  "el",
  "la",
  "els",
  "les",
  "los",
  "de",
  "del",
  "dels",
  "i",
  "y",
  "and",
  "a",
  "barcelona",
  "bcn",
  "italiano",
  "italiana",
  "italia",
  "cocktails",
  "cocteles",
]);

const STREET_WORDS = new Set(["carrer", "calle", "c", "cl", "avinguda", "avenida", "av", "passeig", "paseo", "passatge", "placa", "plaza", "ronda", "rambla", "via", "de", "del", "dels", "la", "el", "els", "les", "d", "l"]);

const ADDRESS_PATTERN = /\b(carrer|calle|c\/|passeig|paseo|passatge|avinguda|avenida|placa|plaza|ronda|rambla)\s+((?:de la |de les |de |del |dels |d'|l')?[a-z' ]{3,40}?)\s*,?\s*(\d{1,4})\b/gi;

export function nameTokens(name: string): string[] {
  const head = name.split(/\s[-–|]\s|\||\(/)[0];
  return normalizeText(head)
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !NAME_STOPWORDS.has(t));
}

export function streetTokens(address: string | undefined): string[] {
  if (!address) return [];
  const first = normalizeText(address.split(",")[0]);
  return first
    .replace(/[^a-z ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STREET_WORDS.has(t));
}

const compact = (text: string) => normalizeText(text).replace(/[^a-z0-9]/g, "");

function mentionsDomain(text: string, domain: string): boolean {
  const escaped = domain.toLowerCase().split(".").join("\\.");
  return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`).test(text.toLowerCase());
}

function foundStreets(text: string): string[][] {
  const out: string[][] = [];
  const normalized = normalizeText(text);
  for (const m of normalized.matchAll(ADDRESS_PATTERN)) {
    out.push(
      m[2]
        .replace(/[^a-z ]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STREET_WORDS.has(t)),
    );
  }
  return out;
}

export function assessIdentity(restaurant: RestaurantIdentity, evidence: IdentityEvidence): IdentityAssessment {
  const reasons: string[] = [];
  const candidate = normalizeUrl(evidence.url);
  const official = restaurant.websiteUrl ? normalizeUrl(restaurant.websiteUrl) : undefined;

  if (candidate && official && candidate.registrableDomain === official.registrableDomain) {
    return { confidence: 1, mismatch: false, reasons: ["same registrable domain as the official website"] };
  }

  const text = `${evidence.url} ${evidence.text}`;
  const flat = compact(text);
  const tokens = nameTokens(restaurant.name);
  const matched = tokens.filter((t) => flat.includes(t));
  const nameRatio = tokens.length ? matched.length / tokens.length : 0;

  const ours = streetTokens(restaurant.address);
  const streetMatch = ours.length > 0 && ours.some((t) => flat.includes(t));
  const found = foundStreets(text);
  const mismatch = ours.length > 0 && found.length > 0 && !streetMatch && !found.some((tokensOfStreet) => tokensOfStreet.some((t) => ours.includes(t)));

  let confidence = 0;
  if (evidence.linkedFromOfficial) {
    confidence = 0.85;
    reasons.push("linked directly from the official website");
    if (nameRatio >= 0.5) {
      confidence += 0.1;
      reasons.push("restaurant name appears in the link or url");
    }
  } else {
    confidence += nameRatio * 0.45;
    if (tokens.length) reasons.push(`name match ${matched.length}/${tokens.length}`);
    if (flat.includes(compact(restaurant.city))) {
      confidence += 0.1;
      reasons.push("city mentioned");
    }
    if (streetMatch) {
      confidence += 0.3;
      reasons.push("street name matches");
    }
    if (evidence.linksToOfficialDomain || (official && mentionsDomain(text, official.registrableDomain))) {
      confidence += 0.3;
      reasons.push("links to the official domain");
    }
  }

  if (mismatch) {
    confidence = Math.min(confidence, 0.2);
    reasons.push("page shows a different street address");
  }

  return { confidence: Math.min(1, Number(confidence.toFixed(3))), mismatch, reasons };
}

export { registrableDomain };
