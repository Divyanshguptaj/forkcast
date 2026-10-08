import { z } from "zod";
import type { Env } from "@/config/env";
import type { CallContext, ExtractedPage, SearchHit, WebSearchProvider } from "../types";

const BASE_URL = "https://api.tavily.com";
const MAX_QUERY_CHARS = 300;
const MAX_URLS_PER_EXTRACT = 5;

export type TavilyErrorCode = "missing_api_key" | "bad_request" | "auth" | "rate_limited" | "server" | "timeout" | "aborted" | "network" | "invalid_response";

export class TavilyError extends Error {
  constructor(
    readonly code: TavilyErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TavilyError";
  }
}

const SearchResponse = z.object({
  results: z
    .array(z.object({ url: z.string(), title: z.string().optional().default(""), content: z.string().optional().default(""), score: z.number().optional() }))
    .optional()
    .default([]),
});

const ExtractResponse = z.object({
  results: z
    .array(z.object({ url: z.string(), raw_content: z.string().optional().default(""), images: z.array(z.string()).optional().default([]) }))
    .optional()
    .default([]),
  failed_results: z.array(z.object({ url: z.string(), error: z.string().optional().default("failed") })).optional().default([]),
});

export interface TavilyClientOptions {
  apiKey: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

function statusCode(status: number): TavilyErrorCode {
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status === 432 || status === 433) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_request";
}

const LINK_PATTERN = /\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"')\]]+)/gi;

export function linksFromText(text: string, max = 60): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(LINK_PATTERN)) {
    const url = (m[1] ?? m[2] ?? "").replace(/[.,;]+$/, "");
    if (url) out.add(url);
    if (out.size >= max) break;
  }
  return [...out];
}

export class TavilyClient implements WebSearchProvider {
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;

  constructor(opts: TavilyClientOptions) {
    if (!opts.apiKey) throw new TavilyError("missing_api_key", "Tavily API key is not configured");
    this.#apiKey = opts.apiKey;
    this.#timeoutMs = opts.timeoutMs ?? 12_000;
    this.#baseUrl = opts.baseUrl ?? BASE_URL;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  toJSON(): { provider: string } {
    return { provider: "tavily" };
  }

  async search(query: string, opts: { maxResults: number; includeImages?: boolean }, ctx: CallContext = {}): Promise<SearchHit[]> {
    const json = await this.#post("search", {
      query: query.slice(0, MAX_QUERY_CHARS),
      max_results: Math.min(Math.max(opts.maxResults, 1), 10),
      include_images: opts.includeImages ?? false,
      search_depth: "basic",
    }, ctx);
    const parsed = SearchResponse.safeParse(json);
    if (!parsed.success) throw new TavilyError("invalid_response", "Tavily search response had an unexpected shape");
    return parsed.data.results.map((r) => ({ url: r.url, title: r.title, snippet: r.content.slice(0, 500), score: r.score }));
  }

  async extract(
    urls: string[],
    opts: { includeImages?: boolean },
    ctx: CallContext = {},
  ): Promise<{ pages: ExtractedPage[]; failed: Array<{ url: string; error: string }> }> {
    const json = await this.#post("extract", { urls: urls.slice(0, MAX_URLS_PER_EXTRACT), include_images: opts.includeImages ?? false }, ctx);
    const parsed = ExtractResponse.safeParse(json);
    if (!parsed.success) throw new TavilyError("invalid_response", "Tavily extract response had an unexpected shape");
    return {
      pages: parsed.data.results.map((r) => ({ url: r.url, text: r.raw_content, imageUrls: r.images, linkUrls: linksFromText(r.raw_content) })),
      failed: parsed.data.failed_results.map((f) => ({ url: f.url, error: f.error.slice(0, 120) })),
    };
  }

  async #post(path: string, body: Record<string, unknown>, ctx: CallContext): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;
    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (ctx.signal?.aborted) throw new TavilyError("aborted", "Tavily request aborted");
      if (timeout.aborted) throw new TavilyError("timeout", `Tavily request timed out after ${this.#timeoutMs} ms`);
      throw new TavilyError("network", "Tavily request failed (network error)");
    }
    if (!response.ok) throw new TavilyError(statusCode(response.status), `Tavily returned HTTP ${response.status}`, response.status);
    try {
      return await response.json();
    } catch {
      throw new TavilyError("invalid_response", "Tavily response was not valid JSON", response.status);
    }
  }
}

export function createTavilyClient(env: Env, overrides: Partial<TavilyClientOptions> = {}): TavilyClient {
  return new TavilyClient({ apiKey: env.TAVILY_API_KEY ?? "", ...overrides });
}
