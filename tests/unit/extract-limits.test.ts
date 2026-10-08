import { describe, expect, it } from "vitest";
import { MenuExtractionSchema, type ExtractedDish } from "@/schemas/menuExtraction";
import { splitIntoChunks } from "@/server/menu/extract/chunk";
import { representativeDishes } from "@/server/menu/extract/coverage";
import { ExtractionCache } from "@/server/menu/extract/modelCache";
import { extractMenus, type ExtractDeps } from "@/server/menu/extract/pipeline";
import type { ResolverRestaurant } from "@/server/menu/resolver";
import { GeminiError } from "@/server/providers/gemini/client";
import { salvageTruncatedJson } from "@/server/providers/gemini/salvage";
import { PNG_BYTES, fakeFetcher, html, makeTextPdf } from "../helpers/resolverKit";
import { cand, dish, fakeLlm, modelDoc, resolved } from "../helpers/extractKit";

const restaurant = (over: Partial<ResolverRestaurant> = {}): ResolverRestaurant => ({ placeId: "r1", name: "Casa Prueba", address: "Carrer del Test, 5, Barcelona", city: "Barcelona", websiteUrl: "https://casaprueba.example/", ...over });
const URL = (n: string) => `https://casaprueba.example/${n}`;
const docId = (req: unknown) => (req as { parts: Array<{ text?: string }> }).parts[0].text!.match(/id="([^"]+)"/)![1];
const lines = (n: number, prefix = "Plato") => Array.from({ length: n }, (_, i) => `${prefix} numero ${i + 1} con arroz y verduras 9,50 €`);
const onePlate = (req: unknown) => ({ documents: [modelDoc(docId(req), [dish("Plato numero 1 con arroz y verduras", { priceRaw: "9,50 €" })])] });

function setup(routes: Record<string, string | Uint8Array>, handler: Parameters<typeof fakeLlm>[0], extra: Partial<ExtractDeps> = {}) {
  const llm = fakeLlm(handler);
  return { llm, deps: { fetcher: fakeFetcher(routes as never), llm, ...extra } as ExtractDeps };
}

async function run(inputs: Parameters<typeof extractMenus>[0], deps: ExtractDeps) {
  const out = await extractMenus(inputs, deps);
  for (const r of out.results) expect(MenuExtractionSchema.safeParse(r).success).toBe(true);
  return out;
}

const input = (r: ResolverRestaurant, ...urls: string[]) => ({ restaurant: r, resolution: resolved(r, urls.map((url, i) => cand({ id: `${r.placeId}#c${i + 1}`, url }))) });

describe("splitIntoChunks", () => {
  it("returns one chunk for short text", () => {
    expect(splitIntoChunks("a\nb", 100, 2)).toEqual({ chunks: ["a\nb"], droppedChars: 0 });
  });

  it("splits long text on line boundaries into balanced chunks", () => {
    const text = Array.from({ length: 40 }, (_, i) => `line ${i} `.padEnd(50, "x")).join("\n");
    const { chunks, droppedChars } = splitIntoChunks(text, 1200, 3);
    expect(chunks.length).toBe(2);
    expect(droppedChars).toBe(0);
    expect(chunks.join("\n")).toBe(text);
    expect(Math.abs(chunks[0].length - chunks[1].length)).toBeLessThan(120);
  });

  it("reports characters that do not fit in the allowed chunks", () => {
    const text = Array.from({ length: 100 }, (_, i) => `line ${i} `.padEnd(50, "x")).join("\n");
    const { chunks, droppedChars } = splitIntoChunks(text, 1000, 2);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
    expect(droppedChars).toBeGreaterThan(0);
  });

  it("splits a single huge line", () => {
    const { chunks } = splitIntoChunks("y".repeat(2500), 1000, 3);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.every((c) => c.length <= 1000)).toBe(true);
  });
});

describe("representativeDishes", () => {
  const mk = (name: string, section: string, vegetarian: "confirmed" | "unknown" | "not_suitable" = "unknown"): ExtractedDish => {
    const verdict = (status: string, confidence: number) => ({ status, basis: "none", evidence: "", confidence });
    return {
      id: name,
      restaurantId: "r",
      originalName: name,
      originalLanguage: "es",
      section,
      offering: "a_la_carte",
      prices: [{ status: "absent", currency: "EUR" }],
      priceConflict: false,
      diet: { vegetarian: verdict(vegetarian, 0.5), vegan: verdict(vegetarian === "not_suitable" ? "not_suitable" : "unknown", 0.2), pescatarian: verdict("unknown", 0.2), glutenFree: verdict("unknown", 0.2) },
      extractionConfidence: 0.8,
      sources: [{ documentId: "d", url: "https://a.example/m", tier: "official_site", method: "html_text" }],
    } as ExtractedDish;
  };

  it("keeps every dish under the cap", () => {
    const dishes = [mk("a", "s"), mk("b", "s")];
    expect(representativeDishes(dishes, 5)).toBe(dishes);
  });

  it("spreads the cap across menu sections instead of truncating the tail", () => {
    const dishes = [
      ...Array.from({ length: 30 }, (_, i) => mk(`starter ${i}`, "Entrantes")),
      ...Array.from({ length: 5 }, (_, i) => mk(`dessert ${i}`, "Postres")),
      ...Array.from({ length: 5 }, (_, i) => mk(`main ${i}`, "Principales")),
    ];
    const kept = representativeDishes(dishes, 12);
    expect(kept).toHaveLength(12);
    expect(new Set(kept.map((d) => d.section))).toEqual(new Set(["Entrantes", "Postres", "Principales"]));
    expect(kept.filter((d) => d.section === "Postres").length).toBeGreaterThanOrEqual(3);
  });

  it("prefers relevant dishes within a section and keeps menu order", () => {
    const dishes = [mk("meat", "Carta", "not_suitable"), mk("unknown", "Carta"), mk("veg", "Carta", "confirmed")];
    expect(representativeDishes(dishes, 2).map((d) => d.originalName)).toEqual(["unknown", "veg"]);
  });
});

describe("salvageTruncatedJson", () => {
  it("keeps only fully closed dishes from a cut-off response", () => {
    const text = '{"documents":[{"documentId":"d1","verdict":"food_menu","dishes":[{"originalName":"A"},{"originalName":"B"},{"originalName":"C","priceRa';
    expect(salvageTruncatedJson(text)).toEqual({ documents: [{ documentId: "d1", verdict: "food_menu", dishes: [{ originalName: "A" }, { originalName: "B" }] }] });
  });

  it("handles quotes and brackets inside strings", () => {
    const text = '{"dishes":[{"originalName":"Pa } amb \\" tomaquet ["},{"originalName":"x';
    expect(salvageTruncatedJson(text)).toEqual({ dishes: [{ originalName: 'Pa } amb " tomaquet [' }] });
  });

  it("returns undefined when nothing is recoverable", () => {
    expect(salvageTruncatedJson('{"documents":[{"documentId":"d')).toBeUndefined();
  });
});

describe("quota exhaustion", () => {
  it("falls back to the deterministic parser without a model request when every model is paused", async () => {
    const r = restaurant();
    const { llm, deps } = setup({ [URL("carta.pdf")]: makeTextPdf([lines(6)]) }, () => ({ documents: [] }));
    llm.exhausted = true;
    const { results, stats } = await run([input(r, URL("carta.pdf"))], deps);
    expect(llm.calls).toHaveLength(0);
    expect(stats.llmRequests).toBe(0);
    expect(stats.quotaSkipped).toBe(1);
    expect(results[0].status).toBe("partial");
    expect(results[0].documents[0].reason).toContain("daily quota");
    expect(results[0].dishes.length).toBeGreaterThan(0);
    expect(results[0].dishes.every((d) => d.diet.vegetarian.status !== "confirmed")).toBe(true);
  });

  it("fails scanned documents cleanly while text documents still fall back", async () => {
    const r = restaurant();
    const { llm, deps } = setup({ [URL("carta.pdf")]: makeTextPdf([lines(6)]), [URL("foto.png")]: PNG_BYTES }, () => ({ documents: [] }));
    llm.exhausted = true;
    const sel = { restaurant: r, resolution: resolved(r, [cand({ id: "r1#c1", url: URL("carta.pdf") }), cand({ id: "r1#c2", url: URL("foto.png"), mediaType: "image" })]) };
    const { results } = await run([sel], { ...deps, limits: { maxDocsPerRestaurant: 2 } });
    expect(llm.calls).toHaveLength(0);
    expect(results[0].documents.map((d) => d.status)).toEqual(["partial", "failed"]);
    expect(results[0].documents[1].reason).toContain("daily quota");
    expect(results[0].status).toBe("partial");
  });

  it("stops queued work once a request discovers the quota is gone", async () => {
    const rs = ["a", "b", "c", "d"].map((x) => restaurant({ placeId: x, name: `Casa ${x}`, websiteUrl: `https://${x}.example/` }));
    const files: Record<string, Uint8Array> = {};
    for (const x of ["a", "b", "c", "d"]) files[`https://${x}.example/carta.pdf`] = makeTextPdf([lines(6, `Plato ${x}`)]);
    const { llm, deps } = setup(files, () => {
      llm.exhausted = true;
      return new GeminiError("quota_exhausted", "Every configured Gemini model has hit its daily quota", 429);
    }, { limits: { llmConcurrency: 1 } });
    const { results, stats } = await run(rs.map((x) => input(x, `https://${x.placeId}.example/carta.pdf`)), deps);
    expect(llm.calls).toHaveLength(1);
    expect(stats.quotaSkipped).toBe(3);
    expect(results.every((r) => r.dishes.length > 0)).toBe(true);
  });
});

describe("token and size bounds", () => {
  it("sets a hard output-token ceiling on every model request", async () => {
    const r = restaurant();
    const { llm, deps } = setup({ [URL("carta.pdf")]: makeTextPdf([lines(4)]), [URL("foto.png")]: PNG_BYTES }, (req) => ({ documents: [modelDoc(req.label === "menu-extract-text" ? docId(req) : "r1#c2", [])] }), { verifyImagePrices: false });
    await extractMenus([{ restaurant: r, resolution: resolved(r, [cand({ id: "r1#c1", url: URL("carta.pdf") }), cand({ id: "r1#c2", url: URL("foto.png"), mediaType: "image" })]) }], { ...deps, limits: { maxDocsPerRestaurant: 2 } });
    expect(llm.calls.length).toBe(2);
    expect(llm.calls.every((c) => c.maxOutputTokens === 7000)).toBe(true);
  });

  it("splits an oversized menu into parts, reads each part once and merges the dishes", async () => {
    const r = restaurant();
    const all = lines(60);
    const { llm, deps } = setup({ [URL("carta.pdf")]: makeTextPdf([all.slice(0, 20), all.slice(20, 40), all.slice(40)]) }, (req) => {
      const text = (req.parts[0] as { text: string }).text;
      const names = [...new Set([...text.matchAll(/Plato numero (\d+)/g)].map((m) => m[1]))].slice(0, 5);
      return { documents: [modelDoc(docId(req), names.map((n) => dish(`Plato numero ${n} con arroz y verduras`, { priceRaw: "9,50 €" })))] };
    }, { limits: { chunkChars: 1500, maxTextChars: 30000 } });
    const { results, stats } = await run([input(r, URL("carta.pdf"))], deps);
    expect(llm.calls.length).toBe(2);
    expect(llm.calls.map((c) => (c.parts[0] as { text: string }).text.match(/part="(\d)\/2"/)?.[1]).sort()).toEqual(["1", "2"]);
    expect(stats.llmRequests).toBe(2);
    expect(results[0].dishes).toHaveLength(10);
    expect(results[0].dishes.every((d) => d.prices[0].status === "verified")).toBe(true);
  });

  it("falls back for only the failed part of a chunked menu", async () => {
    const r = restaurant();
    const all = lines(40);
    const { deps } = setup({ [URL("carta.pdf")]: makeTextPdf([all.slice(0, 20), all.slice(20)]) }, (req, call) => {
      if (call === 2) return new GeminiError("unavailable", "down");
      return onePlate(req);
    }, { limits: { chunkChars: 1200, maxTextChars: 30000, llmConcurrency: 1 } });
    const { results } = await run([input(r, URL("carta.pdf"))], deps);
    expect(results[0].documents[0].status).toBe("partial");
    expect(results[0].documents[0].reason).toContain("part of the menu");
    expect(results[0].dishes.length).toBeGreaterThan(1);
  });

  it("stops launching model requests when the input-token budget is spent", async () => {
    const r = restaurant();
    const files = { [URL("a.pdf")]: makeTextPdf([lines(10)]), [URL("b.pdf")]: makeTextPdf([lines(10, "Otro")]) };
    const { llm, deps } = setup(files, onePlate, { limits: { maxDocsPerRestaurant: 2, maxInputTokensPerRun: 1500, llmConcurrency: 1 } });
    const { results } = await run([input(r, URL("a.pdf"), URL("b.pdf"))], deps);
    expect(llm.calls).toHaveLength(1);
    expect(results[0].documents[1].reason).toContain("input token budget");
  });

  it("caps dishes per document using section coverage, not the first N", async () => {
    const r = restaurant();
    const starters = Array.from({ length: 30 }, (_, i) => `Entrante numero ${i + 1} con verduras 6,00 €`);
    const desserts = Array.from({ length: 6 }, (_, i) => `Postre numero ${i + 1} de la casa 5,00 €`);
    const { deps } = setup({ [URL("carta.pdf")]: makeTextPdf([["ENTRANTES", ...starters, "POSTRES", ...desserts]]) }, (req) => ({
      documents: [
        modelDoc(docId(req), [
          ...starters.map((_s, i) => dish(`Entrante numero ${i + 1} con verduras`, { section: "ENTRANTES", priceRaw: "6,00 €" })),
          ...desserts.map((_s, i) => dish(`Postre numero ${i + 1} de la casa`, { section: "POSTRES", priceRaw: "5,00 €" })),
        ]),
      ],
    }), { limits: { maxDishesPerDocument: 12 } });
    const { results } = await run([input(r, URL("carta.pdf"))], deps);
    expect(results[0].dishes).toHaveLength(12);
    expect(results[0].dishes.filter((d) => d.section === "POSTRES").length).toBeGreaterThanOrEqual(4);
    expect(results[0].documents[0].warnings.join(" ")).toContain("Kept 12 of 36");
  });
});

describe("content cache and call accounting", () => {
  it("does not extract identical menu content twice, even from different URLs", async () => {
    const r = restaurant();
    const bytes = makeTextPdf([lines(6)]);
    const { llm, deps } = setup({ [URL("a.pdf")]: bytes, [URL("b.pdf")]: bytes }, onePlate, { limits: { maxDocsPerRestaurant: 2, llmConcurrency: 1 } });
    const { results, stats } = await run([input(r, URL("a.pdf"), URL("b.pdf"))], deps);
    expect(llm.calls).toHaveLength(1);
    expect(stats.cacheHits).toBe(1);
    expect(results[0].documents.map((d) => d.status)).toEqual(["extracted", "extracted"]);
    expect(results[0].documents.map((d) => d.documentId)).toEqual(["r1#c1", "r1#c2"]);
  });

  it("reuses a supplied cache across runs and does not cache failures", async () => {
    const r = restaurant();
    const modelCache = new ExtractionCache();
    const files = { [URL("a.pdf")]: makeTextPdf([lines(6)]) };
    const first = setup(files, onePlate, { modelCache });
    await run([input(r, URL("a.pdf"))], first.deps);
    const second = setup(files, () => new Error("must not be called"), { modelCache });
    const out = await run([input(r, URL("a.pdf"))], second.deps);
    expect(second.llm.calls).toHaveLength(0);
    expect(out.results[0].dishes).toHaveLength(1);

    const failing = new ExtractionCache();
    const bad = setup(files, () => new GeminiError("unavailable", "down"), { modelCache: failing });
    await run([input(r, URL("a.pdf"))], bad.deps);
    expect(failing.size).toBe(0);
  });

  it("records per-call token usage and latency", async () => {
    const r = restaurant();
    const { deps } = setup({ [URL("a.pdf")]: makeTextPdf([lines(6)]) }, onePlate);
    const { stats } = await run([input(r, URL("a.pdf"))], deps);
    expect(stats.calls).toEqual([{ label: "menu-extract-text", model: "fake", latencyMs: 1, inputTokens: 1000, outputTokens: 200, truncated: false }]);
    expect(stats.modelLatencyMs).toBe(1);
    expect(stats.inputTokens).toBe(1000);
  });

  it("still reads HTML menus through the same bounded path", async () => {
    const r = restaurant();
    const page = html(`<h1>Carta</h1>${lines(30).map((l) => `<p>${l}</p>`).join("")}`);
    const { llm, deps } = setup({ [URL("carta")]: page }, onePlate);
    const { results } = await run([{ restaurant: r, resolution: resolved(r, [cand({ url: URL("carta"), mediaType: "html" })]) }], deps);
    expect(llm.calls).toHaveLength(1);
    expect(results[0].dishes).toHaveLength(1);
  });
});
