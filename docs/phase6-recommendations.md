# Phase 6: Recommendation intelligence

Question answered: **which of these restaurants truly fits what the user asked for, and why?** Input is the user request plus Phase 2 discovery data plus Phase 5 `MenuExtraction` per restaurant. Output is a `RecommendationSet` (`src/schemas/recommendations.ts`). The engine is a pure function with no I/O and no Gemini calls (`src/server/ranking/`, about 20 ms for five restaurants).

Run: `npm run phase6 -- --scenario veg-italian-dinner-30|vegan-lunch-15|no-exact|missing-prices|multi-constraint [--record file.json] [--replay file.json] [--no-llm] [--json]`. `--replay` re-ranks recorded menus with no API calls.

## Phase 5 fixes shipped with this phase

- **Gemini quota (`providers/gemini/`)**: daily-quota 429s pause that model (`quotaBreaker.ts`, one hour or the server's `retryDelay`, whichever is longer) and are never retried. Per-minute 429s honour `Retry-After` / `RetryInfo`; a delay beyond the 20 s retry window pauses the model instead of waiting. A model that stays down after its retries is paused for 20 s so concurrent callers skip it. A first request to an unproven model goes out alone (at most 1.5 s) so six concurrent calls cannot all discover the same exhausted quota. When every model is paused the client throws `quota_exhausted` without any HTTP call, and `available()` lets the extractor go straight to the deterministic parser (text) or fail cleanly (vision).
- **Token bounds (`menu/extract/`)**: every request has `maxOutputTokens` (7 000; 2 500 for price checks). Menus over 16 000 characters are split on line boundaries into at most two parts, each extracted once (`chunk.ts`); a failed part falls back to the deterministic parser for that part only. A truncated model response is salvaged to its last complete dish (`salvage.ts`). A per-run input-token budget (160 000, estimated) stops launching calls. Identical menu content (any URL) is extracted once via a content-hash cache with in-flight sharing (`modelCache.ts`). Over-cap dishes are chosen by round-robin across menu sections, not by taking the first N (`coverage.ts`). Stats record per-call model, latency, tokens, cache hits, truncations and quota skips.
- **Prices**: a disputed price keeps its first reading (`amount`), the other reading (`alternateAmount`), `basis` and `confidence`; status stays `disputed`. Only `verified` and `ocr_agreed` prices are budget grade (`isBudgetGradePrice`). The UI shows "Price disputed" with the other reading.

## Constraints

`buildConstraints` turns the normalised request into typed constraints; nothing is reinterpreted.

| Kind | Source | Strength | Blocks "exact" if unconfirmed |
|---|---|---|---|
| diet (vegetarian, vegan, pescatarian, gluten_free) | `diet` | hard | yes |
| diet (halal, kosher) | `diet` | hard | yes, and a menu can never confirm it |
| budget | `budget.max` per person | hard | yes |
| must have | `mustHave` | hard | yes |
| allergy | `allergies` | hard (dish excluded on a lexicon hit) | no, but always shows an "ask staff" warning |
| dislike | `dislikedFoods` | hard (dish excluded on a hit, with ES/CA synonyms) | no |
| cuisine, meal, preference | `cuisines`, `meal`, `preferences` | soft | no |

Several cuisines mean "any of these". `budget.min` is ignored.

## Dish matching (`dishMatch.ts`)

Each dish gets an outcome per dish-level constraint, then a fit:

- **exact**: every blocking hard constraint is `met` (diet `confirmed`, verified price within budget).
- **possible**: nothing unmet, but some blocking outcome is plausible-uncertain (diet `possible`, or price absent, unverified, disputed, group menu, non-EUR).
- **near_miss**: diet confirmed, only the budget is unmet.
- Anything else is dropped. A dish whose diet is `unknown` is never a match (no inference from missing information).

Budget rules: verified/photo-confirmed price only; inclusive comparison in cents; the cheapest variant counts; set-menu dishes use the set-menu price, but a set menu whose name says group/grupo/event is treated as unverifiable for individuals; prices in another currency are never converted.

Dish roles (main, starter, side, dessert, set menu) come from the section and name lexicon. For lunch or dinner a restaurant only qualifies as **exact** if a matching *main* exists; otherwise it is a partial match saying so.

## Restaurant tiers (`restaurant.ts`)

1. **exact**: at least one exact dish (and a main for lunch/dinner), no unconfirmed must-have/halal, no unmet soft preference.
2. **partial**: hard constraints confirmed, but cuisine or meal is contradicted by Google data, or only starters/sides/desserts match.
3. **uncertain**: only possible dishes, or an unconfirmed must-have/halal. Kept in a separate "needs checking" group.
4. **near_miss**: diet confirmed, every verified price over budget; labelled with the exact overage.
5. **excluded** (with reason code): no menu, unreadable menu, diet unmet, no dietary evidence, avoided ingredient, no matching dish, or cut by the display limit.

Diet and budget are never relaxed to produce a result; a near-miss is shown only with its overage stated.

## Scoring (`score.ts`)

Rank order: tier, then score, then discovery score, then Google review count, then place id. Score is 0-100: each applicable component in [0, 1] times its weight, renormalised over the components that apply to the request.

| Component | Weight | Meaning |
|---|---|---|
| dishFit | 0.30 | role-weighted credit of the best 3 dishes (exact 1.0, possible 0.35, near miss 0.2). Saturates at 3 dishes so menu size earns nothing. |
| dietStrength | 0.20 | mean evidence strength of those dishes (confirmed 1, name-only 0.4, unknown 0.1) |
| budgetFit | 0.15 | 1 verified within budget, 0.3 unverifiable, 0 over |
| cuisineFit | 0.10 | best requested cuisine: met 1, unknown 0.4, contradicted 0 |
| mealFit | 0.05 | met 1, unknown 0.5, contradicted 0 |
| evidenceQuality | 0.10 | source tier reliability (official 1.0 down to third party 0.5) times extraction confidence, 0.9 for partial menus |
| discovery | 0.10 | Phase 2 shortlist score (shrunk rating, distance, search relevance) |

The weights are ordinal priors, not fitted values: what the user asked for is 65%, context 15%, trust 10%, popularity and proximity 10%. They are justified by ordering, protected by tests (a confirmed match outranks an uncertain one under any single weight changed by 30%, a 200-dish menu does not outscore a 3-dish menu of equal quality), and every score shows its components in the UI.

## Explanations

Every reason, dish, price and link is built from extracted data: dish ids and document ids are attached, prices are copied from the extraction (a test checks every euro amount in a reason exists in the extraction or is the user's budget), links are the Places website/maps URL or a menu document that was actually read. Each card lists what was checked (confirmed / not confirmed / not met per constraint), what does not match, what to check before going, and sources.

## Events and UI

New event `recommendations.ready` (payload `RecommendationSet`), sent after `rank.done`. The reducer stores it in `state.recommendations`. `RecommendationResults` shows best matches, then "Also worth a look" or "Closest options", a not-recommended list with reasons, the must-have/nice-to-have summary and notices. Cards reuse the existing tokens: tomato rank stamp, basil verified states, saffron "needs checking" dashed borders, receipt-style dish lists, `PriceTag`, `MatchRing`, `SourceIndicator`.

The default replay scenario `recorded` replays a real run (see below) with simulated timing; `recorded-no-exact` re-ranks the same data with a EUR 5 budget.

## Real-world validation (2026-10-08, Barcelona)

See the completion report for measurements. Live scenarios: vegetarian Italian dinner under EUR 30 and vegan lunch under EUR 15. Recorded menus (`fixtures/phase6/`) were re-ranked offline for the no-exact, missing-price and multi-constraint requests.

## Known limitations

- Gluten-free is only ever confirmed by an explicit menu label, so gluten-free requests usually yield "needs checking" or nothing.
- Dietary evidence is as good as the Phase 5 extraction: ingredient lists the model quotes must appear in the source, but stock or egg hidden in a dish is invisible.
- Budget is per dish, not a whole meal; the UI says so.
- Dish roles come from a Spanish/Catalan/English/Italian word list; dishes like "VEGETARIANA" (a pizza) fall back to "dish".
- Free-text preferences and must-haves are keyword matches over dish text and Google types only, so atmosphere requirements stay unconfirmed until review research exists.
- Group set menus are detected by name; a differently named group menu would be treated as individually priced.
- The recorded demo trims each menu to 12 dishes.
