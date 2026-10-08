import { loadEnv } from "@/config/env";
import { normalizeText } from "@/lib/text";
import type { AgentEvent } from "@/schemas/events";
import type { MatchedRestaurant, RecommendationSet } from "@/schemas/recommendations";
import { createEventEmitter } from "@/server/agent/events";
import { runRecommendation } from "@/server/agent/run";
import { ExtractionCache } from "@/server/menu/extract/modelCache";
import { checkPriceInSource } from "@/server/menu/extract/price";
import { nameInSource } from "@/server/menu/extract/validate";
import { defaultFetcher } from "@/server/menu/resolver";
import { analyzeHtml } from "@/server/menu/resolver/htmlInspector";
import { extractPdfPages } from "@/server/menu/resolver/pdfProbe";
import { createGeminiClient } from "@/server/providers/gemini/client";
import { createPlacesClient } from "@/server/providers/places/client";
import { createTavilyClient } from "@/server/providers/tavily/client";

const collapse = (value: string) => normalizeText(value).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

async function sourceText(url: string): Promise<string | undefined> {
  try {
    const res = await defaultFetcher.fetch(url, {});
    if (!res.ok) return undefined;
    if (res.kind === "pdf") {
      const pdf = await extractPdfPages(res.bytes, 30);
      return pdf?.pages.join("\n");
    }
    if (res.kind === "html" || res.kind === "text") {
      const raw = Buffer.from(res.bytes).toString("utf8");
      return res.kind === "html" ? analyzeHtml(raw, res.url).text : raw;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

interface Finding {
  restaurant: string;
  kind: string;
  detail: string;
}

async function audit(set: RecommendationSet, websites: Map<string, string | undefined>): Promise<{ checked: Record<string, number>; findings: Finding[] }> {
  const checked: Record<string, number> = { restaurants: 0, dishes: 0, dishInSource: 0, dishUnverifiable: 0, pricesChecked: 0, pricesVerified: 0, labelsChecked: 0, labelsFound: 0, budgetViolations: 0, officialSources: 0, otherSources: 0 };
  const findings: Finding[] = [];
  const budget = Number(set.constraints.find((c) => c.kind === "budget")?.value);
  const texts = new Map<string, string | undefined>();

  for (const r of set.recommendations) {
    checked.restaurants++;
    const site = websites.get(r.restaurantId);
    const host = site ? new URL(site).hostname.replace(/^www\./, "") : undefined;
    for (const s of r.menuSources) {
      const sourceHost = new URL(s.url).hostname.replace(/^www\./, "");
      const official = s.tier === "official_site" || s.tier === "official_linked" || (host !== undefined && (sourceHost === host || sourceHost.endsWith(`.${host}`)));
      if (official) checked.officialSources++;
      else {
        checked.otherSources++;
        findings.push({ restaurant: r.name, kind: "menu_source_not_on_official_domain", detail: `${s.tier} ${s.url}` });
      }
    }
    const generic = new Set(["restaurant", "restaurante", "restaurant", "pizzeria", "trattoria", "bistro", "barcelona", "cocina", "italiana", "italiano", "pizza", "napoletana", "osteria", "cantina"]);
    const tokens = collapse(r.name).split(" ").filter((t) => t.length >= 4 && !generic.has(t));
    for (const s of r.menuSources) {
      if (!texts.has(s.url)) texts.set(s.url, s.method === "vision" ? undefined : await sourceText(s.url));
      const body = texts.get(s.url);
      checked.identityChecked = (checked.identityChecked ?? 0) + 1;
      const haystack = `${collapse(s.url)} ${body ? collapse(body) : ""}`;
      if (body === undefined && s.method !== "vision") findings.push({ restaurant: r.name, kind: "identity_unverifiable_source_not_refetchable", detail: s.url });
      else if (tokens.length > 0 && tokens.some((t) => haystack.includes(t))) checked.identityConfirmed = (checked.identityConfirmed ?? 0) + 1;
      else if (s.tier !== "official_site" && s.tier !== "official_linked") findings.push({ restaurant: r.name, kind: "identity_not_confirmed_in_source", detail: `${s.tier} ${s.url}` });
    }
    for (const d of r.dishes) {
      checked.dishes++;
      if (!texts.has(d.source.url)) texts.set(d.source.url, d.source.method === "vision" ? undefined : await sourceText(d.source.url));
      const text = texts.get(d.source.url);
      if (text === undefined) {
        checked.dishUnverifiable++;
        continue;
      }
      const norm = collapse(text);
      if (nameInSource(norm, d.name)) checked.dishInSource++;
      else findings.push({ restaurant: r.name, kind: "dish_not_in_source", detail: `${d.name} @ ${d.source.url}` });

      if (d.price.amount !== undefined && !d.price.setMenuName && (d.price.status === "verified" || d.price.status === "ocr_agreed")) {
        checked.pricesChecked++;
        const outcome = checkPriceInSource(text, d.name, d.price.amount);
        if (outcome === "verified") checked.pricesVerified++;
        else findings.push({ restaurant: r.name, kind: `price_${outcome}`, detail: `${d.name} ${d.price.amount}` });
        if (Number.isFinite(budget) && d.fit === "exact" && d.price.amount > budget) {
          checked.budgetViolations++;
          findings.push({ restaurant: r.name, kind: "exact_dish_over_budget", detail: `${d.name} ${d.price.amount} > ${budget}` });
        }
      }
      for (const diet of d.diet.filter((x) => x.status === "confirmed" && x.basis === "menu_label")) {
        checked.labelsChecked++;
        const around = norm.indexOf(collapse(d.name).slice(0, 25));
        const window = around >= 0 ? norm.slice(Math.max(0, around - 60), around + 260) : "";
        if (/\b(v|ve|vg|veg|plant based|vegan|vegano|vegana|vegetarian|vegetariano|vegetariana|vegetarià|gluten free|sin gluten|sense gluten)\b/.test(window) || /vegetarian|vegan/.test(collapse(d.source.evidence ?? ""))) checked.labelsFound++;
        else findings.push({ restaurant: r.name, kind: "label_not_found_near_dish", detail: `${d.name} (${diet.diet}) evidence "${d.source.evidence ?? ""}"` });
      }
      if (d.fit === "exact" && d.diet.some((x) => x.status !== "confirmed")) findings.push({ restaurant: r.name, kind: "exact_without_confirmed_diet", detail: d.name });
    }
    reasonChecks(r, findings);
  }
  return { checked, findings };
}

function reasonChecks(r: MatchedRestaurant, findings: Finding[]): void {
  const shown = new Set(r.dishes.map((d) => d.dishId));
  for (const reason of r.reasons) for (const id of reason.dishIds) if (!shown.has(id)) findings.push({ restaurant: r.name, kind: "reason_cites_unshown_dish", detail: reason.text.slice(0, 80) });
  if (r.tier === "exact") {
    for (const o of r.outcomes.filter((x) => x.strength === "hard" && x.verdict !== "met" && x.kind !== "allergy" && x.kind !== "dislike")) findings.push({ restaurant: r.name, kind: "exact_with_unmet_hard_constraint", detail: `${o.label}: ${o.verdict}` });
  }
}

async function main() {
  const text = process.argv[2];
  if (!text) throw new Error('Usage: npm run audit -- "vegetarian Italian dinner under €30"');
  const env = loadEnv();
  const baseRss = process.memoryUsage().rss;
  let peakRss = baseRss;
  const sampler = setInterval(() => (peakRss = Math.max(peakRss, process.memoryUsage().rss)), 150);
  const events: AgentEvent[] = [];
  const emitter = createEventEmitter((e) => events.push(e));
  const llm = env.GEMINI_API_KEY ? createGeminiClient(env) : undefined;
  const out = await runRecommendation({ text }, { env, places: createPlacesClient(env), search: env.TAVILY_API_KEY ? createTavilyClient(env) : undefined, llm, fetcher: defaultFetcher, emitter, signal: new AbortController().signal, modelCache: new ExtractionCache() });
  clearInterval(sampler);
  const ready = events.find((e) => e.type === "recommendations.ready");
  if (ready?.type !== "recommendations.ready") throw new Error(`No recommendations (${out.outcome})`);
  const set = ready.payload;
  const websites = new Map<string, string | undefined>();
  for (const r of set.recommendations) websites.set(r.restaurantId, r.links.find((l) => l.kind === "website")?.url);

  console.log(`\n"${text}" -> ${set.outcome}, ${set.recommendations.length} recommended (${out.metrics ? (out.metrics.totalMs / 1000).toFixed(1) : "?"}s)`);
  for (const r of set.recommendations) console.log(`  #${r.rank} [${r.tier}] ${r.name} score ${r.score}: ${r.dishes.slice(0, 3).map((d) => `${d.name}${d.price.amount !== undefined ? ` ${d.price.amount}` : ""}`).join("; ")}`);
  console.log(`  memory: rss ${(baseRss / 1e6).toFixed(0)} MB -> peak ${(peakRss / 1e6).toFixed(0)} MB (+${((peakRss - baseRss) / 1e6).toFixed(0)} MB) | gemini calls understand ${out.metrics?.gemini.understandRequests ?? 0} + extract ${out.metrics?.gemini.extractionRequests ?? 0} + price checks ${out.metrics?.gemini.priceChecks ?? 0} (http ${out.metrics?.gemini.httpRequests ?? 0}), tavily credits ${out.metrics?.tavily.credits ?? 0}, page fetches ${out.metrics?.fetch.requests ?? 0} (${((out.metrics?.fetch.bytes ?? 0) / 1e6).toFixed(1)} MB)`);
  const { checked, findings } = await audit(set, websites);
  console.log(`  checked: ${JSON.stringify(checked)}`);
  if (findings.length === 0) console.log("  findings: none");
  for (const f of findings) console.log(`  FINDING ${f.kind}: ${f.restaurant} - ${f.detail}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.name}: ${err.message}` : "Unknown error");
  process.exit(1);
});
