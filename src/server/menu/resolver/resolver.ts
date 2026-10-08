import type { z } from "zod";
import type { SourceTier } from "@/schemas/common";
import type { MenuResolution, ReadabilityValue, ResolverUnreadableReasonValue, StageAttempt } from "@/schemas/menuResolution";
import type { EventEmitter } from "../../agent/events";
import type { Fetcher, WebSearchProvider } from "../../providers/types";
import { TavilyError } from "../../providers/tavily/client";
import { DEFAULT_RESOLVER_LIMITS, ResolverBudget, type ResolverLimits } from "./budget";
import {
  CandidateTable,
  TIER_RANK,
  markAlternates,
  markVenueVariants,
  computeConfidence,
  guessMediaType,
  hostKindOf,
  isOfficialTier,
  isSelectable,
  toSummary,
  type Candidate,
} from "./candidateTable";
import { classifyCandidate, isFoodLike } from "./classify";
import { ResolverFetcher, type ResolverSharedCache } from "./fetcher";
import { analyzeHtml, contentFactsFromText, parseSitemapUrls, type PageAnalysis, type PageLink } from "./htmlInspector";
import { IDENTITY_ACCEPT, IDENTITY_REJECT, assessIdentity, nameTokens, type RestaurantIdentity } from "./identity";
import { MENU_TERMS, SET_MENU_TERMS, DESSERT_TERMS, DRINKS_TERMS, URL_STEMS, urlHasStem } from "./lexicon";
import { createLimiter, type Limiter } from "./limiter";
import { samplePdf } from "./pdfProbe";
import { httpsVariant, normalizeUrl, sameSite } from "./urlNormalize";

type SourceTierValue = z.infer<typeof SourceTier>;

export interface ResolverRestaurant {
  placeId: string;
  name: string;
  address?: string;
  city: string;
  websiteUrl?: string;
  websiteHttpsCandidate?: string;
}

export interface ResolverLimiters {
  fetch: Limiter;
  tavily: Limiter;
}

export interface ResolverDeps {
  fetcher: Fetcher;
  search?: WebSearchProvider;
  emitter?: EventEmitter;
  limits?: Partial<ResolverLimits>;
  limiters?: ResolverLimiters;
  signal?: AbortSignal;
  now?: () => number;
  sharedCache?: ResolverSharedCache;
}

const LANGUAGE_LABEL = /^(castellano|espanol|español|spanish|english|ingles|inglés|catala|català|catalan|catalán|french|frances|français|deutsch|german|italiano)$/i;
function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

const LANDING_THRESHOLD = 0.4;
const MENU_FLOOR = 0.55;
const SEARCH_RESULTS = 8;

function stageAttempt(stage: StageAttempt["stage"], found: boolean, candidates: number, before: ReturnType<ResolverBudget["snapshot"]>, after: ReturnType<ResolverBudget["snapshot"]>, queries: string[] = [], note?: string): StageAttempt {
  return {
    stage,
    found,
    candidates,
    directFetches: after.directFetches - before.directFetches,
    tavilySearches: after.tavilySearches - before.tavilySearches,
    tavilyExtracts: after.tavilyExtracts - before.tavilyExtracts,
    queries,
    note,
  };
}

class ResolverRun {
  readonly budget: ResolverBudget;
  readonly limits: ResolverLimits;
  readonly table: CandidateTable;
  readonly fetcher: ResolverFetcher;
  readonly stages: StageAttempt[] = [];
  readonly warnings: string[] = [];
  readonly identity: RestaurantIdentity;
  officialDomain?: string;
  officialBase?: string;
  httpsUpgrade?: { attempted: boolean; succeeded: boolean; url?: string };
  readonly tavilyLimiter: Limiter;
  readonly started: number;
  readonly now: () => number;

  constructor(
    readonly r: ResolverRestaurant,
    readonly deps: ResolverDeps,
  ) {
    this.limits = { ...DEFAULT_RESOLVER_LIMITS, ...deps.limits };
    this.budget = new ResolverBudget(this.limits);
    this.table = new CandidateTable(r.placeId, this.limits.maxCandidates);
    const fetchLimiter = deps.limiters?.fetch ?? createLimiter(4);
    this.tavilyLimiter = deps.limiters?.tavily ?? createLimiter(2);
    this.fetcher = new ResolverFetcher(deps.fetcher, this.budget, fetchLimiter, deps.signal, { timeoutMs: this.limits.pageTimeoutMs }, deps.sharedCache?.fetch);
    this.identity = { name: r.name, address: r.address, city: r.city, websiteUrl: r.websiteUrl };
    this.officialDomain = r.websiteUrl ? normalizeUrl(r.websiteUrl)?.registrableDomain : undefined;
    this.now = deps.now ?? Date.now;
    this.started = this.now();
  }

  get aborted(): boolean {
    return this.deps.signal?.aborted === true || this.now() - this.started > this.limits.restaurantDeadlineMs;
  }

  // ---------------------------------------------------------------- events
  emitStep(status: "started" | "progress" | "done" | "warning" | "failed", detail?: string): void {
    this.deps.emitter?.emit({ type: "restaurant.step", id: this.r.placeId, step: "menu", status, ...(detail ? { detail } : {}) });
  }

  emitStage(stage: StageAttempt["stage"], found: boolean, candidates: number): void {
    const best = this.best(() => true);
    this.deps.emitter?.emit({
      type: "menu.stage",
      id: this.r.placeId,
      stage,
      found,
      candidates,
      ...(found && best ? { sourceTier: best.tier, documentKind: best.kind, mediaType: best.mediaType } : {}),
    });
  }

  emitTool(name: "web_search" | "web_extract", label: string): void {
    this.deps.emitter?.emit({ type: "tool", id: this.r.placeId, name, label });
  }

  best(filter: (c: Candidate) => boolean): Candidate | undefined {
    return this.table
      .all()
      .filter((c) => !c.rejectedReason && isSelectable(c) && filter(c))
      .sort((a, b) => b.confidence - a.confidence)[0];
  }

  // ------------------------------------------------------------ candidates
  addFromLink(link: PageLink, pageUrl: string, opts: { viaMenuPage: boolean; official: boolean }): Candidate | undefined {
    const n = normalizeUrl(link.url);
    if (!n) return undefined;
    const hostKind = hostKindOf(link.url, this.officialDomain);
    if (hostKind === "social") return undefined;
    const media = guessMediaType(link.url, hostKind);
    const label = `${link.anchorText} ${link.title}`;
    const languageLabel = LANGUAGE_LABEL.test(link.anchorText.trim());
    const interesting =
      MENU_TERMS.test(label) ||
      SET_MENU_TERMS.test(label) ||
      DRINKS_TERMS.test(label) ||
      DESSERT_TERMS.test(label) ||
      urlHasStem(urlPath(link.url), [...URL_STEMS.food, ...URL_STEMS.drinks, ...URL_STEMS.dessert, ...URL_STEMS.set]) ||
      media === "pdf" ||
      media === "image" ||
      media === "viewer" ||
      hostKind === "menu_host" ||
      (opts.viaMenuPage && hostKind !== "official" && (languageLabel || link.kind !== "image"));
    if (!interesting) return undefined;
    if (hostKind === "official" && n.comparisonKey === normalizeUrl(pageUrl)?.comparisonKey) return undefined;

    const external = hostKind !== "official";
    const tier: SourceTierValue = external ? "official_linked" : "official_site";
    const via = link.kind === "iframe" ? "site_iframe" : link.kind === "embedded" ? "site_embedded" : link.kind === "image" ? "site_image" : "site_link";
    const cls = classifyCandidate({
      url: link.url,
      anchorText: link.anchorText,
      title: link.title,
      context: link.context,
      mediaType: media,
      viaMenuPage: opts.viaMenuPage,
      linkedFromOfficial: opts.official && external,
      languageLabel,
    });
    const identity = assessIdentity(this.identity, { url: link.url, text: `${link.anchorText} ${link.title}`, linkedFromOfficial: opts.official && external });
    return this.table.add({
      url: link.url,
      via,
      fromUrl: pageUrl,
      anchorText: link.anchorText,
      title: link.title,
      context: link.context,
      tier,
      hostKind,
      mediaType: media,
      kind: cls.documentKind,
      likelihood: cls.menuLikelihood,
      identity,
      signals: cls.signals,
      viaMenuPage: opts.viaMenuPage,
      linkedFromOfficial: opts.official && external,
    });
  }

  harvest(page: PageAnalysis, pageUrl: string, viaMenuPage: boolean): Candidate[] {
    const added: Candidate[] = [];
    for (const link of page.links.slice(0, this.limits.maxLinksInspected)) {
      const c = this.addFromLink(link, pageUrl, { viaMenuPage, official: true });
      if (c) added.push(c);
    }
    return added;
  }

  reclassify(c: Candidate): void {
    const cls = classifyCandidate({
      url: c.url,
      anchorText: c.anchorText,
      title: c.title,
      context: c.context,
      mediaType: c.mediaType,
      viaMenuPage: c.viaMenuPage,
      linkedFromOfficial: c.linkedFromOfficial,
      languageLabel: LANGUAGE_LABEL.test(c.anchorText.trim()),
      facts: c.facts,
      readableHtml: c.readability === "readable" && (c.mediaType === "html" || c.mediaType === "external_host"),
    });
    c.kind = cls.documentKind;
    c.likelihood = cls.menuLikelihood;
    c.signals = cls.signals;
    const unreadableOfficialLink = isOfficialTier(c.tier) && isFoodLike(c.kind) && c.likelihood >= 0.5 && (c.readability === "js_only" || c.readability === "blocked" || c.readability === "unsupported_format");
    if (unreadableOfficialLink && c.likelihood < MENU_FLOOR) {
      c.likelihood = MENU_FLOOR;
      c.notes.push("official menu link that could not be read");
    }
    c.confidence = computeConfidence(c);
  }

  async inspectPdf(c: Candidate, bytes: Uint8Array): Promise<void> {
    c.mediaType = "pdf";
    const sample = await samplePdf(bytes);
    c.pageCount = sample?.pageCount;
    if (sample) c.facts = contentFactsFromText(sample.sampleText);
    if (sample?.looksScanned) c.notes.push("pdf has little or no text layer (likely scanned)");
    c.readability = "readable";
    this.reassessIdentity(c, sample?.sampleText ?? "");
    this.reclassify(c);
  }

  setUnreadable(c: Candidate, readability: ReadabilityValue, reason: ResolverUnreadableReasonValue): void {
    c.readability = readability;
    c.unreadableReason = reason;
  }

  reassessIdentity(c: Candidate, sampleText: string): void {
    if (isOfficialTier(c.tier) && c.tier !== "official_domain_search") return;
    c.identity = assessIdentity(this.identity, {
      url: c.url,
      text: `${c.title} ${c.context} ${sampleText}`.slice(0, 20_000),
      linkedFromOfficial: c.linkedFromOfficial,
    });
    if (c.identity.mismatch || c.identity.confidence < IDENTITY_REJECT) {
      c.rejectedReason = `identity mismatch (${c.identity.reasons.join("; ") || "no evidence"})`;
    }
    c.confidence = computeConfidence(c);
  }

  // -------------------------------------------------------------- probing
  async tryExtract(c: Candidate, why: "blocked" | "js_only"): Promise<boolean> {
    const search = this.deps.search;
    if (!search || !this.budget.canExtract() || this.aborted) return false;
    this.budget.recordExtract(1);
    this.emitTool("web_extract", why === "blocked" ? "Reading a page that blocks simple fetching" : "Reading a page that needs scripts");
    try {
      const { pages } = await this.tavilyLimiter.run(() => search.extract([c.url], {}, { signal: this.deps.signal }));
      const page = pages[0];
      if (!page || page.text.trim().length < 80) return false;
      const facts = contentFactsFromText(page.text);
      c.facts = facts;
      c.probeVia = "tavily_extract";
      const menuLike = facts.sectionHits >= 1 || facts.dishLineCount >= 8;
      if (!menuLike || facts.textChars < 400) return false;
      c.readability = "readable";
      c.unreadableReason = undefined;
      this.deps.sharedCache?.extractedText.set(c.normalized.comparisonKey, page.text);
      if (c.mediaType === "unknown") c.mediaType = c.hostKind === "menu_host" ? "external_host" : "html";
      this.reassessIdentity(c, page.text);
      this.reclassify(c);
      return true;
    } catch (err) {
      if (err instanceof TavilyError && err.code === "aborted") return false;
      this.warnings.push(`Tavily extract failed for ${c.normalized.host}: ${err instanceof TavilyError ? err.code : "error"}`);
      return false;
    }
  }

  async probe(c: Candidate): Promise<void> {
    if (c.probed || c.rejectedReason || this.aborted) return;
    if (c.mediaType === "viewer") {
      c.probed = true;
      this.setUnreadable(c, "viewer", "flipbook_viewer");
      return;
    }
    const out = await this.fetcher.get(c.url, { html: c.mediaType !== "pdf" && c.mediaType !== "image" });
    if (out.errorCode === "budget_exhausted") return;
    c.probed = true;
    c.probeVia = "direct";

    if (!out.result) {
      this.setUnreadable(c, "fetch_failed", "fetch_failed");
      return;
    }
    const res = out.result;
    if (!res.ok) {
      if (res.blockedByServer) {
        this.setUnreadable(c, "blocked", "blocked");
        if (c.likelihood >= LANDING_THRESHOLD) await this.tryExtract(c, "blocked");
        this.reclassify(c);
      } else this.setUnreadable(c, "fetch_failed", "fetch_failed");
      return;
    }

    switch (res.kind) {
      case "pdf":
        await this.inspectPdf(c, res.bytes);
        return;
      case "jpeg":
      case "png":
      case "webp":
        c.mediaType = "image";
        c.readability = "readable";
        this.reclassify(c);
        return;
      case "html":
      case "text": {
        const page = analyzeHtml(Buffer.from(res.bytes).toString("utf8"), res.url);
        c.title = c.title || page.title;
        c.facts = page.facts;
        if (c.mediaType === "unknown") c.mediaType = c.hostKind === "menu_host" ? "external_host" : "html";
        if (page.isJsShell) {
          this.setUnreadable(c, "js_only", "js_only");
          if (c.likelihood >= LANDING_THRESHOLD || c.hostKind === "menu_host") await this.tryExtract(c, "js_only");
        } else {
          c.readability = "readable";
          this.reassessIdentity(c, page.text);
        }
        this.reclassify(c);
        return;
      }
      default:
        this.setUnreadable(c, "unsupported_format", "unsupported_format");
        this.reclassify(c);
    }
  }

  markCandidateGroups(): void {
    markAlternates(this.table.all());
    markVenueVariants(this.table.all(), nameTokens(this.r.name));
  }

  async probeMany(list: Candidate[]): Promise<void> {
    this.markCandidateGroups();
    const todo = list
      .filter((c) => !c.probed && !c.rejectedReason && !c.alternateOf && c.kind !== "not_a_menu" && c.likelihood >= 0.2)
      .sort((a, b) => b.likelihood - a.likelihood)
      .slice(0, this.limits.maxProbes);
    const wave = 4;
    for (let i = 0; i < todo.length && !this.aborted; i += wave) {
      if (this.table.all().filter((c) => isOfficialTier(c.tier) && isSelectable(c) && c.readability === "readable").length >= this.limits.maxSelected) break;
      await Promise.all(todo.slice(i, i + wave).map((c) => this.probe(c)));
    }
  }

  // ---------------------------------------------------------- site stage
  async fetchBase(): Promise<{ url: string; analysis?: PageAnalysis; directKind?: "pdf" | "image" } | undefined> {
    const raw = this.r.websiteUrl;
    if (!raw) return undefined;
    const parsed = normalizeUrl(raw);
    if (!parsed) return undefined;

    let target = raw;
    if (parsed.originalUrl.startsWith("http:")) {
      const upgraded = this.r.websiteHttpsCandidate ?? httpsVariant(raw);
      this.httpsUpgrade = { attempted: Boolean(upgraded), succeeded: false, url: upgraded };
      if (!upgraded) {
        this.warnings.push("Official website is http-only and no https variant exists");
        return undefined;
      }
      target = upgraded;
    }

    const out = await this.fetcher.get(target, { html: true });
    if (this.httpsUpgrade && out.result?.ok) this.httpsUpgrade.succeeded = true;
    if (!out.result || !out.result.ok) {
      if (this.httpsUpgrade) this.warnings.push("https upgrade of the official website failed; http is never fetched");
      else this.warnings.push(`Official website could not be fetched (${out.result?.status ?? out.errorCode})`);
      if (out.result?.blockedByServer && this.deps.search && this.budget.canExtract()) return this.extractBase(target);
      return undefined;
    }
    this.officialBase = out.result.url;
    this.officialDomain = normalizeUrl(out.result.url)?.registrableDomain ?? this.officialDomain;
    if (out.result.kind === "pdf" || out.result.kind === "jpeg" || out.result.kind === "png" || out.result.kind === "webp") {
      return { url: out.result.url, directKind: out.result.kind === "pdf" ? "pdf" : "image" };
    }
    const analysis = analyzeHtml(Buffer.from(out.result.bytes).toString("utf8"), out.result.url);
    return { url: out.result.url, analysis };
  }

  async extractBase(target: string): Promise<{ url: string; analysis?: PageAnalysis } | undefined> {
    const search = this.deps.search;
    if (!search) return undefined;
    this.budget.recordExtract(1);
    this.emitTool("web_extract", "Reading a page that blocks simple fetching");
    try {
      const { pages } = await this.tavilyLimiter.run(() => search.extract([target], {}, { signal: this.deps.signal }));
      const page = pages[0];
      if (!page) return undefined;
      this.officialBase = target;
      this.officialDomain = normalizeUrl(target)?.registrableDomain ?? this.officialDomain;
      const links: PageLink[] = page.linkUrls.map((url) => ({ url, kind: "anchor", anchorText: "", title: "", context: "" }));
      const facts = contentFactsFromText(page.text);
      return { url: target, analysis: { title: "", text: page.text, links, scriptCount: 0, isJsShell: false, facts } };
    } catch {
      return undefined;
    }
  }

  async siteStage(): Promise<void> {
    const before = this.budget.snapshot();
    this.emitStep("started", "Checking their website");
    const base = await this.fetchBase();
    if (!base) {
      this.stages.push(stageAttempt("site", false, 0, before, this.budget.snapshot(), [], this.r.websiteUrl ? "website unreachable" : "no website listed"));
      this.emitStage("site", false, 0);
      return;
    }

    if (base.directKind) {
      this.table.add({
        url: base.url,
        via: "places_website",
        tier: "official_site",
        hostKind: "official",
        mediaType: base.directKind,
        kind: "food_menu",
        likelihood: 0.7,
        identity: { confidence: 1, mismatch: false, reasons: ["official website is the document"] },
        signals: ["website itself is a menu document"],
      });
    } else if (base.analysis) {
      const home = base.analysis;
      this.harvest(home, base.url, false);
      const f = home.facts;
      if (f.sectionHits >= 3 && f.dishLineCount >= 12) {
        const cls = classifyCandidate({ url: base.url, anchorText: "", title: home.title, context: "", mediaType: "html", viaMenuPage: false, linkedFromOfficial: false, facts: f });
        if (isFoodLike(cls.documentKind)) {
          const c = this.table.add({
            url: base.url,
            via: "places_website",
            tier: "official_site",
            hostKind: "official",
            mediaType: "html",
            kind: cls.documentKind,
            likelihood: Math.max(cls.menuLikelihood, 0.6),
            identity: { confidence: 1, mismatch: false, reasons: ["official homepage"] },
            signals: [...cls.signals, "homepage contains the menu"],
          });
          if (c) {
            c.facts = f;
            c.probed = true;
            c.readability = "readable";
            c.probeVia = "direct";
          }
        }
      }
      await this.followInternalPages(base.url);
    }

    await this.probeMany(this.table.all().filter((c) => c.tier === "official_site" || c.tier === "official_linked"));

    if (!this.best((c) => isOfficialTier(c.tier))) await this.sitemapFallback(base.url);

    const official = this.table.all().filter((c) => isOfficialTier(c.tier) && isSelectable(c));
    this.stages.push(stageAttempt("site", official.length > 0, this.table.size, before, this.budget.snapshot()));
    this.emitStage("site", official.length > 0, this.table.size);
  }

  async followInternalPages(homeUrl: string): Promise<void> {
    this.markCandidateGroups();
    const pages = this.table
      .all()
      .filter((c) => !c.alternateOf && c.hostKind === "official" && (c.mediaType === "unknown" || c.mediaType === "html") && !c.probed && c.kind !== "not_a_menu" && c.likelihood >= 0.3)
      .sort((a, b) => b.likelihood - a.likelihood)
      .slice(0, this.limits.maxInternalPages);

    await Promise.all(
      pages.map(async (c) => {
        const out = await this.fetcher.get(c.url, { html: true });
        if (out.errorCode === "budget_exhausted") return;
        c.probed = true;
        c.probeVia = "direct";
        const res = out.result;
        if (!res || !res.ok) {
          this.setUnreadable(c, res?.blockedByServer ? "blocked" : "fetch_failed", res?.blockedByServer ? "blocked" : "fetch_failed");
          return;
        }
        if (res.kind === "pdf") {
          await this.inspectPdf(c, res.bytes);
          return;
        }
        if (res.kind === "jpeg" || res.kind === "png" || res.kind === "webp") {
          c.mediaType = "image";
          c.readability = "readable";
          this.reclassify(c);
          return;
        }
        if (res.kind !== "html" && res.kind !== "text") {
          this.setUnreadable(c, "unsupported_format", "unsupported_format");
          this.reclassify(c);
          return;
        }
        const page = analyzeHtml(Buffer.from(res.bytes).toString("utf8"), res.url);
        c.title = page.title;
        c.facts = page.facts;
        c.mediaType = "html";
        if (page.isJsShell) {
          this.setUnreadable(c, "js_only", "js_only");
          await this.tryExtract(c, "js_only");
        } else c.readability = "readable";
        this.reclassify(c);
        const landing = c.likelihood >= LANDING_THRESHOLD || page.facts.sectionHits >= 2;
        if (landing) {
          const children = this.harvest(page, res.url, true);
          const linksToMenuAsset = children.some((k) => k.hostKind !== "official" && (k.mediaType === "viewer" || k.mediaType === "pdf" || k.mediaType === "image" || k.mediaType === "external_host") && k.likelihood >= MENU_FLOOR);
          if (linksToMenuAsset && page.facts.sectionHits < 3) {
            c.kind = "unknown";
            c.likelihood = Math.min(c.likelihood, 0.45);
            c.notes.push("menu landing page that links to the menu itself");
            c.confidence = computeConfidence(c);
          }
        }
      }),
    );
    void homeUrl;
  }

  async sitemapFallback(homeUrl: string): Promise<void> {
    let origin: string;
    try {
      origin = new URL(homeUrl).origin;
    } catch {
      return;
    }
    const queue = [`${origin}/sitemap.xml`];
    const urls: string[] = [];
    let fetched = 0;
    while (queue.length && fetched < this.limits.maxSitemapFetches && urls.length < this.limits.maxSitemapUrls && !this.aborted) {
      const next = queue.shift()!;
      const out = await this.fetcher.get(next, {});
      fetched++;
      if (!out.result?.ok || (out.result.kind !== "text" && out.result.kind !== "html")) continue;
      const parsed = parseSitemapUrls(Buffer.from(out.result.bytes).toString("utf8"), this.limits.maxSitemapUrls - urls.length);
      urls.push(...parsed.urls);
      for (const child of parsed.childSitemaps.slice(0, 2)) if (sameSite(child, homeUrl)) queue.push(child);
    }
    const added: Candidate[] = [];
    for (const url of urls) {
      if (!sameSite(url, homeUrl) || !urlHasStem(urlPath(url), [...URL_STEMS.food, ...URL_STEMS.set, ...URL_STEMS.dessert])) continue;
      if (urlHasStem(urlPath(url), URL_STEMS.legal)) continue;
      const cls = classifyCandidate({ url, anchorText: "", title: "", context: "", mediaType: guessMediaType(url, "official"), viaMenuPage: false, linkedFromOfficial: false });
      const c = this.table.add({
        url,
        via: "sitemap",
        tier: "official_site",
        hostKind: "official",
        mediaType: guessMediaType(url, "official"),
        kind: cls.documentKind,
        likelihood: cls.menuLikelihood,
        identity: { confidence: 1, mismatch: false, reasons: ["same domain"] },
        signals: [...cls.signals, "found in sitemap"],
      });
      if (c) added.push(c);
      if (added.length >= 5) break;
    }
    await this.probeMany(added);
  }

  // ------------------------------------------------------- search stages
  async searchQuery(query: string, via: "search" | "search_assets" | "search_third_party"): Promise<Candidate[]> {
    const search = this.deps.search;
    if (!search || !this.budget.canSearch() || this.aborted) return [];
    this.budget.recordSearch(1);
    this.emitTool("web_search", `Searching the web for ${this.r.name}'s menu`);
    let hits;
    try {
      hits = await this.tavilyLimiter.run(() => search.search(query, { maxResults: SEARCH_RESULTS }, { signal: this.deps.signal }));
    } catch (err) {
      this.warnings.push(`Tavily search failed: ${err instanceof TavilyError ? err.code : "error"}`);
      return [];
    }
    const added: Candidate[] = [];
    for (const hit of hits) {
      const n = normalizeUrl(hit.url);
      if (!n) continue;
      const hostKind = hostKindOf(hit.url, this.officialDomain);
      if (hostKind === "social") continue;
      if (hostKind === "third_party" && via !== "search_third_party") continue;
      if (via === "search_third_party" && hostKind !== "third_party") continue;
      const media = guessMediaType(hit.url, hostKind);
      const cls = classifyCandidate({ url: hit.url, anchorText: hit.title, title: "", context: hit.snippet, mediaType: media, viaMenuPage: false, linkedFromOfficial: false });
      const tier: SourceTierValue = hostKind === "official" ? "official_domain_search" : hostKind === "third_party" ? "third_party" : "unverified_asset";
      const identity = assessIdentity(this.identity, { url: hit.url, text: `${hit.title} ${hit.snippet}`, linkedFromOfficial: false });
      const c = this.table.add({
        url: hit.url,
        via,
        anchorText: hit.title,
        context: hit.snippet,
        tier,
        hostKind,
        mediaType: media,
        kind: cls.documentKind,
        likelihood: cls.menuLikelihood,
        identity,
        signals: cls.signals,
      });
      if (!c) continue;
      if (tier !== "official_domain_search" && (identity.mismatch || identity.confidence < IDENTITY_REJECT)) {
        c.rejectedReason = `identity mismatch (${identity.reasons.join("; ") || "no evidence"})`;
      }
      c.confidence = computeConfidence(c);
      added.push(c);
    }
    await this.probeMany(added);
    return added;
  }

  hasReadableMenu(): boolean {
    return this.table.all().some((c) => isSelectable(c) && c.readability === "readable" && (c.tier !== "unverified_asset" || c.identity.confidence >= IDENTITY_ACCEPT) && c.tier !== "third_party");
  }

  needsFallback(): boolean {
    if (this.hasReadableMenu()) return false;
    const official = this.table.all().filter((c) => isOfficialTier(c.tier) && isSelectable(c));
    if (official.some((c) => c.readability === "viewer")) return false;
    return true;
  }

  async searchStages(): Promise<void> {
    const city = this.r.city;
    const name = this.r.name;
    const domain = this.officialDomain;

    let before = this.budget.snapshot();
    const queries: string[] = [];
    let added = 0;
    if (domain && this.table.all().filter((c) => isOfficialTier(c.tier) && isSelectable(c)).length === 0) {
      const q = `site:${domain} carta OR menu OR menú`;
      queries.push(q);
      added += (await this.searchQuery(q, "search")).length;
    }
    if (!this.hasReadableMenu()) {
      const q = `"${name}" ${city} carta menú`;
      queries.push(q);
      added += (await this.searchQuery(q, "search")).length;
    }
    this.stages.push(stageAttempt("search", this.hasReadableMenu(), added, before, this.budget.snapshot(), queries));
    this.emitStage("search", this.hasReadableMenu(), added);

    if (!this.hasReadableMenu() && !this.aborted && this.budget.canSearch()) {
      before = this.budget.snapshot();
      const q = `"${name}" ${city} carta filetype:pdf`;
      const found = await this.searchQuery(q, "search_assets");
      this.stages.push(stageAttempt("assets", this.hasReadableMenu(), found.length, before, this.budget.snapshot(), [q]));
      this.emitStage("assets", this.hasReadableMenu(), found.length);
    }

    const anyUsable = this.table.all().some((c) => isSelectable(c) && !c.rejectedReason && c.readability === "readable");
    if (!anyUsable && !this.aborted && this.budget.canSearch()) {
      before = this.budget.snapshot();
      const q = `"${name}" ${city} menu prices`;
      const found = await this.searchQuery(q, "search_third_party");
      const ok = this.table.all().some((c) => c.tier === "third_party" && isSelectable(c) && c.readability === "readable");
      this.stages.push(stageAttempt("third_party", ok, found.length, before, this.budget.snapshot(), [q]));
      this.emitStage("third_party", ok, found.length);
    }
  }

  // ------------------------------------------------------------- decision
  finalize(): MenuResolution {
    const durationMs = this.now() - this.started;
    const usage = this.budget.snapshot();
    const candidates = this.table.all();
    for (const c of candidates) c.confidence = computeConfidence(c);

    const readable = candidates.filter((c) => isSelectable(c) && c.readability === "readable");
    const official = readable.filter((c) => isOfficialTier(c.tier));
    let pool: Candidate[] = official;
    if (official.length === 0) {
      const verified = readable.filter((c) => c.identity.confidence >= IDENTITY_ACCEPT);
      const source = verified.length ? verified : readable;
      const topRank = source.length ? Math.max(...source.map((c) => TIER_RANK[c.tier])) : 0;
      pool = source.filter((c) => TIER_RANK[c.tier] === topRank);
    }
    const kindOrder: Partial<Record<Candidate["kind"], number>> = { food_menu: 0, set_menu_or_groups: 1, dessert_menu: 2 };
    const selected = pool
      .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9) || b.likelihood - a.likelihood)
      .slice(0, this.limits.maxSelected);
    for (const c of selected) c.selected = true;

    const summary = candidates.map(toSummary);
    const base = {
      restaurantId: this.r.placeId,
      restaurantName: this.r.name,
      candidates: summary,
      stages: this.stages,
      warnings: this.warnings,
      usage,
      httpsUpgrade: this.httpsUpgrade
        ? { attempted: this.httpsUpgrade.attempted, succeeded: this.httpsUpgrade.succeeded, url: this.httpsUpgrade.url }
        : undefined,
      durationMs,
    };

    const bestOfficial = candidates.filter((c) => isOfficialTier(c.tier) && isSelectable(c)).sort((a, b) => b.confidence - a.confidence)[0];

    if (selected.length > 0) {
      return {
        ...base,
        status: "resolved",
        candidates: candidates.map(toSummary),
        selected: selected.map(toSummary),
        officialMenuUrl: bestOfficial?.url,
        confidence: Math.max(...selected.map((c) => c.confidence)),
      };
    }

    const unreadable = candidates
      .filter((c) => isOfficialTier(c.tier) && isSelectable(c) && c.readability !== "readable" && c.readability !== "not_probed")
      .sort((a, b) => (a.readability === "viewer" ? 0 : 1) - (b.readability === "viewer" ? 0 : 1) || b.confidence - a.confidence);
    if (unreadable.length > 0) {
      const top = unreadable[0];
      return {
        ...base,
        status: "found_but_unreadable",
        selected: [],
        officialMenuUrl: top.url,
        unreadableReason: top.unreadableReason ?? "fetch_failed",
        confidence: top.confidence,
      };
    }

    const identityRejected = candidates.filter((c) => c.rejectedReason?.startsWith("identity")).length;
    const plausible = candidates.filter((c) => !c.rejectedReason && isSelectable(c)).length;
    const reason = !this.r.websiteUrl && candidates.length === 0 ? "no_website" : identityRejected > 0 && plausible === 0 ? "identity_mismatch" : "no_menu_found";
    return { ...base, status: "unavailable", selected: [], unavailableReason: reason };
  }

  failed(reason: "aborted" | "internal_error", message: string): MenuResolution {
    return {
      restaurantId: this.r.placeId,
      restaurantName: this.r.name,
      status: "failed",
      selected: [],
      failureReason: reason,
      message: message.slice(0, 300),
      candidates: this.table.all().map(toSummary),
      stages: this.stages,
      warnings: this.warnings,
      usage: this.budget.snapshot(),
      durationMs: this.now() - this.started,
    };
  }
}

export async function resolveMenu(restaurant: ResolverRestaurant, deps: ResolverDeps): Promise<MenuResolution> {
  const run = new ResolverRun(restaurant, deps);
  try {
    await run.siteStage();
    if (run.aborted) return run.failed("aborted", "Resolution aborted or deadline reached");
    if (run.needsFallback()) await run.searchStages();
    if (deps.signal?.aborted) return run.failed("aborted", "Resolution aborted");
    const result = run.finalize();
    emitResolved(run, result);
    return result;
  } catch (err) {
    if (deps.signal?.aborted) return run.failed("aborted", "Resolution aborted");
    const failure = run.failed("internal_error", err instanceof Error ? err.name : "unknown error");
    run.emitStep("failed", "Menu research failed");
    return failure;
  }
}

function emitResolved(run: ResolverRun, result: MenuResolution): void {
  const emitter = run.deps.emitter;
  if (!emitter) return;
  if (result.status === "failed") {
    run.emitStep("failed", "Menu research failed");
    return;
  }
  const best = result.status === "resolved" ? result.selected[0] : undefined;
  emitter.emit({
    type: "menu.resolved",
    id: result.restaurantId,
    status: result.status === "resolved" ? "found" : result.status,
    documentCount: result.selected.length,
    ...(result.status === "resolved" && result.officialMenuUrl ? { officialMenuUrl: result.officialMenuUrl } : {}),
    ...(result.status === "found_but_unreadable" ? { officialMenuUrl: result.officialMenuUrl, reason: result.unreadableReason } : {}),
    ...(result.status === "unavailable" ? { reason: result.unavailableReason } : {}),
    ...(best ? { sourceTier: best.tier } : {}),
  });
  if (result.status === "resolved") run.emitStep("done", `${result.selected.length} menu document${result.selected.length === 1 ? "" : "s"} found`);
  else if (result.status === "found_but_unreadable") run.emitStep("warning", "Menu found but not readable automatically");
  else run.emitStep("warning", "No menu found online");
}

export async function resolveMenus(
  restaurants: ResolverRestaurant[],
  deps: Omit<ResolverDeps, "limiters"> & { restaurantConcurrency?: number; fetchConcurrency?: number; tavilyConcurrency?: number },
): Promise<MenuResolution[]> {
  const restaurantLimiter = createLimiter(deps.restaurantConcurrency ?? 3);
  const limiters: ResolverLimiters = { fetch: createLimiter(deps.fetchConcurrency ?? 6), tavily: createLimiter(deps.tavilyConcurrency ?? 2) };
  return Promise.all(restaurants.map((r) => restaurantLimiter.run(() => resolveMenu(r, { ...deps, limiters }))));
}

