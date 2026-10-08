export interface ResolverLimits {
  maxDirectFetches: number;
  maxHtmlPages: number;
  maxInternalPages: number;
  maxLinksInspected: number;
  maxCandidates: number;
  maxProbes: number;
  maxSitemapFetches: number;
  maxSitemapUrls: number;
  maxTavilySearches: number;
  maxTavilyExtracts: number;
  maxBytes: number;
  maxSelected: number;
  pageTimeoutMs: number;
  restaurantDeadlineMs: number;
}

export const DEFAULT_RESOLVER_LIMITS: ResolverLimits = {
  maxDirectFetches: 16,
  maxHtmlPages: 5,
  maxInternalPages: 3,
  maxLinksInspected: 400,
  maxCandidates: 40,
  maxProbes: 8,
  maxSitemapFetches: 3,
  maxSitemapUrls: 400,
  maxTavilySearches: 4,
  maxTavilyExtracts: 3,
  maxBytes: 40 * 1024 * 1024,
  maxSelected: 4,
  pageTimeoutMs: 8_000,
  restaurantDeadlineMs: 40_000,
};

export class ResolverBudget {
  directFetches = 0;
  htmlPages = 0;
  tavilySearches = 0;
  tavilyExtracts = 0;
  tavilyCredits = 0;
  geminiCalls = 0;
  bytesFetched = 0;

  constructor(readonly limits: ResolverLimits = DEFAULT_RESOLVER_LIMITS) {}

  canFetch(): boolean {
    return this.directFetches < this.limits.maxDirectFetches && this.bytesFetched < this.limits.maxBytes;
  }

  canFetchHtml(): boolean {
    return this.canFetch() && this.htmlPages < this.limits.maxHtmlPages;
  }

  canSearch(): boolean {
    return this.tavilySearches < this.limits.maxTavilySearches;
  }

  canExtract(): boolean {
    return this.tavilyExtracts < this.limits.maxTavilyExtracts;
  }

  recordFetch(bytes: number, html: boolean): void {
    this.directFetches++;
    this.bytesFetched += bytes;
    if (html) this.htmlPages++;
  }

  recordSearch(credits = 1): void {
    this.tavilySearches++;
    this.tavilyCredits += credits;
  }

  recordExtract(credits = 1): void {
    this.tavilyExtracts++;
    this.tavilyCredits += credits;
  }

  snapshot() {
    return {
      directFetches: this.directFetches,
      tavilySearches: this.tavilySearches,
      tavilyExtracts: this.tavilyExtracts,
      tavilyCredits: this.tavilyCredits,
      geminiCalls: this.geminiCalls,
      bytesFetched: this.bytesFetched,
    };
  }
}
