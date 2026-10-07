import { z } from "zod";
import type { Env } from "@/config/env";
import type { Source } from "@/schemas/common";
import type { RestaurantDetails } from "@/schemas/restaurant";
import type { CallContext, PlacesProvider, PlacesSearchInput, PlacesSearchResult } from "../types";
import { PlacesError, codeForStatus } from "./errors";
import { buildDiscoveryFieldMask } from "./fieldMasks";
import { SearchTextResponseSchema } from "./googleTypes";
import { mapGooglePlace } from "./mapper";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const MAX_PAGE_SIZE = 20;
const MAX_BIAS_RADIUS_METERS = 50_000;

export interface GooglePlacesClientOptions {
  apiKey: string;
  includeVegetarianSignal: boolean;
  timeoutMs?: number;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const ErrorBodySchema = z.object({
  error: z.object({ status: z.string().optional(), message: z.string().optional() }).optional(),
});

export class GooglePlacesClient implements PlacesProvider {
  readonly #apiKey: string;
  readonly #fieldMask: string;
  readonly #timeoutMs: number;
  readonly #endpoint: string;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(opts: GooglePlacesClientOptions) {
    if (!opts.apiKey) throw new PlacesError("missing_api_key", "Google Places API key is not configured");
    this.#apiKey = opts.apiKey;
    this.#fieldMask = buildDiscoveryFieldMask({ includeVegetarianSignal: opts.includeVegetarianSignal });
    this.#timeoutMs = opts.timeoutMs ?? 8_000;
    this.#endpoint = opts.endpoint ?? ENDPOINT;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#now = opts.now ?? (() => new Date());
  }

  get fieldMask(): string {
    return this.#fieldMask;
  }

  toJSON(): { fieldMask: string } {
    return { fieldMask: this.#fieldMask };
  }

  async searchText(input: PlacesSearchInput, ctx: CallContext = {}): Promise<PlacesSearchResult> {
    const started = Date.now();
    const body: Record<string, unknown> = {
      textQuery: input.query,
      includedType: "restaurant",
      pageSize: Math.min(Math.max(input.maxResults, 1), MAX_PAGE_SIZE),
      languageCode: input.languageCode ?? "en",
    };
    if (input.regionCode) body.regionCode = input.regionCode;
    if (input.locationBias) {
      body.locationBias = {
        circle: {
          center: { latitude: input.locationBias.lat, longitude: input.locationBias.lng },
          radius: Math.min(input.locationBias.radiusMeters, MAX_BIAS_RADIUS_METERS),
        },
      };
    }

    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = ctx.signal ? AbortSignal.any([timeout, ctx.signal]) : timeout;

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": this.#apiKey,
          "x-goog-fieldmask": this.#fieldMask,
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch {
      if (ctx.signal?.aborted) throw new PlacesError("aborted", "Places request aborted");
      if (timeout.aborted) throw new PlacesError("timeout", `Places request timed out after ${this.#timeoutMs} ms`);
      throw new PlacesError("network", "Places request failed (network error)");
    }

    if (!response.ok) throw await this.#httpError(response);

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new PlacesError("invalid_response", "Places response was not valid JSON", response.status);
    }
    const envelope = SearchTextResponseSchema.safeParse(json);
    if (!envelope.success) {
      throw new PlacesError("invalid_response", "Places response had an unexpected shape", response.status);
    }

    const fetchedAt = this.#now().toISOString();
    const restaurants: RestaurantDetails[] = [];
    const sources: Source[] = [];
    let dropped = 0;
    for (const raw of envelope.data.places ?? []) {
      const mapped = mapGooglePlace(raw, { fetchedAt });
      if (!mapped) {
        dropped++;
        continue;
      }
      restaurants.push(mapped.restaurant);
      sources.push(mapped.source);
    }
    return { restaurants, sources, droppedUnmappable: dropped, latencyMs: Date.now() - started };
  }

  async #httpError(response: Response): Promise<PlacesError> {
    const code = codeForStatus(response.status);
    let detail = "";
    try {
      const parsed = ErrorBodySchema.safeParse(await response.json());
      const status = parsed.success ? parsed.data.error?.status : undefined;
      if (status && /^[A-Z_]{3,40}$/.test(status)) detail = ` (${status})`;
    } catch {
      detail = "";
    }
    return new PlacesError(code, `Places API returned HTTP ${response.status}${detail}`, response.status);
  }
}

export function createPlacesClient(env: Env, overrides: Partial<GooglePlacesClientOptions> = {}): GooglePlacesClient {
  return new GooglePlacesClient({
    apiKey: env.GOOGLE_PLACES_API_KEY ?? "",
    includeVegetarianSignal: env.PLACES_REQUEST_VEGETARIAN_SIGNAL,
    ...overrides,
  });
}
