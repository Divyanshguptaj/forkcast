# Phase 9: Pre-deployment audit and submission preparation

Nothing was deployed, no history was rewritten, no force-push was made, and repository visibility was not changed.

## 1. Audit findings

| Sev | Finding | Status |
|---|---|---|
| P0 | None found. | |
| P1 | No per-search ceiling on provider calls. Gemini was bounded per restaurant (4) but not per search, and Tavily only per restaurant, so five restaurants could in theory spend about 20 Gemini calls and about 35 Tavily calls. Observed use was 6-12 and 1-8. | Fixed: a per-search budget (16 Gemini calls, 12 Tavily calls) is enforced by wrappers around the providers. When it is hit, menus fall back to the basic parser (or skip extra web searches) and the results say so. Tests added. |
| P1 | No cost ceiling for a public demo: only per-client and concurrent limits. | Fixed: `GLOBAL_MAX_SEARCHES_PER_DAY` (default 100 per instance) returns a friendly "demo limit reached". Test added. Per-instance only, see risks. |
| P1 | The understanding step (Gemini) could hold up the whole search for 15-20 s when the model is slow. A minimal 21-token request measured 18-25 s on the only model with quota left today. | Fixed: capped at 6 s, then the built-in parser is used. Test added. |
| P1 | `/api/health` was public and listed model names, flags and limits. | Fixed: returns only whether each key is configured. |
| P1 | Real Google Places recordings remain in Git history. | Investigated; cleanup plan and dry run in `docs/git-history-cleanup.md`. Needs your approval. |
| P2 | After an error before any event, the progress bar showed an empty summary and the "Understanding" stage looked active forever. | Fixed (shows what you typed, stage says "Search stopped"). |
| P2 | Hero and README wording was checked again for claims (reviews, atmosphere, unsupported diets). None remain. | OK |
| P2 open | A Gemini call that times out fails that document (basic-parser fallback) instead of trying the next model. A slow model therefore costs a whole document. | Documented, not changed (larger behaviour change). |
| P2 open | Rate limiting, daily ceiling and caches are per server instance. | Documented with provider-side caps as the real backstop. |
| P2 open | Menu sources from third-party hosts (`unverified_asset`, aggregators) are used with a lower reliability tier and are labelled on the card. | By design. |

Reviewed with no change needed: input validation (zod, 16 KB body cap, 1,000-character sentence); SSRF guard (private, loopback, link-local, carrier-grade and multicast IPv4 and IPv6 ranges, IPv4-mapped IPv6, DNS pinning, per-redirect validation, size and content-type caps, port allowlist; existing security tests); prompt injection (user text and menu text are wrapped as untrusted data, closing tags stripped, names must exist in the source); SSE (heartbeat, abort wiring, slot release, no work after cancel); error exposure (fixed codes and messages, tested with an injected key and connection string); secrets (server-only, `.env*` ignored, none in history); security headers and CSP.

## 2. Accuracy audit (live, 2026-10-08)

`npm run audit` runs a real search, then re-fetches every cited menu and checks each shown dish, price, dietary label and restaurant identity against the source. New in this phase: an identity check (does the source mention the restaurant, or sit on its domain?) and memory/call reporting.

| Request | Outcome | Dishes in source | Prices verified | Labels found | Budget violations | Identity confirmed |
|---|---|---|---|---|---|---|
| Vegetarian Italian dinner under €30 | 2 exact, 2 need checking | 15 / 15 | 13 / 13 | 4 / 4 | 0 | 4 / 4 |
| Vegan lunch under €15 | no exact match, 3 alternatives | 5 / 5 | 2 / 2 | n/a | 0 | 4 / 4 sources |
| Vegetarian pizza under €25 | 2 exact, 3 need checking | 13 / 13 | 11 / 11 | 6 / 6 | 0 | 5 / 5 |
| Vegan and gluten-free dinner under €25, nut allergy | nothing recommended | n/a | n/a | n/a | n/a | n/a |

No hallucinated dish, no price absent from its source, no exact match over budget, and no recommendation whose menu did not mention (or sit on the domain of) the restaurant. The only findings were two menu files for a vegan restaurant and a café that live on third-party menu hosts, correctly labelled as an unconfirmed-owner source. The gluten-free request correctly returned nothing because no dish carried a gluten-free label.

What this does not show: it is four searches in one city on one day; "verified in source" means the printed number sits next to the dish name in the document text, not that the menu is current; photo menus are not re-checked by this script. Quota was not exceeded, but the only Gemini model with quota left was slow all day (see risks), so latency results from this session are not representative of a healthy API.

Provider usage for the whole phase (approximate): about 75 Gemini calls, about 16 Tavily credits, about 14 Places requests, all within the free tiers.

## 3. UI/UX review (desktop 1280 px and Pixel 7, real screenshots)

Checked: landing, composer and open filter panels, "Starting your search" state, error states (rate limit, demo limit, unavailable, conflict, no results), progress, results, cancel and retry, keyboard use and reduced motion (axe and keyboard tests pass). No overflow. Two clear issues fixed (empty summary bar and a stuck "Understanding" stage after an early error). No redesign.

## 4. Deployment and cost

See `docs/deployment.md` for the Vercel compatibility table (Node 22, route `maxDuration`, SSE and heartbeat, memory measured at +170-280 MB per search against a 2 GB limit, client-IP trust on Vercel, secrets, logs), the safeguard table, expected cost (estimated $0.12-0.17 per search from assumed prices, theoretical ceiling about $0.48 per search), and the manual steps.

## 5. Remaining risks

- **Gemini latency and quota.** On the free tier only one model had quota left today, and a 21-token request took 18-25 s on it. Searches took 50-72 s instead of 17-34 s, close to the 72 s soft deadline (partial results are returned). Use a billed Gemini key for a live demo; otherwise expect slow or partially basic-parser results.
- **Per-instance limits on Vercel.** The daily ceiling and rate limits multiply with instance count. Provider-side budgets are the hard backstop.
- **Places content in history** until you approve the cleanup.
- **Streaming on Vercel is unverified** until a preview deployment is tried (progressive delivery and cancel).
- Results vary run to run (Places shortlist, Gemini output).
