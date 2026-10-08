# Forkcast

Forkcast is an AI-assisted restaurant finder for travellers. You describe a meal in a sentence ("vegetarian Italian dinner under €30 in Barcelona"); Forkcast finds real restaurants, reads their actual menus, and recommends the ones that truly fit, showing the dishes, the prices, the evidence, and what it could **not** confirm.

## The problem it solves

Travellers with dietary needs or a budget cannot trust a restaurant's star rating or category: a "vegetarian-friendly" Italian place may offer one salad, and the menu is often a PDF in Catalan or Spanish. Forkcast answers the real question, "what can I actually eat here, and what will it cost?", by reading the menus themselves, translating them, and judging them dish by dish. The design rule is that facts are never invented: every dish, price and dietary reading is traced to a menu document, uncertain readings are labelled as uncertain, and the ranking is deterministic code, not a language model. Barcelona is the only supported city.

![Results on desktop](docs/screenshots/recommendation-card-desktop.png)

## Features

- Natural-language search plus optional filters (meal, diet, cuisine, budget, allergies).
- Live research progress streamed to the browser, with cancel and retry.
- Dish-level matching: vegetarian, vegan, pescatarian, gluten-free, halal/kosher (never confirmable from a menu), avoided foods, allergy warnings.
- Prices only count against a budget when verified in the menu text (or confirmed by a second read of a photo). Disputed, unverified, group-menu and non-EUR prices are never used for a budget claim.
- Three clearly separated result groups: exact matches, closest alternatives (each lists what it misses), and restaurants that need checking. A not-recommended list explains every exclusion.
- Every recommendation shows source links, the quoted menu evidence, and how its score was built.
- Works on desktop and mobile; keyboard and screen-reader friendly.

## Architecture

```mermaid
flowchart LR
  B[Browser<br/>SearchComposer + SSE client] -->|POST /api/recommend| H[Handler<br/>validate, rate limit, stream]
  H --> O[Orchestrator<br/>deadlines, cancellation]
  O --> U[Understand<br/>Gemini + built-in parser]
  U --> D[Discover<br/>Google Places, shortlist 5]
  D --> R1[Resolve menu 1..5<br/>site crawl, Tavily fallback]
  R1 --> E1[Extract dishes<br/>text / PDF / photo via Gemini]
  E1 --> K[Rank<br/>deterministic, no AI]
  K -->|SSE events| B
```

| Layer | Where |
|---|---|
| UI, event reducer, SSE client | `src/components`, `src/lib/agent` |
| HTTP handler, rate limiter | `src/server/http` |
| Orchestrator (deadlines, metrics) | `src/server/agent/run.ts` |
| Discovery (Places, shortlist) | `src/server/discovery` |
| Menu resolver (find the right menu) | `src/server/menu/resolver` |
| Dish extraction (Gemini, validation) | `src/server/menu/extract` |
| Ranking and explanations | `src/server/ranking` |
| Providers (Places, Tavily, Gemini, safe fetch) | `src/server/providers` |

Phase documents with the reasoning behind each layer are in `docs/` (`phase0-findings`, `phase2-discovery`, `phase3-ui`, `phase4-menu-resolver`, `phase5-menu-extraction`, `phase6-recommendations`, `phase7-integration`, `phase8-final-qa`, `phase9-predeployment-audit`, `deployment`, `git-history-cleanup`).

## How it works

**Agent workflow.** One search is a pipeline of small, bounded steps that the browser watches as a stream of events:

1. **Understand**: the sentence and the filter chips become structured constraints (diet, meal, cuisine, budget, allergies, avoided foods, preferences). Gemini reads the sentence; a built-in parser is the fallback when Gemini is slow or unavailable. Contradictions ("vegan" plus "steak") and unsupported cities are rejected with an explanation.
2. **Discover**: Google Places text searches find candidate restaurants; closed, out-of-area and not-open-for-the-meal places are filtered out and a deterministic shortlist of five is chosen (rating shrunk by review count, distance, search relevance).
3. **Resolve the menu** for each restaurant in parallel: the official website first (links, sitemap, PDFs, images), then Tavily web searches for the restaurant's menu (files on the official domain are trusted more than others), then lower-trust sources. Every candidate document gets a source tier (official site, linked from the official site, on the official domain, unverified file, third-party), an identity check (does it name this restaurant and address?), and a document kind (food menu, drinks, set menu, legal page).
4. **Read the dishes**: text and PDF menus are read as text; scanned PDFs and photos are read by Gemini vision. The model returns structured dishes with the original wording, an English translation, section, price as printed, and a dietary reading.
5. **Rank** with deterministic code (no AI) and explain.

**Real data and provenance.** Restaurants, ratings, hours and maps links come from Google Places. Menus come from the restaurants' own websites or documents found by search. Each recommendation carries the document it came from (tier, link, page), the quoted menu label or ingredient list behind a dietary reading, and how its score was built.

**Menu reading and translation.** Dish names and descriptions are kept exactly as printed and translated separately; a dish name that does not appear in the source text is dropped as a hallucination; prices are re-parsed deterministically (decimal commas, variants, set menus) and must appear next to the dish; photographed prices are read twice and a disagreement is marked "disputed" and never used for a budget.

**Scoring.** Hard constraints (diet, budget, must-haves) are checked per dish first. A restaurant is *exact* only if a main course is confirmed vegetarian/vegan/etc. by a menu label or ingredient list **and** has a verified price within budget. Otherwise it is *partial* (a preference is contradicted), *needs checking* (plausible but unconfirmed) or a *near miss* (over budget, with the overage shown). Within a tier, a documented weighted score orders restaurants: matching dishes (saturating at three, so large menus do not win by size), strength of dietary evidence, budget, cuisine, meal, source reliability and discovery relevance. See `docs/phase6-recommendations.md`.

**Accuracy safeguards.** Unknown is never treated as a match; meat or fish words override a model's "vegetarian"; a model claim needs a quote that really appears in the source; vegan needs a vegan label or ingredient list; gluten-free needs a label; halal, kosher and allergens are never confirmed (every card carries an allergy warning); menu files whose address shows an older year are flagged as possibly outdated; group-menu prices are never shown as individual prices; drinks are never recommended as dishes. `npm run audit` re-checks live results against the source documents.

## Tech stack

Next.js 16 (App Router, route handler streaming SSE), React 19, TypeScript, Tailwind CSS 4, zod 4, undici, cheerio, unpdf. Google Places API (New), Tavily, Gemini API. Vitest and Playwright (with axe) for tests. No database, queue or cache server.

## Setup

Requirements: Node 22+, npm, and API keys for Google Places, Gemini and Tavily.

```bash
npm install
cp .env.example .env.local      # fill in the keys
npm run dev                     # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | yes | restaurant discovery. Without it `/api/recommend` returns 503. |
| `GEMINI_API_KEY` | recommended | sentence understanding, menu reading, photo menus. Without it menus are read with a basic parser and fewer dishes can be confirmed. |
| `TAVILY_API_KEY` | recommended | menu search when a restaurant's own site has no readable menu. |
| `GEMINI_MODEL_CHAIN` | no | comma-separated models tried in order, quota-aware. |
| `GEMINI_PRICE_CHECK_MODEL` | no | cheaper model for the second read of photographed prices. |
| `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SEC`, `MAX_CONCURRENT_RUNS`, `GLOBAL_MAX_SEARCHES_PER_DAY` | no | per-client limit (default 6 per 10 minutes, one search at a time), global concurrent searches (default 4) and a per-instance daily search ceiling (default 100). |
| `TRUST_PROXY_HEADERS` | no | `true` (default) reads the client IP from `x-forwarded-for`; set `false` if there is no proxy. |
| `PLACES_REVIEWS_TO_LLM` | no | keep `false`. |

Keys are read server-side only, are never sent to the browser or logged, and `.env*` files (except `.env.example`) are git-ignored.

## Scripts and tests

| Command | What it does |
|---|---|
| `npm run typecheck`, `npm run lint` | static checks |
| `npm test` | unit, component and integration tests (Vitest). Providers are fakes. |
| `npm run test:e2e` | Playwright on desktop and mobile. Builds and starts the app plus a fake-provider harness. |
| `npm run phase5`, `phase6` | CLIs that run extraction / ranking against real providers |
| `npm run bench -- --text "..." --runs 2` | live end-to-end timing and API-usage benchmark (real providers, uses quota) |
| `npm run audit -- "vegetarian pizza under €25"` | live run that re-fetches every cited menu and checks dishes, prices and labels against the source |

The three layers of tests are kept separate on purpose:

1. **Mocked**: unit/component tests, and Playwright tests that mock `/api/recommend`.
2. **Backend integration with fake providers**: `tests/integration` and the Playwright "real API" tests, which drive the real browser client, handler, orchestrator, resolver, extractor and ranking against deterministic fake Places/Gemini/websites.
3. **Live**: `npm run bench` and `npm run audit` against the real providers. These are manual because they use paid or rate-limited APIs.

Test fixtures are synthetic (see `docs/phase8-final-qa.md`); no Google Places content is stored in the repository tree.

## Production

```bash
npm run build
npm start
```

`GET /api/health` reports which keys are configured (never their values). A search streams for up to about 60 seconds, so the host must allow long streaming responses; the route declares `maxDuration = 120`. Vercel's Fluid compute allows 300 s on the Hobby plan and 800 s on Pro ([limits](https://vercel.com/docs/functions/limitations)); any long-lived Node host (Railway, Fly, Render, a VM) also works. The rate limiter and caches are in process memory, so they apply per instance. The deployment guide, cost safeguards and manual steps are in `docs/deployment.md`.

## Demo flow (about 3 minutes)

1. Open the app and click the example "Vegetarian tapas in Barcelona under €25", or type `vegetarian Italian dinner under €30`.
2. Watch the research progress: restaurants appear, each menu is found and read in parallel. Press **Cancel search** once to show it stops (the server aborts the run).
3. In the results, open the first card: confirmed dishes with verified prices, the quoted menu label, source links, and **How the score is built**.
4. Scroll to a card marked **Needs checking** to show an uncertain match kept apart from exact ones, and open **Not recommended** to show why restaurants were excluded.
5. Try `vegan lunch under €15`: no exact match, so the closest options each list what they miss, and the budget is never loosened silently.
6. Try `vegan and gluten free dinner, allergic to nuts`: Forkcast refuses to guess and explains that menus rarely state gluten-free, and every card carries an allergy warning.
7. Replay without any API keys: `/?scenario=recorded` (synthetic data) and `/?scenario=recorded-no-exact`.

## Known limitations

- Barcelona only. Gemini output and the Places shortlist vary from run to run.
- Reviews and atmosphere preferences ("quiet", "not too crowded") are not verified.
- Gluten-free is only confirmed by an explicit menu label; halal and kosher cannot be confirmed; allergens can never be confirmed.
- Budgets are checked per dish, not for a whole meal. A restaurant with no prices can never be an exact budget match.
- Menus that exist only as JavaScript viewers or images inside web pages may be unreadable.
- A search takes roughly 15–45 seconds and costs about $0.12–0.17 in provider usage (estimated from assumed list prices). The Gemini free tier allows only a handful of searches per day.
- Rate limiting and caching are per server instance.
