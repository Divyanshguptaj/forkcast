import type { SafeFetchErrorCode, SafeFetchOptions, SafeFetchResult } from "../../providers/http/safeFetch";
import { SafeFetchError, safeFetch } from "../../providers/http/safeFetch";
import type { Fetcher } from "../../providers/types";
import type { ResolverBudget } from "./budget";
import type { Limiter } from "./limiter";
import { normalizeUrl } from "./urlNormalize";

export const defaultFetcher: Fetcher = { fetch: (url, opts) => safeFetch(url, opts) };

export interface FetchOutcome {
  url: string;
  result?: SafeFetchResult;
  errorCode?: SafeFetchErrorCode | "budget_exhausted";
  fromCache: boolean;
}

export class ResolverFetcher {
  readonly #cache = new Map<string, Promise<FetchOutcome>>();

  constructor(
    private readonly fetcher: Fetcher,
    private readonly budget: ResolverBudget,
    private readonly limiter: Limiter,
    private readonly signal?: AbortSignal,
    private readonly options: Pick<SafeFetchOptions, "timeoutMs"> = {},
  ) {}

  async get(url: string, kind: { html?: boolean } = {}): Promise<FetchOutcome> {
    const key = normalizeUrl(url)?.comparisonKey ?? url;
    const cached = this.#cache.get(key);
    if (cached) return { ...(await cached), fromCache: true };

    if (!this.budget.canFetch() || (kind.html && !this.budget.canFetchHtml())) {
      return { url, errorCode: "budget_exhausted", fromCache: false };
    }
    const pending = this.#run(url, kind.html === true);
    this.#cache.set(key, pending);
    return pending;
  }

  async #run(url: string, html: boolean): Promise<FetchOutcome> {
    try {
      const result = await this.limiter.run(() => this.fetcher.fetch(url, { signal: this.signal, timeoutMs: this.options.timeoutMs }));
      this.budget.recordFetch(result.bytes.byteLength, html || result.kind === "html");
      return { url, result, fromCache: false };
    } catch (err) {
      this.budget.recordFetch(0, html);
      const code = err instanceof SafeFetchError ? err.code : "network";
      return { url, errorCode: code, fromCache: false };
    }
  }
}
