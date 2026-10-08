import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "@/config/env";
import { RecommendRequestBody } from "@/schemas/request";
import type { MenuResolution } from "@/schemas/menuResolution";
import { createEventEmitter } from "@/server/agent/events";
import { runDiscovery } from "@/server/discovery/pipeline";
import { defaultFetcher, resolveMenus, type ResolverRestaurant } from "@/server/menu/resolver";
import { createPlacesClient } from "@/server/providers/places/client";
import { createTavilyClient } from "@/server/providers/tavily/client";

interface Options {
  restaurants: ResolverRestaurant[];
  tavily: boolean;
  json: boolean;
  events: boolean;
}

function parse(argv: string[]): { mode: "single" | "phase0" | "shortlist"; opts: Omit<Options, "restaurants">; flags: Map<string, string> } {
  const flags = new Map<string, string>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) bools.add(a.slice(2));
    else {
      flags.set(a.slice(2), next);
      i++;
    }
  }
  const mode = bools.has("phase2-shortlist") ? "shortlist" : bools.has("phase0-set") ? "phase0" : "single";
  return { mode, opts: { tavily: !bools.has("no-tavily"), json: bools.has("json"), events: bools.has("events") }, flags };
}

function phase0Restaurants(): ResolverRestaurant[] {
  const file = "scripts/phase0/out/t2_results.json";
  if (!existsSync(file)) throw new Error(`${file} not found (local Phase 0 output, not committed)`);
  const rows = JSON.parse(readFileSync(file, "utf8")) as Array<{ name: string; site: string }>;
  const list: ResolverRestaurant[] = rows.map((r, i) => ({ placeId: `p0-${i}`, name: r.name.split("|")[0].trim(), city: "Barcelona", websiteUrl: r.site }));
  list.unshift({ placeId: "p0-tulsi", name: "Vegan Tulsi Restaurant", address: "Carrer dels Àngels, 8, 08001 Barcelona", city: "Barcelona", websiteUrl: "https://www.vegan-tulsi.com/" });
  return list;
}

async function shortlistRestaurants(): Promise<ResolverRestaurant[]> {
  const env = loadEnv();
  const body = RecommendRequestBody.parse({
    form: { city: "Barcelona", meal: "dinner", diet: ["vegetarian"], cuisines: ["Italian"], budget: { max: 30, currency: "EUR" } },
  });
  const result = await runDiscovery(body, { places: createPlacesClient(env), emitter: createEventEmitter(() => undefined) });
  return result.selected.map((e) => ({
    placeId: e.placeId,
    name: e.name,
    address: e.discovered.restaurant.address,
    city: "Barcelona",
    websiteUrl: e.discovered.restaurant.websiteUrl,
    websiteHttpsCandidate: e.discovered.restaurant.websiteHttpsCandidate,
  }));
}

const pad = (v: unknown, n: number) => String(v ?? "-").slice(0, n).padEnd(n);

function row(r: MenuResolution): string {
  const sel = r.selected;
  const top = sel[0];
  const kinds = [...new Set(sel.map((s) => s.documentKind))].join("+") || "-";
  const detail = r.status === "found_but_unreadable" ? r.unreadableReason : r.status === "unavailable" ? r.unavailableReason : r.status === "failed" ? r.failureReason : `${sel.length} doc${sel.length === 1 ? "" : "s"}`;
  return [
    pad(r.restaurantName, 26),
    pad(r.status, 20),
    pad(detail, 18),
    pad(top?.tier ?? "-", 16),
    pad(kinds, 22),
    pad([...new Set(sel.map((s) => s.mediaType))].join("+") || "-", 9),
    pad(r.usage.directFetches, 4),
    pad(`${r.usage.tavilySearches}/${r.usage.tavilyExtracts}`, 5),
    pad(r.usage.geminiCalls, 3),
    pad(`${r.durationMs}ms`, 8),
  ].join(" ");
}

async function main(): Promise<void> {
  const { mode, opts, flags } = parse(process.argv.slice(2));
  const env = loadEnv();

  let restaurants: ResolverRestaurant[];
  if (mode === "phase0") restaurants = phase0Restaurants();
  else if (mode === "shortlist") restaurants = await shortlistRestaurants();
  else {
    const name = flags.get("restaurant");
    if (!name) throw new Error('Usage: npm run phase4 -- --restaurant "Name" --website https://... [--address "..."] | --phase0-set | --phase2-shortlist [--no-tavily] [--json] [--events]');
    restaurants = [{ placeId: "dev-1", name, address: flags.get("address"), city: flags.get("city") ?? "Barcelona", websiteUrl: flags.get("website") }];
  }
  const only = flags.get("only");
  if (only) restaurants = restaurants.filter((r) => r.name.toLowerCase().includes(only.toLowerCase()));

  const events: unknown[] = [];
  const emitter = createEventEmitter((e) => events.push(e));
  const search = opts.tavily && env.TAVILY_API_KEY ? createTavilyClient(env) : undefined;

  const started = Date.now();
  const results = await resolveMenus(restaurants, { fetcher: defaultFetcher, search, emitter, restaurantConcurrency: 3, fetchConcurrency: 6, tavilyConcurrency: 2 });
  const wall = Date.now() - started;

  if (opts.json) {
    console.log(JSON.stringify({ results, events: opts.events ? events : undefined }, null, 2));
    return;
  }

  console.log(`\n${[pad("restaurant", 26), pad("status", 20), pad("reason/docs", 18), pad("tier", 16), pad("kind", 22), pad("media", 9), pad("get", 4), pad("tav", 5), pad("gem", 3), pad("time", 8)].join(" ")}`);
  console.log("-".repeat(140));
  for (const r of results) console.log(row(r));

  const totals = results.reduce(
    (t, r) => ({
      get: t.get + r.usage.directFetches,
      search: t.search + r.usage.tavilySearches,
      extract: t.extract + r.usage.tavilyExtracts,
      credits: t.credits + r.usage.tavilyCredits,
      gemini: t.gemini + r.usage.geminiCalls,
      mb: t.mb + r.usage.bytesFetched,
    }),
    { get: 0, search: 0, extract: 0, credits: 0, gemini: 0, mb: 0 },
  );
  console.log("-".repeat(140));
  console.log(`totals: ${results.length} restaurants, ${totals.get} direct fetches, tavily ${totals.search} searches + ${totals.extract} extracts (~${totals.credits} credits), gemini ${totals.gemini}, ${(totals.mb / 1e6).toFixed(1)} MB, wall ${wall} ms`);

  for (const r of results) {
    console.log(`\n${r.restaurantName}  [${r.status}]`);
    const website = restaurants.find((x) => x.placeId === r.restaurantId)?.websiteUrl;
    console.log(`  website: ${website ?? "(none)"}${r.httpsUpgrade ? `  https upgrade: ${r.httpsUpgrade.succeeded ? "ok" : "failed"}` : ""}`);
    for (const s of r.selected) console.log(`  + ${s.documentKind.padEnd(18)} ${s.mediaType.padEnd(13)} ${s.tier.padEnd(16)} conf ${s.confidence.toFixed(2)} ${s.url.slice(0, 100)}`);
    if (r.status === "found_but_unreadable") console.log(`  ! official menu (${r.unreadableReason}): ${r.officialMenuUrl.slice(0, 110)}`);
    const rejected = r.candidates.filter((c) => c.rejectedReason).slice(0, 3);
    for (const c of rejected) console.log(`  x rejected ${c.url.slice(0, 80)}: ${c.rejectedReason}`);
    const skipped = r.candidates.filter((c) => !c.selected && !c.rejectedReason && c.documentKind !== "unknown").slice(0, 4);
    for (const c of skipped) console.log(`  - not selected: ${c.documentKind} ${c.mediaType} ${c.url.slice(0, 80)}`);
    for (const s of r.stages) console.log(`  stage ${s.stage.padEnd(11)} found=${s.found} candidates=${s.candidates} get=${s.directFetches} tavily=${s.tavilySearches}/${s.tavilyExtracts}${s.queries.length ? ` q=${s.queries.join(" | ").slice(0, 100)}` : ""}`);
    for (const w of r.warnings) console.log(`  warning: ${w}`);
  }
  if (opts.events) console.log(`\n${events.length} agent events emitted`);
  console.log("");
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error");
  process.exit(1);
});
