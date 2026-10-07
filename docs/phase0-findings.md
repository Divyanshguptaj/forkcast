# Phase 0 Findings (2026-10-07)

Scripts: `scripts/phase0/` (outputs in `scripts/phase0/out/`, git-ignored). Keys are read from `.env.local` and never printed.
All numbers below come from real runs against Google Places, Tavily, Gemini and live restaurant sites unless marked UNTESTED.

## 0. Gemini call budget (new constraint)

Target: **≤10–15 Gemini calls for a normal successful search**; 45 is an emergency ceiling only.

| Step | Calls | How |
|---|---|---|
| Understand + derive review search terms | 1 | single structured call |
| Menu candidate disambiguation | 0–1 | deterministic ranking first; ONE batched call for all ambiguous candidates across all restaurants |
| Menu extraction (text/PDF/HTML) | 2–3 | batch up to 3 text menus per call (batching of 4 menus worked mechanically, see 7) |
| Menu extraction (image/scanned) | 0–2 | 1 call per image/scanned menu (images of one restaurant in one call) |
| OCR price re-read (image menus only) | 0–2 | cheap second model, ~3 s |
| Review analysis | 1 | ONE batched call for all shortlisted restaurants |
| Explain top 3 | 1 | |
| **Typical** | **~8–11** | **worst case ~14** |

Architecture change: the per-restaurant Gemini tool-calling loop for menu discovery is **removed from the default path**. Deterministic site inspection found a menu file on most sites without any LLM (test 2). The loop survives only as an optional bounded fallback for unresolved restaurants and counts against the budget.

## 1. Vegan Tulsi / official-site-first resolver

- Input: `https://www.vegan-tulsi.com/` (Places `websiteUri`).
- Old strategy (Tavily only): 6 queries (menu/carta/menú, `site:`, filetype:pdf) returned the homepage, TripAdvisor, Instagram, a spam clone domain (`vegantulsi.com`) and one `carta.menu` PDF. No official menu.
- New strategy: homepage → nav link "CARTA" (`/menus`) → that page links "Castellano / English / Catalán" to a **FlipHTML5 flipbook** (`online.fliphtml5.com/zyrook/ESP-CARTA-2026-TULSI/`) and "DELIVERY" to `tulsi-vegan.eatkitch.com`.
- Result: **the official menu link was found** (old strategy never would). It is **not machine-readable**: flipbook has 0 text, page data is encrypted in `config.js`, Tavily Extract fails ("Failed to fetch url"), Gemini `urlContext` returns CANNOT_READ. Delivery host: DNS ENOTFOUND. Uber Eats URL from search: 404.
- The `carta.menu` PDF: direct fetch 403, Tavily Extract works, but it is an aggregator page (dish names, no prices, AI-written blurb) with a **different address** (Consell de Cent 279 vs official Carrer dels Àngels 8) and a different domain. Good evidence the identity check is required.
- Verdict: PARTIAL. Discovery fixed; reading impossible without a headless browser.
- Architecture change: new menu status `found_but_unreadable` (reasons: `flipbook_viewer`, `blocked`, `js_only`) that still returns the **official menu URL** so the UI shows "View official menu" instead of "no menu". Add flipbook/viewer hosts (fliphtml5, issuu, calameo, flipsnack, canva) to the viewer list. Identity checks (address/domain) mandatory for search-found sources.

## 2. Direct discovery on 12 real Barcelona restaurant sites (+ Vegan Tulsi)

Prototype inspector: fetch homepage, parse links/imgs/iframes, lexicon match (menu/carta/…), follow ≤3 internal links one level, then fetch+sniff candidates. 1–30 s per site (avg ~8 s, dominated by sequential fetches; will be parallelized).

| Restaurant | Result |
|---|---|
| Can Culleretes | 3 PDFs: food carta (5 p, 45 dish lines), menus (10 p), night tapas (2 p) |
| Ca l'Estevet | 3 PDFs: carta (4 p), desserts, wine. All text PDFs |
| Ca l'Isidre | candidate PDF only 2 pages / 2 dish lines (not clearly the food menu); also image `carta1.jpg` 79 KB. Needs content check |
| Barceloneta restaurant | PDF at a URL ending `/`, **scanned (1 page, 9.6 MB, 0 text chars)** |
| Xup Xup | 26 candidates; 3 PDFs: group menus, drinks, executive menu |
| Gloria Osteria | PDF 1 = legal text (false positive); PDF 2 = menu (18 p) |
| Gioia | 3 PDFs: 32-page food (393 dish lines), carta (13 p), drinks |
| Ostaia | HTML menu on homepage |
| Antic Pitarra | no menu on site (Next.js tiles "Tapas/Especialidades/Carnes", no dishes) |
| Cal Boter | Catalan HTML carta, **no prices on page** (my price-based detector wrongly rated it weak_html) |
| Tapas & paella Barceloneta | no menu: photos of dishes, `URL_CARTA_COMPLETA` placeholder link (404), covermanager reservation iframe |
| Paella Bar Boqueria (Pepa Tomate group) | group site JS-only (568 chars). Menu found via search on QR host `carta.avocaty.io` |

Tally of first-pass outcome: 7 PDF, 1 HTML homepage, 4 unresolved. After fixes below, **10 of 13 sites (77%) yield a readable menu**; Vegan Tulsi (flipbook) and Tapas & paella / Antic Pitarra (nothing online) do not.

Problems found:
1. Sites expose **multiple PDFs** (food, drinks, wine, groups, legal). Resolver must classify document kind and select/bundle the food menu(s); a "first PDF wins" rule picks wrong ones (Gloria legal PDF, Xup Xup group menu, Estevet wine list).
2. **Price-based menu detection is wrong**: Cal Boter's real menu has no prices. Detection must use section lexicon + dish-like line density + length, with prices only as a bonus.
3. PDF URLs may not end in `.pdf`; must sniff magic bytes.
4. `maybe_image_menu` pages: image candidates mostly food photos. Images need a gate before OCR (see 4).

Architecture changes: content-based classifier with `documentKind` (food_menu | drinks_or_wine | set_menu_or_groups | not_a_menu); multi-document menus per restaurant; price-optional detection; check `sitemap.xml` and external QR hosts only when linked from site or found with identity match.

## 3. Tavily Extract where direct fetch fails

| Case | Direct | Tavily Extract | Verdict |
|---|---|---|---|
| `carta.avocaty.io` QR host (JS SPA) | 1.8 k chars, mostly shell | **full menu with prices (2 k chars)** | Extract needed and works |
| `carta.menu` PDF | 403 | works (but aggregator content) | works |
| Velada PDF (earlier) | n/a | works | works |
| FlipHTML5 flipbook | 0 text | fails | not readable |
| Pepa Tomate `/carta?sede=` | 568 chars | 185 chars | fails (JS) |
| Antic Pitarra (Next.js) | no candidate | text OK, `images` returned (19, none menus) | nothing to read |
| Cal Boter pages | OK | OK, similar | no gain |

- `include_images: true` returns image URLs, useful for image-menu discovery.
- Extract latency 0.7–1.3 s per call. Search 1.5–4.3 s.
- Credit use in Phase 0 stayed small (a few dozen).
- Conclusion: use Tavily Extract only as fallback for JS shells/403/PDF; direct fetch first (free, faster).

## 4. Gemini Vision: scanned PDF and images

**Scanned PDF** (Barceloneta, Catalan+Spanish bilingual, 9.6 MB, 1 page, sent inline as `application/pdf`):

| Variant | Latency | Output tokens | Items |
|---|---|---|---|
| Full schema, thinking on (2.5-flash) | **90.8 s** | 11.9 k + 12.9 k thought | 76 |
| Full schema, thinking off | 56.5 s | 9.9 k | 76 |
| Veg-only schema (omit meat/fish), thinking off | **23.6 s** | 874 | 8 (+37 omitted counted) |
| Veg-only, 3.5-flash-lite | 9.2 s | 1.5 k | 14 (names/prices diverge from baseline: 1 price missing) |

- Prices identical across all 2.5-flash runs (64/64 shared items agree), translations correct (Catalan→English), seafood dishes correctly flagged meat/fish.
- Errors: *ensaladilla russa* marked likely_vegetarian in one run (tuna typical) and unknown in another; diet needs the lexicon downgrade.
- **Latency is output-token bound.** Architecture change: for a vegetarian/vegan request, ask only for non-meat dishes plus a count of omitted ones; thinking budget 0.
- PDFs go natively; no page rendering needed (confirmed).

**Images**: 9 PNGs (~2.3 MB each, 20 MB total) from a restaurant page were **food photos, not menus**; Gemini still returned 6 items with null prices (possible hallucination from non-menu images: Margherita/Quattro Formaggi). Latency 39.5 s for 9 images in one call.
- Architecture change: image gate before OCR (filename/alt/size/aspect + per-image `is_menu_page` flag in the extraction output); drop items from images flagged not-menu; cap images (≤4 per call), downscale large PNGs (they cost upload time, not tokens).

**Real photographed menus** (public photos): Café Viena (Catalan, dense): 25 s, 39 items, `readConfidence` 0.9 reported but **prices wrong for several rows** (see 6). Menu del día (Spanish photo): 12.8 s, 10 dishes, no prices printed → `null` correctly. Drinks-list photo: classified `drinks_or_wine`, beers `likely_vegetarian` (needs documentKind filter).

## 5. Catalan-only menu (synthetic with ground truth + real Catalan pages)

Synthetic Catalan menu image (16 dishes, `(V)` legend, ground-truth JSON), three degradations.

- Language detected `ca`, originals preserved with accents, translations correct (*Pa amb tomàquet → Bread with tomato*, *Esqueixada de bacallà*, *Escalivada*, *Samfaina*, *Mongetes del ganxet amb botifarra*, etc.).
- Diet: `(V)` items → confirmed with evidence "(V) = vegetarià" ✔. *Croquetes de pernil* → meat ✔, *Canelons* → unknown ✔, *Escudella* → meat (reasonable).
- **Violation found**: *Escalivada amb formatge de cabra* and *Truita de patates* returned `confirmed_vegetarian` with **empty evidence**. The planned code rule (confirmed requires non-empty evidence, otherwise downgrade to likely) is necessary and validated.
- Real Catalan HTML (Cal Boter): extraction not run (quota), but the page text is Catalan with no prices; the pipeline must support price-less menus.

## 6. OCR price reliability + two-pass verification

Pass A = full extraction (2.5-flash). Pass B = price-only read by a different model (3.5-flash-lite, ~3 s).

| Image | A correct | B correct | A and B agree | Agree but wrong | Disputed |
|---|---|---|---|---|---|
| clean PNG | 16/16 | 16/16 | 16 | 0 | 0 |
| low-res JPEG (45%, q28) | 16/16 | 16/16 | 16 | 0 | 0 |
| rotated 4° + blur + noise | **8/16** | 16/16 | 8 | **0** | 8 (all 8 A errors caught) |

- Errors on the degraded photo were **row misalignment** (price shifted to neighbouring dish: 11,60→14,80, 19,10→7,20), not 3/8-type digit swaps.
- **Real dense photo (Café Viena)**: A vs B disagree on **15 of 38** matched items with 3.5-flash-lite, 14 of 37 with 2.5-flash as B. Manual check of the image confirms A's first rows (Viena 3,85; Croque 7,85) are wrong (printed column reads ~5,20 … 3,85).
- Conclusions: the two-pass check **catches** errors (0 undetected wrong in synthetic tests) but on dense real photos ~40% of prices are disputed, so:
  - disputed prices are **hidden** (shown "price unclear"), never picked;
  - the menu gets `readQuality: poor`, a lower menu-confidence factor, and the card says "read from photo, prices unverified";
  - never base budget scoring on disputed prices.
- Cost: +1 cheap call (~3 s) per image menu. Text-layer menus need no second pass: verify prices by exact match in source text (Gioia batch: 59/59 prices found in text).
- Limits of this evidence: synthetic degradations + 1 real photo; both passes failing identically is untested.

## 7. Gemini limits, latency, retries, fallback

**Hard finding: free tier is 20 requests/day per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`, `gemini-2.5-flash`). Exhausted during Phase 0 (reset in ~6 h; `retryDelay` 22 942 s). `gemini-2.5-pro`: limit 0 on free tier.
- A 429 daily-quota response must **not** be retried; fall to the next model immediately (`quotaId` contains `PerDay`).
- Probe results (single tiny call each, same session):

| Model | Result |
|---|---|
| gemini-2.5-flash | 429 daily (after Phase 0 usage) |
| gemini-3.5-flash-lite | 200 (2 s) |
| gemini-3.1-flash-lite | 200 (9 s) |
| gemini-flash-latest | 200 in probe; later 503 and 429 under load |
| gemini-flash-lite-latest | 200 (1 s) |
| gemini-3.5-flash, gemini-3-flash-preview | 503 "high demand" repeatedly |
| gemini-2.5-flash-lite | 404 "no longer available to new users" |

- **503 behaviour**: bursts of 503 lasting >100 s (one request waited 96.9 s through 3 retries before failing). Retry with exponential backoff is not enough; cap total retry time (~15–20 s) then switch model.
- Fallback chain must be **configured by probing availability at startup**, not hard-coded: remove `2.5-flash-lite`; candidates 2.5-flash → flash-latest → 3.5-flash-lite → 3.1-flash-lite.
- Function calling + `responseMimeType: application/json` in one request: HTTP 400 (confirmed earlier).
- **Batching test** (4 menus in one call, 3.5-flash-lite): 200 in 9.2 s, 10.8 k in / 3.6 k out tokens, valid per-restaurant arrays; but yields were uneven (e.g. Gioia 4 items from a 393-dish-line menu) and 2 of the 4 fixtures were wine/drinks lists (my fixtures kept the last PDF per site). **Mechanics PASS, quality UNPROVEN** (the comparison against separate 2.5-flash calls was blocked by quota: 429/503).
- Latency summary (no thinking): short text menu extraction 2–4 s on lite models; scanned PDF 24–57 s on 2.5-flash; 4 images ~25–40 s; price re-read 2.5–4 s.
- UNTESTED: paid-tier limits (RPM/TPM), concurrency behaviour, streaming. Needs billing or AI Studio check.
- Decision needed: enable billing on the Gemini project (a Phase 0 run of ~60 calls hit the free daily wall; a demo at ~10 calls/search leaves ~2 searches/day per model on free tier).

## 8. Google Places review text → LLM (compliance, separate)

- Status: **UNRESOLVED. `PLACES_REVIEWS_TO_LLM=false`.**
- Verified from the official Places API policies page (earlier fetch): reviews require author attribution and a link to Google Maps (`googleMapsUri`); most Places content may not be pre-fetched, cached or stored, only `place_id`; Google's own AI summaries must be shown unmodified with disclosure.
- Not verified: whether sending review text to a third-party LLM is allowed. The official Terms pages (`cloud.google.com/maps-platform/terms`, `.../maps-service-terms`) are client-rendered; the fetch tool returned only truncated headers on two attempts. No guess made.
- Phase 0 data: a Places Text Search returns 5 reviews per place with `text`, `originalText`, `rating`, `publishTime`, `authorAttribution`, `googleMapsUri`, `flagContentUri`.
- Required human action: read the Google Maps Platform Terms of Service and Places API service-specific terms in a browser; record the quoted clauses and decision in `docs/compliance.md`. Until then: Places review text is **display-only with attribution, not sent to Gemini**; context-specific analysis uses web snippets.
- Also: no Places response caching beyond `place_id`; dev fixtures with Places data stay git-ignored.

## 9. SSE hosting/runtime limits (not deployed)

- Search-result summary of Vercel docs (not read on the primary page): with fluid compute, Hobby default and max 300 s, Pro up to 800 s; the duration includes streamed response time; 504 on timeout. **Verify on the official Vercel page when choosing the host.**
- Our run budget (target 30–60 s, global deadline 90 s) fits under 300 s.
- To validate when the route exists (Phase 8, no Phase 0 infra needed): (a) no response buffering by the host/proxy (events arrive incrementally), (b) 15 s heartbeat survives idle gaps, (c) client abort cancels upstream calls, (d) duration of a cold run on the deployed target, (e) body size limit for PDFs/images in memory.
- Local-only fallback for the demo: `next start` on a laptop has no such limit.

## 10. Other observations

- Places: 8 results/8 websites, 5 reviews each, `servesVegetarianFood` present for all (weak signal; Vegan places obviously true).
- Spam/clone domains appear in search (e.g. `vegantulsi.com`): identity check (domain vs `websiteUri`, address) needed.
- Aggregators (carta.menu, TripAdvisor, Instagram) rank above official files in search; keep tier scoring.

## Risk table

| Risk | Test | Result | PASS/FAIL | Action |
|---|---|---|---|---|
| Menu discovery relies on Tavily | Official-site-first inspector on 12 sites | 7 PDF + 1 HTML first pass; ~10/13 after fixes; no LLM needed | PASS | Build resolver site-first; Tavily fallback |
| Vegan Tulsi-type miss | Reproduced; new strategy | official link found; flipbook unreadable | PARTIAL | `found_but_unreadable` state with official link |
| Wrong document chosen (drinks/legal/groups) | PDF text classification | 3 of 16 PDFs wrong kind | FAIL (needs design) | `documentKind` classifier, multi-doc menus |
| Price-based menu detection | Cal Boter (no prices) | false negative | FAIL (needs design) | prices optional signal |
| JS shells / 403 | Tavily Extract | works for SPA QR host + 403 PDF; fails flipbook/JS group site | PASS (partial) | Fallback only |
| Scanned PDF | Gemini native PDF | 76 items, prices stable, 24–91 s | PASS (latency issue) | thinking off, veg-only output |
| Image menus | real + synthetic | works; non-menu photos produce items | PARTIAL | image gate + `is_menu_page` |
| Catalan | synthetic + real | translation/originals correct | PASS | evidence-required rule enforced in code |
| Diet over-confidence | Catalan menu | 2/9 confirmed w/o evidence | FAIL → mitigated | code downgrade rule |
| OCR price errors | 2-pass check | clean 16/16; degraded: A 8/16, caught 8/8; real dense photo: ~40% disputed | PASS (detection) / limited accuracy | hide disputed, lower confidence |
| Gemini limits | quota probe | free tier = 20 RPD/model, hit in Phase 0 | FAIL | enable billing or accept ~2 demo runs/day |
| 429/503 + fallback | probes | 503 bursts >100 s, 2.5-flash-lite gone | PARTIAL | probe-based chain, retry cap, no retry on PerDay |
| Call budget ≤10–15 | design + batching test | batching mechanics work; quality unproven | PARTIAL | batch reviews/extraction; re-test after quota |
| Places review → LLM ToS | official docs attempted | pages unreadable via fetch | UNRESOLVED | human reads Terms; flag stays false |
| SSE hosting limits | docs summary only | likely OK (300 s Hobby) | NOT TESTED | validate in Phase 8 |
