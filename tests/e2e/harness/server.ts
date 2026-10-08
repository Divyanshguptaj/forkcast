// Test harness: serves the real /api/recommend handler and orchestrator with deterministic FAKE providers.
// Playwright redirects the browser's API call here so the real client, handler, orchestrator, resolver, extractor and ranking all run.
import { createServer } from "node:http";
import { Readable } from "node:stream";
import { loadEnv } from "@/config/env";
import { RateLimiter } from "@/server/http/rateLimit";
import { createRecommendHandler, type Providers } from "@/server/http/recommendHandler";
import { fakeFetcher, html, makeTextPdf, nav } from "../../helpers/resolverKit";
import { dish as modelDish, fakeLlm, modelDoc, verdict } from "../../helpers/extractKit";
import { restaurant } from "../../helpers/places";

const PORT = Number(process.env.HARNESS_PORT ?? 3130);
const env = loadEnv({ GOOGLE_PLACES_API_KEY: "fake-places-key", GEMINI_API_KEY: "fake-gemini-key" });
const SITES = [
  { id: "h1", name: "Casa Uno", host: "uno.example" },
  { id: "h2", name: "Casa Dos", host: "dos.example" },
  { id: "h3", name: "Casa Tres", host: "tres.example" },
];
const MENU = ["ENTRANTES", "Ensalada de tomate (V) 8,50 €", "Croquetas de jamón 9,00 €", "PRINCIPALES", "Risotto de setas (V) 14,50 €", "Entrecot de ternera 22,00 €"];

const states = new Map<string, { started: number; completed: number; aborted: number }>();
const stateOf = (tag: string) => states.get(tag) ?? states.set(tag, { started: 0, completed: 0, aborted: 0 }).get(tag)!;

function providersFor(scenario: string): Providers {
  const table: Record<string, string | Uint8Array | { body: string; delayMs: number }> = {};
  for (const s of SITES) {
    const delayMs = scenario === "slow" ? 20_000 : undefined;
    table[`https://${s.host}/`] = scenario === "nomenu" ? html("<p>Bienvenidos</p>") : delayMs ? { body: html(nav([["Carta", "/carta.pdf"]])), delayMs } : html(nav([["Carta", "/carta.pdf"]]));
    table[`https://${s.host}/carta.pdf`] = makeTextPdf([MENU]);
  }
  const llm = fakeLlm((req) => {
    if (req.label === "understand-request") return { meal: "dinner", diet: ["vegetarian"], allergies: [], dislikedFoods: [], cuisines: ["italian"], mustHave: [], preferences: [], budgetMax: 30 };
    const id = (req.parts[0] as { text: string }).text.match(/id="([^"]+)"/)![1];
    return {
      documents: [
        modelDoc(id, [
          modelDish("Ensalada de tomate (V)", { priceRaw: "8,50 €", section: "ENTRANTES", vegetarian: verdict("confirmed", "menu_label", "(V)") }),
          modelDish("Risotto de setas (V)", { priceRaw: "14,50 €", section: "PRINCIPALES", vegetarian: verdict("confirmed", "menu_label", "(V)") }),
          modelDish("Croquetas de jamón", { priceRaw: "9,00 €", section: "ENTRANTES" }),
        ]),
      ],
    };
  });
  if (scenario === "quota") llm.exhausted = true;
  return {
    places: {
      async searchText() {
        const restaurants = SITES.map((s) => restaurant({ placeId: s.id, name: s.name, address: `Carrer ${s.name}, Barcelona`, websiteUrl: `https://${s.host}/`, sourceId: `places:${s.id}`, types: ["italian_restaurant", "restaurant"], primaryType: "italian_restaurant", servesDinner: true }));
        return { restaurants, sources: [], droppedUnmappable: 0, latencyMs: 1 };
      },
    },
    llm,
    fetcher: fakeFetcher(table as never),
  };
}

const handler = createRecommendHandler({
  env: () => env,
  providers: (_env, req) => providersFor(req.headers.get("x-scenario") ?? "default"),
  limiter: new RateLimiter({ maxRequests: 1000, maxConcurrentTotal: 50, maxConcurrentPerClient: 50 }),
  log: () => undefined,
});

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type,x-scenario,x-tag", "access-control-allow-methods": "POST,GET,OPTIONS" };

createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS).end();
    return;
  }
  if (req.url?.startsWith("/__state")) {
    const tag = new URL(req.url, "http://x").searchParams.get("tag") ?? "";
    res.writeHead(200, { ...CORS, "content-type": "application/json" }).end(JSON.stringify(stateOf(tag)));
    return;
  }
  const tag = String(req.headers["x-tag"] ?? "none");
  stateOf(tag).started++;
  const abort = new AbortController();
  let finished = false;
  res.on("close", () => {
    if (!finished) stateOf(tag).aborted++;
    abort.abort();
  });
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const request = new Request(`http://localhost:${PORT}${req.url}`, { method: req.method, headers, body: req.method === "POST" ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined, signal: abort.signal, duplex: "half" } as RequestInit);
  const response = await handler(request);
  res.writeHead(response.status, { ...Object.fromEntries(response.headers), ...CORS });
  if (!response.body) {
    res.end();
    return;
  }
  const readable = Readable.fromWeb(response.body as never);
  readable.on("end", () => {
    finished = true;
    stateOf(tag).completed++;
  });
  readable.on("error", () => res.end());
  readable.pipe(res);
}).listen(PORT, () => console.log(`harness listening on ${PORT}`));
