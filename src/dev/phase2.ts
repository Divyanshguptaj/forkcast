import { readFileSync } from "node:fs";
import { loadEnv } from "@/config/env";
import { flagsFromEnv } from "@/config/flags";
import { RecommendRequestBody, type RecommendRequestBodyType } from "@/schemas/request";
import { createEventEmitter } from "@/server/agent/events";
import { runDiscovery } from "@/server/discovery/pipeline";
import { createPlacesClient } from "@/server/providers/places/client";

interface CliOptions {
  body: RecommendRequestBodyType;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const flags = new Map<string, string[]>();
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") json = true;
    else if (arg.startsWith("--")) {
      const list = flags.get(arg.slice(2)) ?? [];
      list.push(argv[++i] ?? "");
      flags.set(arg.slice(2), list);
    }
  }

  const file = flags.get("request")?.[0];
  if (file) return { body: RecommendRequestBody.parse(JSON.parse(readFileSync(file, "utf8"))), json };

  const one = (k: string) => flags.get(k)?.[0];
  const many = (k: string) => flags.get(k) ?? [];
  const budget = one("budget");
  return {
    json,
    body: RecommendRequestBody.parse({
      form: {
        city: one("city") ?? "Barcelona",
        meal: one("meal") ?? "dinner",
        diet: many("diet").length ? many("diet") : ["vegetarian"],
        cuisines: many("cuisine").length ? many("cuisine") : ["Italian"],
        budget: { max: budget ? Number(budget) : 30, currency: "EUR" },
        preferences: many("pref").length ? many("pref") : ["not too crowded"],
        partySize: one("party") ? Number(one("party")) : undefined,
      },
    }),
  };
}

function line(label: string, value: unknown): string {
  return `  ${label.padEnd(16)} ${value ?? "-"}`;
}

async function main(): Promise<void> {
  const env = loadEnv();
  const flags = flagsFromEnv(env);
  const { body, json } = parseArgs(process.argv.slice(2));
  const places = createPlacesClient(env);
  const events: unknown[] = [];
  const emitter = createEventEmitter((e) => events.push(e));

  const result = await runDiscovery(body, { places, emitter });

  if (json) {
    const slim = {
      normalized: result.normalized,
      queries: result.queries,
      placesCalls: result.placesCalls,
      discovered: result.discovered.length,
      retained: result.retained,
      excluded: result.excluded,
      selected: result.selected.map(({ discovered, ...rest }) => ({ ...rest, restaurant: discovered.restaurant })),
      events,
    };
    console.log(JSON.stringify(slim, null, 2));
    return;
  }

  console.log("\nNormalized request");
  const r = result.normalized.request;
  console.log(line("city", r.city), "\n" + line("meal", r.meal), "\n" + line("diet", r.diet.join(", ")));
  console.log(line("cuisines", result.normalized.cuisines.join(", ")));
  console.log(line("budget", r.budget ? `<= ${r.budget.max} EUR` : "-"));
  console.log(line("unresolved", result.normalized.unresolvedPreferences.join("; ") || "-"));
  for (const w of result.normalized.warnings) console.log(line("warning", w));

  console.log("\nPlaces queries used");
  for (const c of result.placesCalls) {
    console.log(`  ${c.queryId}: "${c.text}" -> ${c.returned} results, ${c.droppedUnmappable} dropped, ${c.latencyMs} ms${c.error ? ` ERROR ${c.error}` : ""}`);
  }
  console.log(line("places calls", result.placesCalls.length), "\n" + line("reviews to LLM", flags.placesReviewsToLlm));

  console.log(`\nCandidates found: ${result.discovered.length}   retained: ${result.retained}   excluded: ${result.excluded.length}`);
  for (const e of result.excluded) console.log(`  x ${e.name} [${e.rule}] ${e.reason}`);

  console.log("\nShortlisted restaurants:");
  result.selected.forEach((e, i) => {
    const d = e.discovered.restaurant;
    console.log(`${i + 1}. ${d.name}  (score ${e.shortlistScore.toFixed(2)})`);
    console.log(line("rating", `${d.rating ?? "-"} (${d.ratingCount ?? 0} reviews, confidence ${e.ratingConfidence})`));
    console.log(line("price level", d.priceLevel));
    console.log(line("website", d.websiteUrl));
    if (d.websiteHttpsCandidate) console.log(line("https candidate", `${d.websiteHttpsCandidate} (unverified)`));
    console.log(line("maps", d.mapsUrl));
    console.log(line("distance km", e.distanceKm));
    console.log(line("veg signal", d.servesVegetarianFood));
    for (const s of e.signals) {
      console.log(`      ${s.name.padEnd(17)} ${s.value === null ? "n/a  " : s.value.toFixed(2)} w=${s.weight.toFixed(2)} +${s.contribution.toFixed(3)}  ${s.note}`);
    }
  });

  const notSelected = result.shortlist.filter((e) => !e.included).slice(0, 8);
  if (notSelected.length) {
    console.log("\nNext in line (not selected):");
    for (const e of notSelected) console.log(`  ${e.name} (${e.shortlistScore.toFixed(2)}) ${e.reason}`);
  }

  console.log("\nAgent events emitted:");
  for (const e of events as Array<{ seq: number; type: string }>) console.log(`  #${e.seq} ${e.type}`);
  console.log(`\nDone in ${result.durationMs} ms\n`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error");
  process.exit(1);
});
