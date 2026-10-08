import { describe, expect, it, vi } from "vitest";
import { TavilyClient, TavilyError, linksFromText } from "@/server/providers/tavily/client";
import { loadEnv } from "@/config/env";
import { createTavilyClient } from "@/server/providers/tavily/client";

const KEY = "tvly-dev-SECRETKEY-1234567890";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const client = (fetchImpl: typeof fetch, over = {}) => new TavilyClient({ apiKey: KEY, fetchImpl, ...over });
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof TavilyError ? e.code : `other:${String(e)}`;
  }
  return "no-error";
};

describe("TavilyClient.search", () => {
  it("maps results and sends the key only as a bearer header", async () => {
    const fetchImpl = vi.fn(async () => json({ results: [{ url: "https://a.com/menu", title: "Menu", content: "x".repeat(900), score: 0.9 }] }));
    const hits = await client(fetchImpl as unknown as typeof fetch).search("q", { maxResults: 50 });
    expect(hits).toEqual([{ url: "https://a.com/menu", title: "Menu", snippet: "x".repeat(500), score: 0.9 }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.tavily.com/search");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body as string)).toMatchObject({ query: "q", max_results: 10, search_depth: "basic" });
  });

  it("returns an empty list when there are no results", async () => {
    expect(await client((async () => json({})) as unknown as typeof fetch).search("q", { maxResults: 5 })).toEqual([]);
  });

  it("rejects malformed responses", async () => {
    expect(await codeOf(client((async () => json({ results: "nope" })) as unknown as typeof fetch).search("q", { maxResults: 5 }))).toBe("invalid_response");
    expect(await codeOf(client((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch).search("q", { maxResults: 5 }))).toBe("invalid_response");
  });

  it.each([
    [400, "bad_request"],
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limited"],
    [432, "rate_limited"],
    [500, "server"],
  ])("maps HTTP %i to %s without leaking the key", async (status, code) => {
    const err = (await client((async () => json({ detail: { error: `bad key ${KEY}` } }, status)) as unknown as typeof fetch).search("q", { maxResults: 5 }).catch((e: unknown) => e)) as TavilyError;
    expect(err.code).toBe(code);
    expect(err.message).not.toContain(KEY);
    expect(JSON.stringify(err)).not.toContain(KEY);
  });

  it("maps network failures, timeouts and aborts", async () => {
    const boom = client((async () => {
      throw new TypeError(`failed ${KEY}`);
    }) as unknown as typeof fetch);
    const err = (await boom.search("q", { maxResults: 5 }).catch((e: unknown) => e)) as TavilyError;
    expect(err.code).toBe("network");
    expect(err.message).not.toContain(KEY);

    const hang = (_u: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))));
    expect(await codeOf(client(hang as unknown as typeof fetch, { timeoutMs: 30 }).search("q", { maxResults: 5 }))).toBe("timeout");
    const controller = new AbortController();
    const pending = client(hang as unknown as typeof fetch, { timeoutMs: 5000 }).search("q", { maxResults: 5 }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await codeOf(pending)).toBe("aborted");
  });
});

describe("TavilyClient.extract", () => {
  it("returns pages with links and failed urls", async () => {
    const fetchImpl = async () =>
      json({ results: [{ url: "https://a.com/", raw_content: "[Carta](https://a.com/carta.pdf) y https://a.com/menu", images: ["https://a.com/i.png"] }], failed_results: [{ url: "https://b.com/", error: "Failed to fetch url" }] });
    const out = await client(fetchImpl as unknown as typeof fetch).extract(["https://a.com/", "https://b.com/"], { includeImages: true });
    expect(out.pages[0].linkUrls).toEqual(["https://a.com/carta.pdf", "https://a.com/menu"]);
    expect(out.pages[0].imageUrls).toEqual(["https://a.com/i.png"]);
    expect(out.failed).toEqual([{ url: "https://b.com/", error: "Failed to fetch url" }]);
  });

  it("limits a batch to five URLs", async () => {
    const fetchImpl = vi.fn(async () => json({ results: [], failed_results: [] }));
    await client(fetchImpl as unknown as typeof fetch).extract(Array.from({ length: 9 }, (_, i) => `https://a.com/${i}`), {});
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.urls).toHaveLength(5);
  });

  it("rejects malformed extract responses", async () => {
    expect(await codeOf(client((async () => json({ results: [{ nope: 1 }] })) as unknown as typeof fetch).extract(["https://a.com/"], {}))).toBe("invalid_response");
  });
});

describe("configuration", () => {
  it("requires a key and never serializes it", () => {
    expect(() => createTavilyClient(loadEnv({}))).toThrow(/not configured/);
    const c = client((async () => json({})) as unknown as typeof fetch);
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(Object.keys(c)).not.toContain("apiKey");
  });

  it("extracts links from markdown and bare URLs", () => {
    expect(linksFromText("see [x](https://a.com/p) and https://b.com/q. end, https://a.com/p")).toEqual(["https://a.com/p", "https://b.com/q"]);
  });
});
