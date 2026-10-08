import { FLIPBOOK_VIEWER_HOSTS, MENU_HOST_HINTS, SOCIAL_AND_MAP_HOSTS, THIRD_PARTY_ALLOWLIST, hostMatches } from "@/config/menuHosts";
import type { SourceTier } from "@/schemas/common";
import type { z } from "zod";
import type { CandidateSummary, DiscoveryViaValue, MenuMediaTypeValue, ReadabilityValue, ResolverDocumentKindValue, ResolverUnreadableReasonValue } from "@/schemas/menuResolution";
import { isFoodLike, MENU_LIKELIHOOD_THRESHOLD } from "./classify";
import type { ContentFacts } from "./htmlInspector";
import { IDENTITY_ACCEPT, type IdentityAssessment } from "./identity";
import { normalizeUrl, type NormalizedUrl } from "./urlNormalize";

type SourceTierValue = z.infer<typeof SourceTier>;

export type HostKind = "official" | "viewer" | "menu_host" | "third_party" | "social" | "other";

export const TIER_BASE: Record<SourceTierValue, number> = {
  official_site: 0.95,
  official_linked: 0.85,
  official_domain_search: 0.85,
  unverified_asset: 0.5,
  third_party: 0.4,
};

export const TIER_RANK: Record<SourceTierValue, number> = {
  official_site: 5,
  official_linked: 4,
  official_domain_search: 3,
  unverified_asset: 2,
  third_party: 1,
};

export const isOfficialTier = (tier: SourceTierValue): boolean => tier === "official_site" || tier === "official_linked" || tier === "official_domain_search";

export interface Candidate {
  id: string;
  url: string;
  normalized: NormalizedUrl;
  via: DiscoveryViaValue;
  fromUrl?: string;
  anchorText: string;
  title: string;
  context: string;
  tier: SourceTierValue;
  hostKind: HostKind;
  mediaType: MenuMediaTypeValue;
  kind: ResolverDocumentKindValue;
  readability: ReadabilityValue;
  likelihood: number;
  identity: IdentityAssessment;
  signals: string[];
  notes: string[];
  viaMenuPage: boolean;
  linkedFromOfficial: boolean;
  probed: boolean;
  probeVia?: "direct" | "tavily_extract";
  facts?: ContentFacts;
  pageCount?: number;
  unreadableReason?: ResolverUnreadableReasonValue;
  rejectedReason?: string;
  selected: boolean;
  confidence: number;
  alternateOf?: string;
}

export function hostKindOf(url: string, officialDomain: string | undefined): HostKind {
  const n = normalizeUrl(url);
  if (!n) return "other";
  if (officialDomain && n.registrableDomain === officialDomain) return "official";
  if (hostMatches(n.host, FLIPBOOK_VIEWER_HOSTS)) return "viewer";
  if (hostMatches(n.host, SOCIAL_AND_MAP_HOSTS)) return "social";
  if (hostMatches(n.host, THIRD_PARTY_ALLOWLIST)) return "third_party";
  if (hostMatches(n.host, MENU_HOST_HINTS)) return "menu_host";
  return "other";
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp)(?:[?#]|$)/i;
const PDF_EXT = /\.pdf(?:[?#]|$)/i;

export function guessMediaType(url: string, hostKind: HostKind): MenuMediaTypeValue {
  if (hostKind === "viewer") return "viewer";
  if (PDF_EXT.test(url)) return "pdf";
  if (IMAGE_EXT.test(url)) return "image";
  if (hostKind === "menu_host") return "external_host";
  return "unknown";
}

export function computeConfidence(c: Pick<Candidate, "tier" | "likelihood" | "identity">): number {
  const identityFactor = c.identity.confidence >= IDENTITY_ACCEPT || isOfficialTier(c.tier) ? 1 : 0.6;
  return Number((TIER_BASE[c.tier] * (0.55 + 0.45 * c.likelihood) * identityFactor).toFixed(3));
}

export interface CandidateInit {
  url: string;
  via: DiscoveryViaValue;
  fromUrl?: string;
  anchorText?: string;
  title?: string;
  context?: string;
  tier: SourceTierValue;
  hostKind: HostKind;
  mediaType: MenuMediaTypeValue;
  kind: ResolverDocumentKindValue;
  likelihood: number;
  identity: IdentityAssessment;
  signals: string[];
  viaMenuPage?: boolean;
  linkedFromOfficial?: boolean;
}

export class CandidateTable {
  readonly #byKey = new Map<string, Candidate>();
  #next = 1;

  constructor(
    readonly restaurantId: string,
    private readonly cap = 40,
  ) {}

  add(init: CandidateInit): Candidate | undefined {
    const normalized = normalizeUrl(init.url);
    if (!normalized) return undefined;
    const existing = this.#byKey.get(normalized.comparisonKey);
    if (existing) {
      if (TIER_RANK[init.tier] > TIER_RANK[existing.tier]) {
        existing.tier = init.tier;
        existing.linkedFromOfficial = existing.linkedFromOfficial || Boolean(init.linkedFromOfficial);
      }
      if (init.likelihood > existing.likelihood && !existing.probed) {
        existing.likelihood = init.likelihood;
        existing.kind = init.kind;
        existing.signals = init.signals;
        existing.anchorText = init.anchorText ?? existing.anchorText;
      }
      existing.viaMenuPage = existing.viaMenuPage || Boolean(init.viaMenuPage);
      return existing;
    }
    if (this.#byKey.size >= this.cap) return undefined;

    const candidate: Candidate = {
      id: `${this.restaurantId}#c${this.#next++}`,
      url: normalized.originalUrl,
      normalized,
      via: init.via,
      fromUrl: init.fromUrl,
      anchorText: init.anchorText ?? "",
      title: init.title ?? "",
      context: init.context ?? "",
      tier: init.tier,
      hostKind: init.hostKind,
      mediaType: init.mediaType,
      kind: init.kind,
      readability: "not_probed",
      likelihood: init.likelihood,
      identity: init.identity,
      signals: init.signals,
      notes: [],
      viaMenuPage: Boolean(init.viaMenuPage),
      linkedFromOfficial: Boolean(init.linkedFromOfficial),
      probed: false,
      selected: false,
      confidence: 0,
    };
    candidate.confidence = computeConfidence(candidate);
    this.#byKey.set(normalized.comparisonKey, candidate);
    return candidate;
  }

  all(): Candidate[] {
    return [...this.#byKey.values()];
  }

  byId(id: string): Candidate | undefined {
    return this.all().find((c) => c.id === id);
  }

  get size(): number {
    return this.#byKey.size;
  }
}

export function isSelectable(c: Candidate): boolean {
  return !c.rejectedReason && !c.alternateOf && isFoodLike(c.kind) && c.likelihood >= MENU_LIKELIHOOD_THRESHOLD;
}

const LANG_PREFIX = /^\/(?:es|en|ca|cat|fr|de|it|pt|nl|ru|zh|ja)(?=\/|$)/i;
const LANG_SUFFIX = /[-_](?:esp|eng|es|en|ca|cat|fr|de|it|castellano|english|catala)(?=\.[a-z0-9]+$|\/?$)/i;

export function alternateKey(c: Pick<Candidate, "normalized">): string {
  const host = c.normalized.host.replace(/^www\./, "");
  const rest = c.normalized.comparisonKey.slice(host.length);
  const queryAt = rest.indexOf("?");
  const path = queryAt === -1 ? rest : rest.slice(0, queryAt);
  const query = queryAt === -1 ? "" : rest.slice(queryAt);
  return `${host}${path.replace(LANG_PREFIX, "").replace(LANG_SUFFIX, "")}${query}`;
}

export function hasLanguageMarker(c: Pick<Candidate, "normalized">): boolean {
  const path = c.normalized.comparisonKey.slice(c.normalized.host.replace(/^www\./, "").length).replace(/\?.*$/, "");
  return LANG_PREFIX.test(path) || LANG_SUFFIX.test(path);
}

export function markAlternates(list: Candidate[]): void {
  const groups = new Map<string, Candidate[]>();
  for (const c of list) {
    if (c.alternateOf) continue;
    const key = alternateKey(c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Number(hasLanguageMarker(a)) - Number(hasLanguageMarker(b)) || b.likelihood - a.likelihood);
    const [primary, ...rest] = sorted;
    for (const c of rest) {
      if (c.normalized.comparisonKey === primary.normalized.comparisonKey) continue;
      c.alternateOf = primary.id;
      c.notes.push(`language or version alternate of ${primary.id}`);
    }
  }
}

export function toSummary(c: Candidate): CandidateSummary {
  return {
    id: c.id,
    url: c.url,
    normalizedUrl: c.normalized.normalizedUrl,
    tier: c.tier,
    mediaType: c.mediaType,
    documentKind: c.kind,
    readability: c.readability,
    menuLikelihood: c.likelihood,
    identityConfidence: c.identity.confidence,
    confidence: c.confidence,
    discoveredVia: c.via,
    discoveredFrom: c.fromUrl,
    anchorText: c.anchorText ? c.anchorText.slice(0, 120) : undefined,
    signals: [...c.signals, ...c.notes].slice(0, 14),
    selected: c.selected,
    rejectedReason: c.rejectedReason,
  };
}
