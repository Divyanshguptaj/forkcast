# Forkcast

Forkcast finds restaurants for a traveller and checks their real menus against what they asked for. Type a sentence such as "vegetarian Italian dinner under €30 in Barcelona" and Forkcast discovers restaurants (Google Places), finds and reads their menus (official sites first, Tavily as a fallback), extracts and classifies dishes (Gemini), then ranks the restaurants with deterministic, explainable rules. Barcelona is the only supported city for now.

Facts are never invented: every dish, price and dietary reading is traced to a menu document, and anything uncertain is shown as uncertain.

## Quick start

Requirements: Node 22+, npm.

```bash
npm install
cp .env.example .env.local      # then fill in the three API keys
npm run dev                     # http://localhost:3000
```

| Variable | Required | Purpose |
|---|---|---|
| `GOOGLE_PLACES_API_KEY` | yes | restaurant discovery. Without it `/api/recommend` returns 503. |
| `GEMINI_API_KEY` | recommended | sentence understanding, menu reading, vision. Without it menus are read with a basic parser and fewer dishes can be confirmed. |
| `TAVILY_API_KEY` | recommended | menu search fallback when a restaurant's site has no readable menu. |
| `GEMINI_MODEL_CHAIN` | no | comma-separated models tried in order (quota-aware). |
| `GEMINI_PRICE_CHECK_MODEL` | no | cheaper model for the second read of photographed prices. |
| `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SEC`, `MAX_CONCURRENT_RUNS` | no | per-client rate limit (default 6 per 10 minutes) and global concurrent searches (default 4). One search per client at a time. |
| `TRUST_PROXY_HEADERS` | no | `true` (default) reads the client IP from `x-forwarded-for`; set `false` if the app is not behind a proxy that sets it. |
| `PLACES_REVIEWS_TO_LLM` | no | keep `false`. |

Secrets are read only on the server, are never sent to the browser or written to logs, and `.env*` files (except `.env.example`) are git-ignored.

## Production

```bash
npm run build
npm start                       # serves on :3000
```

`GET /api/health` reports which keys are configured (never their values). The search endpoint streams server-sent events and a search can take up to about 60 seconds, so the host must allow long-lived streaming responses (the route sets `maxDuration = 120`). See `docs/phase7-integration.md` for the deployment checklist.

## How it works

```
sentence + optional filters
  -> POST /api/recommend (validate, rate limit, SSE stream)
  -> understand (Gemini + built-in parser) -> discover (Places) -> shortlist (5)
  -> per restaurant, in parallel: resolve menu -> extract dishes (text, PDF, scanned/photo)
  -> rank (deterministic, no AI) -> stream recommendations
```

Documentation per phase is in `docs/`: `phase0-findings`, `phase2-discovery`, `phase3-ui`, `phase4-menu-resolver`, `phase5-menu-extraction`, `phase6-recommendations`, `phase7-integration`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck`, `npm run lint` | static checks |
| `npm test` | unit, component and integration tests (Vitest, fake providers) |
| `npm run test:e2e` | Playwright, desktop and mobile (builds and starts the app; network mocked) |
| `npm run phase5`, `npm run phase6` | developer CLIs that run the real pipeline and print results |

## Demo and replay

Open `/?scenario=recorded` (or `recorded-no-exact`, `full-demo`, `phase2`, `timeout`...) to replay recorded events without calling any provider. The normal page (no `scenario` parameter) always runs live.

## What Forkcast does not do

It does not read reviews yet, cannot confirm allergens, does not check a whole-meal budget (budgets are checked per dish with verified prices), and treats halal and kosher as unverifiable from menus.
