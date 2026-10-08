# Phase 7: End-to-end integration and production readiness

## 1. Audit: what was actually connected before this phase

| Area | State at the start of Phase 7 |
|---|---|
| Homepage | Real UI, but the submit button only started a **replay** of recorded events (`createReplaySource`). No network call. |
| Sentence understanding | `StructuredRequestUnderstander` threw `NaturalLanguageUnavailableError` for free text. The composer said "free-text sentences come in a later release". |
| Discovery, resolver, extractor, ranking | Real and tested, but only reachable from developer scripts (`npm run phase2/4/5/6`). |
| HTTP API | Only `/api/health`. No endpoint ran the pipeline, no streaming, no rate limiting, no cancellation. |
| Results | Rendered from replay events computed offline from a recording. |
| Reviews | Never read; the UI still said "checks what diners say". |
| Docs | No README, no deployment notes. |

So the individual phases worked, but the product was not integrated: a user could not get a real recommendation from the web app.

## 2. What was integrated

```
Homepage (SearchComposer, validation)
  -> createSseSource  POST /api/recommend  (AbortController = Cancel)
  -> recommendHandler: content-type, body cap, zod, config check, rate limit/concurrency, SSE stream, heartbeat, abort wiring
  -> runRecommendation (src/server/agent/run.ts)
       HybridUnderstander  (Gemini intent extraction, built-in parser fallback, merge with filter chips)
       runDiscovery        (Places, filter, shortlist of 5)
       per restaurant, concurrently (3 at a time for resolution):
           resolveMenu -> extractMenus([one restaurant])   (shared fetch cache, content-hash model cache)
       recommend()         (deterministic ranking, no AI)
       events: ... rank.done, recommendations.ready, run.metrics, explain.done
  -> reducer -> RecommendationResults (results first, research details collapsed)
```

- **Replay is preserved** for tests and demos behind `?scenario=...`; the default page is always live. The demo bar and "Demo data" banners only appear in replay mode.
- **Pipelined research**: each restaurant extracts as soon as its menu resolves, instead of waiting for all five. Measured total latency dropped from about 55 s (resolve all, then extract all) to 23-41 s.
- **Partial failure**: one restaurant failing never stops the others; a soft deadline (80% of 90 s) aborts remaining work and ranks what exists, with a notice.
- **Cancellation**: closing the page, pressing Cancel, or a stream cancel aborts the run signal, which aborts Places/Tavily/fetch/Gemini calls and the queued work. No results are emitted for a cancelled run. A live test showed the run stopping 6.9 s after the client dropped.
- **Duplicate and concurrent submissions**: one search per client at a time (429 `already_running`), a per-client sliding window, and a global cap on concurrent searches (429 `busy`). Different users run concurrently and independently (live test: two users finished in 24 s and 29 s simultaneously).

## 3. Safety and correctness changes

- **Allergies**: every restaurant card shows an explicit allergy warning ("cannot confirm that any dish is free of X"); dishes that mention the allergen are removed, but no dish is ever called safe; each dish says "Allergens not verified". Tests assert no "safe/free-from" wording.
- **Contradictory dietary evidence**: documents that disagree merge to `unknown`; a model "confirmed" is overridden by meat/fish words in the dish text; an unsupported ingredient quote cannot confirm a dish. Regression tests in `tests/unit/safety.test.ts`.
- **Budget**: the constraint now reads "Up to €30 per person (checked per dish)" and the notice says unverified/disputed prices are never counted. Per-dish checking is a stated limitation, not hidden.
- **Dish classification**: the extractor now asks the model for each dish's `course` (starter/main/side/dessert/other), used when the menu section does not decide it; the word lists were broadened beyond Barcelona (pizza, pasta, curry, ramen, burrito, bowl, moussaka...). Unknown stays unknown: a dish whose role is unknown cannot make a restaurant an exact lunch/dinner match ("We couldn't tell whether X is a main course").
- **Set and group menus**: dishes in set-menu documents or under group/event sections never carry an individual price. A group menu's price is shown as `groupMenu` ("May need a group booking"), never as a dish price, and cannot satisfy a budget.
- **Prompt injection**: user sentences are wrapped in `<USER_REQUEST>` with the closing tag stripped; menu text keeps the Phase 5 defenses.
- **Conflicts and unsupported input**: a plant-based diet together with a meat must-have is rejected with an explanation; another city is rejected with "Forkcast covers Barcelona for now".
- **Honest copy**: removed claims about reading diner reviews (not implemented); "Nice to have" chips now send soft preferences instead of hard must-haves.

## 4. Security review

| Topic | Result |
|---|---|
| API keys | Read server-side in route/provider code; sent only in request headers to providers; `.env*` git-ignored (verified); `/api/health` returns booleans only. Logs contain outcome and counters, never the query text, keys or provider error bodies. |
| Input validation | zod on every request; 16 KB body cap enforced while streaming; 1000-character sentence; JSON content-type required. |
| Errors to clients | Mapped to fixed codes and friendly messages (`describeFailure`); unexpected errors are a generic message. A test injects an error containing a key and a connection string and asserts neither reaches the client. |
| Abuse | Per-client rate limit, one search per client, global concurrency cap, bounded in-memory tables. `x-forwarded-for` is trusted only when `TRUST_PROXY_HEADERS=true`. |
| SSRF | Unchanged and still the only path for fetching external URLs: `safeFetch` (DNS pinning, redirect validation, size caps, content sniffing). |
| Rendering extracted content | React escapes all text; links are limited to `http(s)` URLs validated by `httpUrl` and opened with `rel="noopener noreferrer"`. |
| Browser hardening | Production responses carry a CSP (`default-src 'self'`, no framing, no external connections), `nosniff`, `X-Frame-Options: DENY`, referrer and permissions policies. `poweredByHeader` is off. All Playwright tests pass under the CSP. |
| Dependencies | `npm audit --omit=dev`: 0 vulnerabilities. `npm audit` (dev tree) reports 5 high-severity advisories through `eslint-config-next` -> `braces`; they are build-time only and are not shipped. |
| Google Places data | `fixtures/places/` is git-ignored, but the Phase 6 recorded fixtures (`fixtures/phase6/`, `src/mocks/replay/recorded-barcelona.json`) contain Places-derived fields (names, ratings, hours, place ids). Google's terms restrict storing Places content; remove or regenerate these fixtures before any public release. |

## 5. Measured pipeline performance (live, 2026-10-08)

All numbers are from real runs through `/api/recommend` with the live Places, Tavily and Gemini APIs. Cost is an estimate from assumed list prices (`src/server/agent/cost.ts`), not a bill; the Gemini free tier was used.

| Run | Total | Discover | Research | Places | Tavily credits | AI requests | Tokens in / out | Est. cost |
|---|---|---|---|---|---|---|---|---|
| Vegetarian Italian dinner under €30 (curl) | 26.9 s | 3.4 s | 23.5 s | 2 | 1 | 12 | 35,404 / 25,619 | $0.153 |
| Vegetarian pizza dinner under €25 (concurrent user A) | 23.4 s | 3.4 s | 20.0 s | 2 | 7 | 6 | 17,270 / 13,585 | $0.165 |
| Vegan lunch under €15, no mushrooms (concurrent user B) | 28.6 s | 3.4 s | 25.3 s | 2 | 2 | 9 | 25,902 / 15,584 | $0.133 |
| Vegetarian Italian dinner under €30 (mobile browser) | 41.0 s | 2.6 s | 38.3 s | 2 | 5 | 8 | 27,288 / 22,425 | $0.174 |

- **Bottleneck**: the research phase is 85-93% of the time, split between site crawling/Tavily and Gemini reading. Discovery is about 3 s and ranking is 10-50 ms.
- **Estimated cost per search**: about $0.13-0.17, most of it Gemini output tokens; Tavily is the next largest and varies from 1 to 7 credits.
- **Before this phase** the same flow took about 55 s when resolution and extraction ran as two sequential batches.
- Quota behaviour: the daily-quota breaker keeps exhausted models out of the loop; across the live runs the first two models in the chain were exhausted for the day and every call went to the third without wasted retries.

## 6. Test results

See the completion report for the exact final run. Layers:

- **Unit / component (mocked data)**: schemas, price and diet rules, extraction limits, ranking, safety regressions, reducer, components.
- **Integration (mocked providers, real orchestrator)**: `tests/integration/pipeline.test.ts` (full pipeline with fake Places/Tavily/Gemini/web: success, merge of sentence and filters, AI unavailable, no AI key, conflicting request, unsupported city, prompt injection, Places outage, no results, one menu missing, all menus missing, hanging model with soft deadline, cancellation, simultaneous runs) and `tests/integration/handler.test.ts` (HTTP layer: validation, oversize, not configured, SSE format, rate limit, duplicate submission, global cap, disconnect).
- **End-to-end (UI real, network mocked)**: Playwright desktop and mobile against a mocked `/api/recommend` (sentence submit, validation, 429, conflict, 503 with retry, no results, cancel, accessibility).
- **Live (real providers)**: manual runs through the production server listed above (HTTP and a real browser on desktop and mobile), concurrency, duplicate rejection, cancellation, invalid input, unsupported city.

## 7. Deployment checklist

1. Set `GOOGLE_PLACES_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY` in the host's secret store (not in the repo). Keep `PLACES_REVIEWS_TO_LLM=false`.
2. Billing: the Gemini free tier allows about 20 requests per day per model, which is a handful of searches. Enable billing before real traffic. Set budget alerts on the Google and Tavily accounts.
3. Choose a host that supports Node 22, long-lived streaming responses and `maxDuration` of at least 90 s (the route declares 120). Serverless hosts with a 10-15 s limit will cut searches off.
4. The rate limiter and the model cache live in process memory. Run a single instance, or sticky sessions, or accept that limits apply per instance.
5. Set `TRUST_PROXY_HEADERS=true` only behind a proxy that sets `x-forwarded-for`; otherwise set it to `false` (all clients then share one limit bucket, so prefer a proxy).
6. `npm ci && npm run build && npm start`; check `GET /api/health` (all three keys `true`).
7. Smoke test one real search and check the server log line `recommend.run` (outcome, timings, tokens).
8. Review the Places-derived fixtures noted above before publishing the repository.
9. Do not enable the CSP's `unsafe-inline` removal without adding nonces (Next injects inline scripts).

## 8. Remaining limitations and risks

- Quality depends on Gemini: output varies run to run (the Places shortlist also varies), and the free tier throttles heavily.
- Gluten-free (and any diet without explicit labels) rarely reaches "confirmed"; halal/kosher can never be confirmed from menus.
- Per-dish budget only; no whole-meal estimate.
- Reviews and atmosphere preferences ("not too crowded") remain unverified.
- Barcelona only; restaurants with JavaScript-only or image-only menus can be unreadable.
- Whole searches take 25-45 s; the UI streams progress but there is no persistence or history.
- In-memory rate limiting does not protect a multi-instance deployment.
