import type { z } from "zod";
import type { RestaurantDetails } from "@/schemas/restaurant";
import type { Source } from "@/schemas/common";
import type { SafeFetchOptions, SafeFetchResult } from "./http/safeFetch";

export interface CallContext {
  signal?: AbortSignal;
}

export interface PlacesSearchInput {
  query: string;
  maxResults: number;
  locationBias?: { lat: number; lng: number; radiusMeters: number };
  regionCode?: string;
  languageCode?: string;
}

export interface PlacesSearchResult {
  restaurants: RestaurantDetails[];
  sources: Source[];
  droppedUnmappable: number;
  latencyMs: number;
}

export interface PlacesProvider {
  searchText(input: PlacesSearchInput, ctx?: CallContext): Promise<PlacesSearchResult>;
}

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  score?: number;
}

export interface ExtractedPage {
  url: string;
  text: string;
  imageUrls: string[];
  linkUrls: string[];
}

export interface WebSearchProvider {
  search(query: string, opts: { maxResults: number; includeImages?: boolean }, ctx?: CallContext): Promise<SearchHit[]>;
  extract(urls: string[], opts: { includeImages?: boolean }, ctx?: CallContext): Promise<{
    pages: ExtractedPage[];
    failed: Array<{ url: string; error: string }>;
  }>;
}

export type LlmPart =
  | { kind: "text"; text: string }
  | { kind: "inline"; mimeType: string; data: Uint8Array };

export interface LlmStructuredRequest<T> {
  label: string;
  system: string;
  parts: LlmPart[];
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
  models?: string[];
  thinkingBudget?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface LlmStructuredResult<T> {
  data: T;
  model: string;
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  truncated?: boolean;
}

export interface LlmProvider {
  available?(): boolean;
  generateStructured<T>(req: LlmStructuredRequest<T>, ctx?: CallContext): Promise<LlmStructuredResult<T>>;
}

export interface Fetcher {
  fetch(url: string, opts?: SafeFetchOptions): Promise<SafeFetchResult>;
}
