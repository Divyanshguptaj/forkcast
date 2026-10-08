import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadEnv } from "@/config/env";
import { normalizeRequest } from "@/server/discovery/normalizeRequest";
import { RecommendationSetSchema, type RecommendationSet } from "@/schemas/recommendations";
import { UserRequestSchema, type UserRequest } from "@/schemas/request";
import { recommend, type RecommendCandidate } from "@/server/ranking";
import { runLive } from "./liveRun";

const SCENARIOS: Record<string, { description: string; form: Partial<UserRequest> }> = {
  "veg-italian-dinner-30": {
    description: "Vegetarian Italian dinner under EUR 30 in Barcelona",
    form: { meal: "dinner", diet: ["vegetarian"], cuisines: ["Italian"], budget: { max: 30, currency: "EUR", perPerson: true } },
  },
  "vegan-lunch-15": {
    description: "Vegan lunch under EUR 15 in Barcelona",
    form: { meal: "lunch", diet: ["vegan"], budget: { max: 15, currency: "EUR", perPerson: true } },
  },
  "no-exact": {
    description: "Vegan Japanese dinner under EUR 10 (designed to have no exact match)",
    form: { meal: "dinner", diet: ["vegan"], cuisines: ["Japanese"], budget: { max: 10, currency: "EUR", perPerson: true } },
  },
  "missing-prices": {
    description: "Vegetarian Italian dinner under EUR 20 (menus without prices)",
    form: { meal: "dinner", diet: ["vegetarian"], cuisines: ["Italian"], budget: { max: 20, currency: "EUR", perPerson: true } },
  },
  "multi-constraint": {
    description: "Vegetarian + gluten-free, peanut allergy, no mushrooms, EUR 25, Mediterranean dinner",
    form: { meal: "dinner", diet: ["vegetarian", "gluten_free"], allergies: ["peanuts"], dislikedFoods: ["mushrooms"], cuisines: ["Mediterranean"], budget: { max: 25, currency: "EUR", perPerson: true } },
  },
};

interface Recording {
  recordedAt: string;
  scenario: string;
  request: UserRequest;
  cuisines: string[];
  discoveredCount?: number;
  candidates: RecommendCandidate[];
  run?: Record<string, unknown>;
}

function sanitize(c: RecommendCandidate): RecommendCandidate {
  const { phone: _phone, sampledReviews: _reviews, ...restaurant } = c.restaurant as RecommendCandidate["restaurant"] & { phone?: string };
  void _phone;
  void _reviews;
  return { ...c, restaurant: { ...restaurant, sampledReviews: [] } };
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

const money = (n: number | undefined) => (n === undefined ? "-" : `€${n.toFixed(2)}`);

function print(set: RecommendationSet): void {
  console.log(`\nconstraints: ${set.constraints.map((c) => `${c.label}${c.strength === "hard" ? "" : " (soft)"}`).join(" | ")}`);
  console.log(`outcome: ${set.outcome} | exact ${set.stats.exact} | alternatives ${set.stats.alternatives} | excluded ${set.stats.excluded} | with menu ${set.stats.withMenu}/${set.stats.considered}`);
  for (const n of set.notices) console.log(`notice: ${n}`);
  for (const r of set.recommendations) {
    console.log(`\n#${r.rank} ${r.name}  [${r.tier}] ${r.categoryLabel}  score ${r.score}  (${r.exactDishCount} verified, ${r.possibleDishCount} likely, ${r.menuDishCount} dishes read, menu ${r.menuStatus})`);
    console.log(`   score: ${r.components.map((c) => `${c.key} ${c.value === null ? "-" : c.value.toFixed(2)}x${c.weight.toFixed(2)}`).join(" ")}`);
    for (const x of r.reasons) console.log(`   + ${x.text}`);
    for (const d of r.dishes) {
      const price = d.price.amount !== undefined ? `${money(d.price.amount)} ${d.price.status}${d.price.alternateAmount ? ` (alt ${money(d.price.alternateAmount)})` : ""}` : "no price";
      console.log(`   - [${d.fit}] ${d.name}${d.translatedName ? ` / ${d.translatedName}` : ""} | ${price} | ${d.diet.map((x) => `${x.diet}:${x.status}/${x.basis}`).join(",")} | ${d.role}`);
    }
    for (const x of r.unmet) console.log(`   x ${x}`);
    for (const x of r.uncertainties) console.log(`   ? ${x}`);
    for (const s of r.menuSources) console.log(`   src ${s.tier} ${s.method ?? ""} ${s.url.slice(0, 90)}`);
  }
  for (const e of set.excluded) console.log(`\nexcluded: ${e.name} [${e.code}] ${e.reason}`);
}

async function main(): Promise<void> {
  const { flags, bools } = flagsFrom(process.argv.slice(2));
  const scenarioId = flags.get("scenario") ?? "veg-italian-dinner-30";
  const scenario = SCENARIOS[scenarioId];
  if (!scenario) throw new Error(`Unknown scenario "${scenarioId}". Choose: ${Object.keys(SCENARIOS).join(", ")}`);

  const replay = flags.get("replay");
  let candidates: RecommendCandidate[];
  let request: UserRequest;
  let cuisines: string[];
  let runInfo: Record<string, unknown> | undefined;
  let discoveredCount: number | undefined;
  console.log(`scenario: ${scenarioId} - ${scenario.description}`);

  if (replay) {
    const rec = JSON.parse(readFileSync(replay, "utf8")) as Recording;
    const normalized = normalizeRequest(UserRequestSchema.parse({ city: "Barcelona", ...scenario.form }));
    candidates = rec.candidates;
    request = normalized.request;
    cuisines = normalized.cuisines;
    console.log(`replaying ${rec.candidates.length} recorded restaurants from ${replay} (recorded for "${rec.scenario}"); no API calls`);
  } else {
    const env = loadEnv();
    const run = await runLive(scenario.form, env, { llm: !bools.has("no-llm") });
    candidates = run.candidates;
    request = run.discovery.normalized.request;
    cuisines = run.discovery.normalized.cuisines;
    discoveredCount = run.discovery.discovered.length;
    const gem = run.llm?.stats;
    const s = run.extractStats;
    runInfo = {
      timings: run.timings,
      gemini: { logicalRequests: s.llmRequests, vision: s.visionRequests, priceChecks: s.priceCheckRequests, inputTokens: s.inputTokens, outputTokens: s.outputTokens, cacheHits: s.cacheHits, quotaSkipped: s.quotaSkipped, modelLatencyMs: s.modelLatencyMs, httpRequests: gem?.requests, retries: gem?.retries, skippedByBreaker: gem?.skippedByBreaker, byModel: gem?.byModel, failures: gem?.failures, blocked: run.llm?.blockedModels() },
      tavily: { searches: run.resolutions.reduce((n, r) => n + r.usage.tavilySearches, 0), extracts: run.resolutions.reduce((n, r) => n + r.usage.tavilyExtracts, 0) },
      placesCalls: run.discovery.placesCalls.length,
    };
    console.log(`discovery ${run.timings.discoveryMs} ms | resolve ${run.timings.resolveMs} ms | extract ${run.timings.extractMs} ms`);
    console.log(`run: ${JSON.stringify(runInfo)}`);
  }

  const t = performance.now();
  const set = recommend({ request, cuisines, candidates });
  const recommendMs = performance.now() - t;
  const parsed = RecommendationSetSchema.safeParse(set);
  if (!parsed.success) throw new Error(`RecommendationSet failed validation: ${JSON.stringify(parsed.error.issues.slice(0, 3))}`);

  const record = flags.get("record");
  if (record) {
    mkdirSync(dirname(record), { recursive: true });
    const rec: Recording = { recordedAt: new Date().toISOString(), scenario: scenarioId, request, cuisines, discoveredCount, candidates: candidates.map(sanitize), run: runInfo };
    writeFileSync(record, `${JSON.stringify(rec, null, 2)}\n`);
    console.log(`recorded ${candidates.length} restaurants to ${record}`);
  }

  if (bools.has("json")) console.log(JSON.stringify(set, null, 2));
  else print(set);
  console.log(`\nrecommend(): ${recommendMs.toFixed(2)} ms, 0 Gemini calls`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error");
  process.exit(1);
});
