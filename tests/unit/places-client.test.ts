import { describe, expect, it, vi } from "vitest";
import { GooglePlacesClient, createPlacesClient } from "@/server/providers/places/client";
import { PlacesError } from "@/server/providers/places/errors";
import { buildDiscoveryFieldMask } from "@/server/providers/places/fieldMasks";
import { loadEnv } from "@/config/env";
import { errorResponse, okResponse, rawPlace } from "../helpers/places";

const KEY = "AIzaTESTKEY-1234567890-abcdefghij";

function client(fetchImpl: typeof fetch, over: Record<string, unknown> = {}) {
  return new GooglePlacesClient({
    apiKey: KEY,
    includeVegetarianSignal: true,
    fetchImpl,
    now: () => new Date("2026-10-07T12:00:00.000Z"),
    ...over,
  });
}

const input = { query: "italian restaurants in Barcelona", maxResults: 20 };

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return e instanceof PlacesError ? e.code : `other:${String(e)}`;
  }
  return "no-error";
}

describe("field mask", () => {
  it("never requests review text, photos, price range or contact fields", () => {
    const mask = buildDiscoveryFieldMask({ includeVegetarianSignal: true });
    for (const banned of ["reviews", "photos", "priceRange", "phone", "editorialSummary", "currentOpeningHours"]) {
      expect(mask, banned).not.toContain(banned);
    }
    expect(mask).toContain("places.id");
    expect(mask).toContain("places.regularOpeningHours");
  });

  it("can omit the vegetarian signal", () => {
    expect(buildDiscoveryFieldMask({ includeVegetarianSignal: false })).not.toContain("servesVegetarianFood");
    expect(buildDiscoveryFieldMask({ includeVegetarianSignal: true })).toContain("places.servesVegetarianFood");
  });
});

describe("GooglePlacesClient.searchText", () => {
  it("returns mapped restaurants with provenance", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ places: [rawPlace(), rawPlace({ id: "place-2" })] }));
    const result = await client(fetchImpl as unknown as typeof fetch).searchText(input);
    expect(result.restaurants).toHaveLength(2);
    expect(result.restaurants[0]).toMatchObject({ placeId: "place-1", name: "Trattoria Uno", priceLevel: 2, sourceId: "places:place-1" });
    expect(result.sources[0]).toMatchObject({
      id: "places:place-1",
      provider: "google_places",
      url: "https://maps.google.com/?cid=1",
      fetchedAt: "2026-10-07T12:00:00.000Z",
    });
    expect(result.restaurants[0].sampledReviews).toEqual([]);
  });

  it("sends the key and field mask as headers, not in the URL", async () => {
    const fetchImpl = vi.fn(async () => okResponse({ places: [] }));
    await client(fetchImpl as unknown as typeof fetch).searchText(input);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(KEY);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe(KEY);
    expect(headers["x-goog-fieldmask"]).toBe(buildDiscoveryFieldMask({ includeVegetarianSignal: true }));
    expect(headers["x-goog-fieldmask"]).not.toMatch(/reviews/);
  });

  it("builds the request body with clamps", async () => {
    const fetchImpl = vi.fn(async () => okResponse({}));
    await client(fetchImpl as unknown as typeof fetch).searchText({
      query: "q",
      maxResults: 500,
      locationBias: { lat: 41.38, lng: 2.17, radiusMeters: 900_000 },
      regionCode: "ES",
    });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ textQuery: "q", includedType: "restaurant", pageSize: 20, regionCode: "ES", languageCode: "en" });
    expect(body.locationBias.circle.radius).toBe(50_000);
    expect(body.locationBias.circle.center).toEqual({ latitude: 41.38, longitude: 2.17 });
  });

  it("treats a response without places as an empty result", async () => {
    const result = await client((async () => okResponse({})) as unknown as typeof fetch).searchText(input);
    expect(result.restaurants).toEqual([]);
    expect(result.droppedUnmappable).toBe(0);
  });

  it("drops individually malformed places and counts them", async () => {
    const places = [rawPlace(), { id: "bad", displayName: { text: "No location" } }, "garbage", rawPlace({ id: "p3", rating: "high" })];
    const result = await client((async () => okResponse({ places })) as unknown as typeof fetch).searchText(input);
    expect(result.restaurants.map((r) => r.placeId)).toEqual(["place-1"]);
    expect(result.droppedUnmappable).toBe(3);
  });

  it("keeps places that lack optional fields", async () => {
    const minimal = { id: "m1", displayName: { text: "Minimal" }, location: { latitude: 41.4, longitude: 2.17 } };
    const result = await client((async () => okResponse({ places: [minimal] })) as unknown as typeof fetch).searchText(input);
    const r = result.restaurants[0];
    expect(r.rating).toBeUndefined();
    expect(r.priceLevel).toBeUndefined();
    expect(r.websiteUrl).toBeUndefined();
    expect(r.servesVegetarianFood).toBeUndefined();
    expect(r.openingHours).toBeUndefined();
  });

  it("rejects a response with an unexpected shape", async () => {
    expect(await codeOf(client((async () => okResponse({ places: "nope" })) as unknown as typeof fetch).searchText(input))).toBe("invalid_response");
    expect(await codeOf(client((async () => okResponse("string-body")) as unknown as typeof fetch).searchText(input))).toBe("invalid_response");
  });

  it("rejects a non-JSON body", async () => {
    const fetchImpl = async () => new Response("<html>oops</html>", { status: 200 });
    expect(await codeOf(client(fetchImpl as unknown as typeof fetch).searchText(input))).toBe("invalid_response");
  });
});

describe("error mapping", () => {
  it.each([
    [400, "bad_request"],
    [404, "bad_request"],
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [500, "server"],
    [503, "server"],
  ])("HTTP %i -> %s", async (status, code) => {
    const c = client((async () => errorResponse(status)) as unknown as typeof fetch);
    const err = await c.searchText(input).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PlacesError);
    expect((err as PlacesError).code).toBe(code);
    expect((err as PlacesError).status).toBe(status);
  });

  it("includes Google's error status but never the key or raw body", async () => {
    const body = { error: { status: "PERMISSION_DENIED", message: `API key ${KEY} is invalid` } };
    const c = client((async () => errorResponse(403, body)) as unknown as typeof fetch);
    const err = (await c.searchText(input).catch((e: unknown) => e)) as PlacesError;
    expect(err.message).toContain("PERMISSION_DENIED");
    expect(err.message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
    expect(String(err.stack)).not.toContain(KEY);
  });

  it("maps network failures", async () => {
    const c = client((async () => {
      throw new TypeError(`fetch failed for key ${KEY}`);
    }) as unknown as typeof fetch);
    const err = (await c.searchText(input).catch((e: unknown) => e)) as PlacesError;
    expect(err.code).toBe("network");
    expect(err.message).not.toContain(KEY);
  });

  it("times out", async () => {
    const hang = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const c = client(hang as unknown as typeof fetch, { timeoutMs: 40 });
    expect(await codeOf(c.searchText(input))).toBe("timeout");
  });

  it("honours a caller abort", async () => {
    const hang = (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    const controller = new AbortController();
    const c = client(hang as unknown as typeof fetch, { timeoutMs: 5000 });
    const pending = c.searchText(input, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await codeOf(pending)).toBe("aborted");
  });
});

describe("configuration and secrecy", () => {
  it("requires an API key", () => {
    expect(() => createPlacesClient(loadEnv({}))).toThrow(/not configured/);
  });

  it("never serializes the API key", () => {
    const c = client((async () => okResponse({})) as unknown as typeof fetch);
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(JSON.stringify(Object.entries(c))).not.toContain(KEY);
    expect(Object.keys(c)).not.toContain("apiKey");
  });

  it("does not log the key on failures", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const c = client((async () => errorResponse(401)) as unknown as typeof fetch);
    await c.searchText(input).catch(() => undefined);
    for (const spy of spies) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
      spy.mockRestore();
    }
  });
});
