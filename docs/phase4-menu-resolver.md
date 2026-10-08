# Phase 4: Menu Resolver

Question answered: **where is the best trustworthy menu?** Not what it contains (Phase 5).

Run: `npm run phase4 -- --restaurant "Vegan Tulsi Restaurant" --website https://www.vegan-tulsi.com/ [--address "..."]`, `--phase0-set` (uses the local, uncommitted Phase 0 output), `--phase2-shortlist` (live Places discovery, then resolve the five), plus `--no-tavily`, `--only <name>`, `--json`, `--events`.

## Flow

```
Restaurant (name, address, city, website, https candidate)
 1 SITE      https upgrade (if http) -> homepage -> harvest anchors/iframes/embedded URLs/menu images
             -> <=3 internal pages (menu landings are harvested again) -> probe candidates in waves of 4
             -> sitemap.xml fallback (only if no official candidate yet)
             -> Tavily Extract only for 403 / JS-shell candidates
 2 SEARCH    only if no readable menu and no official flipbook viewer:
             site:{domain} carta OR menu OR menú (when no official candidate) ; "{name}" {city} carta menú
 3 ASSETS    "{name}" {city} carta filetype:pdf          (only if still nothing readable)
 4 THIRD     "{name}" {city} menu prices, allowlisted hosts only (only if nothing usable)
 -> resolved | found_but_unreadable | unavailable | failed
```

Statuses: `resolved` (selected documents, optional official URL), `found_but_unreadable` (official URL plus `flipbook_viewer | blocked | js_only | unsupported_format | fetch_failed`), `unavailable` (`no_website | no_menu_found | identity_mismatch`), `failed` (`aborted | internal_error`). Output schema: `src/schemas/menuResolution.ts`.

A readable official menu or an official flipbook viewer ends the run before Tavily is touched. A JS-only or blocked official page is treated as insufficient, so search continues.

## Candidate table

Every possible menu gets an id (`{placeId}#cN`), original URL (provenance), normalized URL, tier, media type, document kind, readability, `menuLikelihood`, identity confidence, signals and selection flag. Candidates come only from fetched HTML, search results or sitemaps, so a URL can never be invented. `ambiguity.ts` defines the batched-LLM boundary (ids in, kinds out; unknown ids ignored); it is not wired to Gemini in this phase.

## Scoring

`menuLikelihood` (clamped 0..1), selection threshold 0.55:

| Signal | Weight |
|---|---|
| menu / dessert / set / drinks word in anchor or title | +0.30 |
| same in URL stems (`carta`, `menu`, `tapas`, `postres`, `grupos`, `vins`, ...) | +0.20 |
| linked from a menu landing page | +0.20 |
| menu asset (PDF, image, viewer, QR host) linked by the official site | +0.10 (+0.15 on a menu page, +0.10 language-labelled link) |
| menu-labelled PDF or image file | +0.10 |
| food section words in content (>=3 / >=1) | +0.25 / +0.10 |
| dish-like line density (>=12 multi-word lines) | +0.15 |
| prices (>=3) | **+0.05 bonus only** |
| readable page with almost no menu content | capped at 0.45 |
| drinks / unknown / legal | capped at 0.30 / 0.50 / 0.15 |

Official links that turn out `js_only`, `blocked` or `unsupported_format` are floored at 0.55 so they surface as `found_but_unreadable`.

Document kinds: `food_menu`, `set_menu_or_groups`, `dessert_menu`, `drinks_or_wine`, `not_a_menu`, `unknown`. Precedence from URL and anchor: legal > drinks > dessert > set > food. Content refines it (drinks-heavy, group-heavy, dessert-only, legal text). Legal text only counts for PDFs, because every web footer mentions cookies and privacy. Only food, set and dessert documents are selectable.

## Tiers and confidence

| Tier | Base | Meaning |
|---|---|---|
| official_site | 0.95 | same registrable domain as the Places website |
| official_linked | 0.85 | external host linked from an official page (QR host, viewer, CDN, group site) |
| official_domain_search | 0.85 | found by search on the official domain |
| unverified_asset | 0.50 | search result with name/city/street evidence |
| third_party | 0.40 | allowlisted reviews/booking/delivery hosts, last resort |

`confidence = base * (0.55 + 0.45 * likelihood)`, times 0.6 if an external source's identity is below 0.6. Selection prefers official tiers; lower tiers are used only when no official document is readable, and then only the best tier (verified identities first).

## Identity

Official domain: 1.0. Linked from the official site: 0.85 (+0.10 with a name match). Search results: name-token ratio * 0.45, city +0.10, street name +0.30, mention of the official domain +0.30. A page showing a different street address caps confidence at 0.2 (the Vegan Tulsi aggregator at Consell de Cent 279). Below 0.4 (or a mismatch) the candidate is rejected; 0.4-0.6 is accepted with a confidence penalty. Lookalike domains (`vegantulsi.com` vs `vegan-tulsi.com`) get no credit.

## Limits (per restaurant)

16 direct fetches, 5 HTML pages, 3 internal pages, 400 links inspected, 40 candidates, 8 probes (in waves of 4, stopping once 4 readable official menus exist), 3 sitemap fetches, 4 Tavily searches, 3 Tavily extracts, 40 MB, 4 selected documents, 8 s per fetch, 40 s deadline. Run-level: 3 restaurants in parallel, 6 simultaneous fetches, 2 simultaneous Tavily calls. Gemini: 0 calls. Per-run in-memory fetch cache only; nothing persisted.

Tavily credits are estimated (search 1, extract 1 per call), not read from the API.

## Events

`restaurant.step(menu, started|done|warning)`, `menu.stage` (site/search/assets/third_party with optional `sourceTier`, `documentKind`, `mediaType`), `tool` (web_search / web_extract), `menu.resolved` (now with optional `sourceTier` and `reason`). The UI shows the tier of a found stage and a reason-specific explanation for unreadable and unavailable menus.

## Known limits

- Group sites (e.g. one domain for several venues) can yield another venue's images or PDFs.
- Translated pages with different slugs (`/menu/` vs `/es/carta/`) are not recognised as alternates.
- `menu.bigmammagroup.com`-style JS menu hosts linked by the official site are candidates but often unreadable without a browser.
- Third-party hosts are only searched, never scraped by custom code.
- PDF classification samples the first two pages of text; scanned PDFs have no text sample and rely on URL and anchor evidence.
