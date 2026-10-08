import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "@/config/env";
import { RecommendRequestBody } from "@/schemas/request";
import type { MenuResolution } from "@/schemas/menuResolution";
import { createEventEmitter } from "@/server/agent/events";
import { runDiscovery } from "@/server/discovery/pipeline";
import { extractMenus } from "@/server/menu/extract/pipeline";
import { createSharedCache, defaultFetcher, resolveMenus, type ResolverRestaurant } from "@/server/menu/resolver";
import { createGeminiClient } from "@/server/providers/gemini/client";
import { createPlacesClient } from "@/server/providers/places/client";
import { createTavilyClient } from "@/server/providers/tavily/client";

function directResolution(r: ResolverRestaurant, url: string, tier: string, kind: string): MenuResolution {
  const candidate = {
    id: `${r.placeId}#direct`,
    url,
    normalizedUrl: url,
    tier,
    mediaType: "unknown",
    documentKind: kind,
    readability: "readable",
    menuLikelihood: 0.9,
    identityConfidence: 1,
    confidence: 0.9,
    discoveredVia: "site_link",
    signals: ["supplied on the command line"],
    selected: true,
  };
  const usage = { directFetches: 0, tavilySearches: 0, tavilyExtracts: 0, tavilyCredits: 0, geminiCalls: 0, bytesFetched: 0 };
  return { status: "resolved", restaurantId: r.placeId, restaurantName: r.name, candidates: [candidate], stages: [], warnings: [], usage, durationMs: 0, selected: [candidate], confidence: 0.9 } as unknown as MenuResolution;
}

function flagsFrom(argv: string[]) {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) bools.add(argv[i].slice(2));
    else {
      flags.set(argv[i].slice(2), next);
      i++;
    }
  }
  return { flags, bools };
}

const pad = (v: unknown, n: number) => String(v ?? "-").slice(0, n).padEnd(n);

async function main(): Promise<void> {
  const { flags, bools } = flagsFrom(process.argv.slice(2));
  const env = loadEnv();
  let restaurants: ResolverRestaurant[] = [];

  if (bools.has("phase2-shortlist")) {
    const body = RecommendRequestBody.parse({ form: { city: "Barcelona", meal: "dinner", diet: ["vegetarian"], cuisines: ["Italian"], budget: { max: 30, currency: "EUR" } } });
    const d = await runDiscovery(body, { places: createPlacesClient(env), emitter: createEventEmitter(() => undefined) });
    restaurants = d.selected.map((e) => ({ placeId: e.placeId, name: e.name, address: e.discovered.restaurant.address, city: "Barcelona", websiteUrl: e.discovered.restaurant.websiteUrl, websiteHttpsCandidate: e.discovered.restaurant.websiteHttpsCandidate }));
  } else if (bools.has("phase0-set")) {
    const file = "scripts/phase0/out/t2_results.json";
    if (!existsSync(file)) throw new Error(`${file} not found (local Phase 0 output, not committed)`);
    const rows = JSON.parse(readFileSync(file, "utf8")) as Array<{ name: string; site: string }>;
    restaurants = rows.map((r, i) => ({ placeId: `p0-${i}`, name: r.name.split("|")[0].trim(), city: "Barcelona", websiteUrl: r.site }));
    restaurants.unshift({ placeId: "p0-tulsi", name: "Vegan Tulsi Restaurant", address: "Carrer dels Àngels, 8, 08001 Barcelona", city: "Barcelona", websiteUrl: "https://www.vegan-tulsi.com/" });
  } else {
    const name = flags.get("restaurant");
    if (!name) throw new Error('Usage: npm run phase5 -- --restaurant "Name" --website https://... | --phase0-set --only <name> | --phase2-shortlist [--no-llm] [--focus all] [--no-price-check] [--show 10] [--json]');
    restaurants = [{ placeId: "dev-1", name, address: flags.get("address"), city: flags.get("city") ?? "Barcelona", websiteUrl: flags.get("website") }];
  }
  const only = flags.get("only");
  if (only) restaurants = restaurants.filter((r) => r.name.toLowerCase().includes(only.toLowerCase()));
  const max = flags.get("max");
  if (max) restaurants = restaurants.slice(0, Number(max));

  const sharedCache = createSharedCache();
  const search = env.TAVILY_API_KEY ? createTavilyClient(env) : undefined;
  const llm = bools.has("no-llm") || !env.GEMINI_API_KEY ? undefined : createGeminiClient(env);
  const emitter = createEventEmitter(() => undefined);

  const docUrl = flags.get("doc");
  const t0 = Date.now();
  const resolutions = docUrl
    ? restaurants.map((r) => directResolution(r, docUrl, flags.get("tier") ?? "official_site", flags.get("kind") ?? "food_menu"))
    : await resolveMenus(restaurants, { fetcher: defaultFetcher, search, emitter, sharedCache, restaurantConcurrency: 3, fetchConcurrency: 6, tavilyConcurrency: 2 });
  const tResolve = Date.now() - t0;

  const t1 = Date.now();
  const { results, stats } = await extractMenus(
    restaurants.map((restaurant, i) => ({ restaurant, resolution: resolutions[i] })),
    { fetcher: defaultFetcher, sharedCache, llm, priceCheckModel: env.GEMINI_PRICE_CHECK_MODEL, emitter, focus: flags.get("focus") === "all" ? "all" : "plant_based", verifyImagePrices: !bools.has("no-price-check") },
  );
  const tExtract = Date.now() - t1;

  if (bools.has("json")) {
    console.log(JSON.stringify({ results, stats, resolutions: resolutions.map((r) => ({ status: r.status, usage: r.usage })) }, null, 2));
    return;
  }

  const show = Number(flags.get("show") ?? 8);
  console.log(`\n${[pad("restaurant", 26), pad("resolve", 20), pad("extract", 10), pad("docs", 5), pad("dishes", 6), pad("veg✓", 5), pad("veg?", 5), pad("methods", 18)].join(" ")}`);
  console.log("-".repeat(104));
  for (const [i, r] of results.entries()) {
    const veg = r.dishes.filter((d) => d.diet.vegetarian.status === "confirmed").length;
    const maybe = r.dishes.filter((d) => d.diet.vegetarian.status === "possible").length;
    console.log([pad(r.restaurantName, 26), pad(resolutions[i].status, 20), pad(r.status, 10), pad(r.documents.length, 5), pad(r.dishes.length, 6), pad(veg, 5), pad(maybe, 5), pad([...new Set(r.documents.map((d) => d.method).filter(Boolean))].join("+"), 18)].join(" "));
  }

  for (const r of results) {
    console.log(`\n${r.restaurantName} [${r.status}]${r.reason ? ` ${r.reason}` : ""}`);
    for (const d of r.documents) console.log(`  doc ${pad(d.documentKind, 18)} ${pad(d.method, 9)} ${pad(d.status, 9)} dishes=${d.dishCount} omitted=${d.omittedNonMatchingCount} dropped=${d.droppedDishCount} ${d.reason ?? ""} ${d.url.slice(0, 70)}`);
    for (const s of r.setMenus.slice(0, 2)) console.log(`  set menu: ${s.name} ${s.prices.map((p) => p.raw ?? p.status).join(" / ")}`);
    for (const d of r.dishes.slice(0, show)) {
      const price = d.prices.map((p) => (p.amount !== undefined ? `${p.label ? `${p.label} ` : ""}€${p.amount.toFixed(2)} (${p.status})` : p.status)).join(" / ");
      console.log(`  - ${d.originalName}${d.translatedName ? `  →  ${d.translatedName}` : ""} | ${price} | veg:${d.diet.vegetarian.status}/${d.diet.vegetarian.basis} vegan:${d.diet.vegan.status} | ${d.offering}${d.section ? ` · ${d.section}` : ""}`);
    }
    for (const w of r.warnings.slice(0, 2)) console.log(`  warning: ${w}`);
  }

  const gemini = llm ? (llm as unknown as { stats: Record<string, unknown> }).stats : undefined;
  console.log(`\nresolve: ${tResolve} ms | extract: ${tExtract} ms`);
  console.log(`gemini: ${stats.llmRequests} extraction requests (${stats.visionRequests} vision) + ${stats.priceCheckRequests} price checks; tokens in ${stats.inputTokens} / out ${stats.outputTokens}${gemini ? ` | http requests ${(gemini as { requests: number }).requests}, retries ${(gemini as { retries: number }).retries}, by model ${JSON.stringify((gemini as { byModel: unknown }).byModel)}` : ""}`);
  console.log(`tavily: ${resolutions.reduce((n, r) => n + r.usage.tavilySearches, 0)} searches + ${resolutions.reduce((n, r) => n + r.usage.tavilyExtracts, 0)} extracts\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error");
  process.exit(1);
});
