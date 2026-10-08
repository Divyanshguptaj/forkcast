import { loadEnv } from "@/config/env";
import type { AgentEvent } from "@/schemas/events";
import { createEventEmitter } from "@/server/agent/events";
import { DEFAULT_RUN_LIMITS, runRecommendation, type RunLimits } from "@/server/agent/run";
import { ExtractionCache } from "@/server/menu/extract/modelCache";
import { defaultFetcher } from "@/server/menu/resolver";
import { createGeminiClient } from "@/server/providers/gemini/client";
import { createPlacesClient } from "@/server/providers/places/client";
import { createTavilyClient } from "@/server/providers/tavily/client";

function flagsFrom(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--") && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags.set(argv[i].slice(2), argv[++i]);
  return flags;
}

async function once(text: string, limits: Partial<RunLimits>, label: string) {
  const env = loadEnv();
  const events: AgentEvent[] = [];
  const emitter = createEventEmitter((e) => events.push(e));
  const llm = env.GEMINI_API_KEY ? createGeminiClient(env) : undefined;
  const t0 = Date.now();
  const out = await runRecommendation({ text }, { env, places: createPlacesClient(env), search: env.TAVILY_API_KEY ? createTavilyClient(env) : undefined, llm, fetcher: defaultFetcher, emitter, signal: new AbortController().signal, limits, modelCache: new ExtractionCache() });
  const wall = Date.now() - t0;
  const base = Date.parse(events[0]?.ts ?? new Date().toISOString());
  const rel = (e?: AgentEvent) => (e ? (Date.parse(e.ts) - base) / 1000 : NaN);
  const set = events.find((e) => e.type === "recommendations.ready");
  const m = out.metrics;
  console.log(`\n[${label}] ${text}`);
  console.log(`  outcome ${out.outcome} wall ${(wall / 1000).toFixed(1)}s | discover ${((m?.phases.understandAndDiscoverMs ?? 0) / 1000).toFixed(1)}s research ${((m?.phases.researchMs ?? 0) / 1000).toFixed(1)}s rank ${m?.phases.rankMs}ms`);
  console.log(`  places ${m?.placesCalls} | tavily credits ${m?.tavily.credits} (searches ${m?.tavily.searches}, extracts ${m?.tavily.extracts}) | page fetches ${m?.fetch.requests}, ${((m?.fetch.bytes ?? 0) / 1e6).toFixed(1)} MB`);
  console.log(`  gemini: understand ${m?.gemini.understandRequests} extract ${m?.gemini.extractionRequests} vision ${m?.gemini.visionRequests} priceCheck ${m?.gemini.priceChecks} | http ${m?.gemini.httpRequests} failures ${m?.gemini.failures} cacheHits ${m?.gemini.cacheHits} | tokens ${m?.gemini.inputTokens}/${m?.gemini.outputTokens} | est $${m?.cost.totalUsd}`);
  console.log(`  gemini http by model ${JSON.stringify(llm?.stats.byModel)} failures ${JSON.stringify(llm?.stats.failures)} skippedByBreaker ${llm?.stats.skippedByBreaker} retries ${llm?.stats.retries}`);
  const shortlist = events.find((e) => e.type === "shortlist.done");
  if (shortlist?.type === "shortlist.done") {
    for (const r of shortlist.restaurants) {
      const mine = events.filter((e) => "id" in e && e.id === r.id);
      const resolved = mine.find((e) => e.type === "menu.resolved");
      const extracted = mine.find((e) => e.type === "menu.extracted");
      console.log(`  ${r.name.slice(0, 26).padEnd(27)} resolved ${rel(resolved).toFixed(1)}s extracted ${Number.isNaN(rel(extracted)) ? "-" : `${rel(extracted).toFixed(1)}s`} ${extracted?.type === "menu.extracted" ? `${extracted.status} ${extracted.dishCount} dishes` : ""}`);
    }
  }
  if (set?.type === "recommendations.ready") console.log(`  result: ${set.payload.recommendations.map((r) => `${r.tier}:${r.name.slice(0, 18)}(${r.score})`).join(" | ")}`);
}

async function main() {
  const flags = flagsFrom(process.argv.slice(2));
  const text = flags.get("text") ?? "vegetarian Italian dinner under €30";
  const runs = Number(flags.get("runs") ?? 1);
  const variants: Array<[string, Partial<RunLimits>]> = [];
  const concurrency = (flags.get("concurrency") ?? `${DEFAULT_RUN_LIMITS.restaurantConcurrency}`).split(",").map(Number);
  for (const c of concurrency) variants.push([`restaurantConcurrency=${c}`, { restaurantConcurrency: c }]);
  for (let i = 0; i < runs; i++) for (const [label, limits] of variants) await once(text, limits, `${label} run ${i + 1}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error");
  process.exit(1);
});
