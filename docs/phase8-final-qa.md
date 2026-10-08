# Phase 8: Final QA, optimization and submission readiness

## 1. Findings

| Sev | Finding | Status |
|---|---|---|
| P1 | Menus found through a hosting platform (for example `*.dish.co`) were compared by registrable domain, so any file on the platform's CDN looked like it belonged to the restaurant's own domain and skipped identity checks. | Fixed: platform suffixes are treated as private suffixes, so `abanic.dish.co` and `cdn.website.dish.co` are different sites. Test added. |
| P1 | Drinks (cocktails, lemonades, wine) leaked out of mixed menus and were recommended as dishes ("Aperol Spritz" as a vegan match). | Fixed: a `drink` role removes them from matching, and the extraction prompt now excludes beverages. Tests added. |
| P1 | A provider that ignores cancellation could hold a search past its deadline. | Fixed: a hard deadline (90 s) now races the research phase; remaining results are ranked and a notice says the time limit was reached. Test with a never-answering provider. |
| P1 | Recorded Google Places data (names, ratings, hours, place ids) was committed in fixtures and demo data. | Fixed in the working tree (section 4). History still contains it. |
| P1 | Menu files from several years were merged (an old 2025 PDF beside the 2026 one), mixing outdated prices. | Fixed: the newest dated food-menu file wins; a menu file dated before the current year adds a "may have changed" caveat. |
| P2 | Hero said "Check reviews" although reviews are not read. | Fixed ("Match your diet"). |
| P2 | Card text "Showing 6 of 12 possible dishes from 12 read" was garbled; dish evidence repeated the dish name. | Fixed. |
| P2 | Only 3 of 5 shortlisted restaurants were researched at once, so the last two started 4-8 s late. | Fixed (section 3). |
| P2 | Flaky wall-clock assertions in two unit tests under load. | Replaced by structural assertions. |
| Open | Gemini free tier is a few searches per day; output varies run to run. | Documented. |
| Open | Gluten-free is rarely confirmable; halal and kosher never; allergens never. | By design, documented. |
| Open | In-memory rate limiting and caches are per instance. | Documented; fine for a single instance. |
| Open | Git history still contains the original Places recordings. | Needs your decision (section 4). |

No P0 issues were found.

## 2. Recommendation accuracy (live, 2026-10-08)

`npm run audit` runs a real search, then re-fetches every cited menu and checks each shown dish, price and label against the source text.

| Request | Result | Dishes found in source | Prices verified in source | Labels found | Budget violations |
|---|---|---|---|---|---|
| Vegetarian Italian dinner under €30 | 2 exact, 3 need checking | 15 / 15 | 12 / 12 | 7 / 7 | 0 |
| Vegan lunch under €15 | no exact match, 3 alternatives | 7 / 7 | 4 / 4 | n/a | 0 |
| Vegetarian pizza under €25 | 1 exact, 3 need checking | 6 / 6 checkable (4 pages not re-fetchable) | 6 / 6 | 1 / 1 | 0 |
| Vegan and gluten-free dinner under €25, nut allergy | nothing recommended (no gluten-free evidence) | n/a | n/a | n/a | n/a |
| Vegan Japanese dinner under €10 | no exact match, 3 alternatives | 9 / 9 | 8 / 8 | 1 / 1 (a "plant based" name; my checker's regex missed it) | 0 |

Findings from these runs, all fixed: a menu hosted on a shared platform CDN was treated as official; drinks appeared among dishes. Every restaurant was a real Places result, and all but two menu sources were on the restaurant's own site or a file linked from it. The exceptions were third-party menu hosts that put the restaurant name in the URL, and an aggregator page; both carry the low-reliability tier and are shown as such. Ranking weights were not changed.

Limits of this evidence: it is five searches, one city, on one day; "verified in source" means the printed number appears next to the dish name in the text, not that the menu is current.

## 3. Performance

Live benchmark, same request ("vegetarian Italian dinner under €30"), fresh model cache each run, real providers (`npm run bench`). The Places shortlist differs between runs, so wall-clock time is noisy.

| | Before (3 concurrent, long field names) | After (5 concurrent, short field names, no unused vegan field, no drinks) |
|---|---|---|
| Wall time | 30.0 s, 46.4 s (mean 38.2 s) | 16.8 s, 26.7 s, 34.2 s (mean 25.9 s) |
| Gemini output tokens per search | 27,346 and 24,400 | 21,745, 15,750 and 15,735 (mean -32%) |
| Gemini output tokens per extraction call | about 2,250 | about 1,800 |
| Estimated cost | $0.160, $0.182 (mean $0.171) | $0.159, $0.126, $0.144 (mean $0.143, -16%) |
| Restaurants whose research started at once | 3 of 5 | 5 of 5 |

Controlled check on one fixed 2-part menu document (same input, two runs each): output tokens per returned dish fell from about 190 to about 154 with short field names, and to about 123-138 when the vegan verdict is not requested. Latency on that single document was not conclusively different (noise dominated), so the wall-clock gain above should be read as likely, not proven.

What was measured and left alone: Places calls (2) and Tavily credits (1-8) are already minimal and bounded; Gemini calls per search are 6-12 (one understanding call plus one per document); the extraction cache and shared fetch cache are effective only within a run. The largest remaining cost is Gemini output, then Tavily on restaurants without a readable site menu. Ranking takes 10-50 ms.

## 4. Google Places fixture compliance

What was stored: `fixtures/phase6/*.json` and `src/mocks/replay/recorded-barcelona.json` held Places-derived names, place ids, addresses, coordinates, ratings and review counts, opening hours and Maps URLs for real restaurants. The Phase 3 demo data (`scenarios.ts`, `resultPreview.ts`) also reused real restaurant names, ratings and review counts from a Places smoke test.

What changed:

- `fixtures/phase6/veg-italian-dinner-30.json` and `src/mocks/replay/recorded-barcelona.json` are now **synthetic**: fictional restaurant names, `synthetic-00N` ids, invented addresses and coordinates, invented ratings, review counts and opening hours, `*.example` websites and menu URLs, and `maps.example` links. Menu wording (dish names, descriptions, prices, set menus, dietary readings) is kept, so every ranking test still exercises the same real-world menu shapes: group menus, labelled and unlabelled dishes, missing prices, set-menu pricing.
- `fixtures/phase6/vegan-lunch-15.json` was unused and was removed.
- The generator `scripts/synthesize-fixture.mjs` produces the synthetic file from a local recording; raw recordings live only in git-ignored `fixtures/raw/`.
- The hand-written demo data in `scenarios.ts` and `resultPreview.ts` now uses the same fictional names and invented numbers; tests were updated to match without weakening any assertion.
- Replay scenarios and screenshots are labelled as synthetic.

Not changed: the Git history of earlier commits still contains the original recordings. Removing them requires rewriting history and force-pushing `main` (for example with `git filter-repo`), which I have not done without your approval. `.gitignore` already excluded `fixtures/places/`; it now also excludes `fixtures/raw/`.

Judgement call: the restaurants' own menu wording is retained because it comes from their public websites rather than from Google, but it is no longer attached to a real business name or URL.

## 5. UI/UX audit

Reviewed with real browser screenshots (desktop 1280 px and Pixel 7) of the homepage, filters, progress, results, cards, empty, error, cancel and retry states, saved in `docs/screenshots`. Changes beyond the fixes above: results appear first with the research detail collapsed, a "Starting your search" state shows before the first event, the cancel button is available immediately, and an empty submission shows an inline error and returns focus to the text box. No horizontal overflow on desktop or mobile, and axe reports no violations on compose, research and results (including opened score breakdowns).

## 6. Reliability and security

- Verified by test or live run: request validation and size caps; rate limit, one search per client, global concurrency; cancellation (browser Cancel aborts the server run, verified through the real browser against the real handler, and live with a dropped client at 6.9 s); SSE stream cleanup and slot release; Gemini quota exhaustion (disclosed in the results, search still completes) and the circuit breaker; provider timeout (soft and hard deadline); sanitized errors (a test injects a key and a connection string); prompt injection in the sentence and in menu text; SSRF protections unchanged from earlier phases.
- Secret scan of the diff and tracked files: no keys (only the fake test constants). `.env*` is ignored. `npm audit --omit=dev`: 0 vulnerabilities; the dev tree still reports 5 high advisories through `eslint-config-next` (build-time only).
- Multiple server instances: the rate limiter, the model-content cache and the quota breaker are per process, so limits are per instance and each instance learns quota exhaustion separately. For one instance or a small number it is acceptable; a shared store (for example Redis) would only be needed for a larger deployment, and was deliberately not added.
- Hosting: the route declares `maxDuration = 120`. On Vercel with Fluid compute the documented maximum is 300 s on Hobby and 800 s on Pro, and streamed time counts toward it ([limits](https://vercel.com/docs/functions/limitations)). I did not deploy or test on any platform; the platform's current limits should be rechecked before deploying.

## 7. Test layers and results

- **Mocked**: unit and component tests (Vitest); Playwright tests with `/api/recommend` mocked.
- **Backend integration, fake providers**: `tests/integration/pipeline.test.ts` (real orchestrator, resolver, extractor, ranking) and `handler.test.ts`; plus Playwright "real API" tests that run the real browser client, handler and orchestrator against `tests/e2e/harness/server.ts`.
- **Live providers**: `npm run bench` and `npm run audit` (manual, uses quota), plus the Phase 7 live runs.

Final results are listed in the completion report.

## 8. Remaining limitations

See the README. In short: Barcelona only, reviews not read, gluten-free/halal/kosher/allergens not confirmable, per-dish budgets, per-instance limits, Gemini free-tier quota, and output that varies from run to run.
