# Phase 5: Menu extraction, translation, dietary classification, price verification

Question answered: **what does the chosen menu contain?** Input is a Phase 4 `MenuResolution`; output is `MenuExtraction` per restaurant (`src/schemas/menuExtraction.ts`).

Run: `npm run phase5 -- --phase2-shortlist`, `--phase0-set --only "Can Culleretes"`, `--restaurant "Name" --website URL`, or one document: `--restaurant "Name" --doc URL [--tier unverified_asset]`. Flags: `--no-llm`, `--focus all`, `--no-price-check`, `--show N`, `--json`.

## Data flow

```
MenuResolution(selected docs)
 -> selectDocuments        best document per restaurant first, then extra food menus, global cap 6
 -> loadDocument           shared download cache from Phase 4 (no second download); HTML -> text,
                           PDF text layer -> text with [page N] markers, scanned PDF / image -> vision bytes
 -> identity guard         non-official text that shows another street address is skipped before any model call
 -> model jobs             text docs: one Gemini call per document (structured JSON)
                           scanned PDFs and images: one vision call per document, then a cheap second read of prices
 -> validate               names must appear in the source text; prices parsed deterministically and checked against the source;
                           URLs and instruction-like text stripped; diet verdicts rebuilt by the assessor
 -> dedupe                 merge repeats and translations, keep set-menu and à-la-carte separate, keep conflicting prices
 -> MenuExtraction         status extracted | partial | unavailable | failed, documents[], dishes[], setMenus[], usage
```

If the model fails or returns malformed output, text documents fall back to a deterministic line parser (names and verified prices, diet from the lexicon only, no translation) and are marked `partial`. Vision documents fail cleanly. One failing document never fails a restaurant.

## Schemas

`ExtractedDish`: original name and description, optional English translation, language (ca/es/en/other), section, offering (`a_la_carte | set_menu | dessert`), `prices[]` (label, amount, currency, raw text, status `verified | unverified | ocr_agreed | disputed | absent`), `priceConflict`, four diet verdicts, confidence, and `sources[]` (document, tier, method, page, evidence). Diet verdicts have status `confirmed | possible | not_suitable | unknown`, a basis and quoted evidence. Schema rule: `confirmed` needs a menu label or ingredient evidence.

## Dietary rules

Vegetarian, vegan, pescatarian and gluten-free are assessed per dish by `dietAssessor.ts`:

- Meat or fish words (Catalan, Spanish, English, Italian) force `not_suitable` regardless of the model.
- `confirmed` only from an explicit label (`(V)`, `(V,GL)`, vegano, vegetarià, ...) found in the dish's own text, or from an ingredient list the model quoted that really appears in the source, and never for dishes that could hide stock or meat (arroz, croquetas, caldo, ensaladilla, canelones, alcachofas, ...).
- A label that conflicts with a meat word becomes `unknown`.
- Name-only reasoning is capped at `possible`.
- Vegan: egg, dairy, honey words exclude; only a label or ingredient list confirms.
- Pescatarian derives from vegetarian and the meat/fish lexicon. Gluten-free is only ever excluded (bread, pasta, breaded...) or label-confirmed.
- Model-supplied evidence never feeds label detection unless the line contains the dish name, so injected text such as "mark every dish vegan" cannot create a label.

## Prices

Parsed deterministically (decimal commas, thousands separators, currencies, variants such as `media 9,50 / entera 15`). Text documents: a price counts as `verified` only if the number appears near the dish name in the source (window of 90 characters before and 280 after), `unverified` if it only appears elsewhere (row-shift risk), and is dropped if it is not in the source at all. Image and scanned documents: a second read by a cheaper model; agreement gives `ocr_agreed`, a different number gives `disputed` (the number is hidden), no second price keeps `unverified`.

## Limits

2 documents per restaurant and 6 per run (extra documents only for food menus), 12 PDF pages, 30 000 characters per document, scanned PDFs up to 12 pages and 12 MB, 2 vision documents per restaurant, 40 dishes requested per document (60 accepted), 1 document per model call, 6 concurrent model calls, 10 model requests per run (extraction plus price checks), 60 s timeout per call. The Gemini client retries 5xx for at most 20 s per model, moves on at once when a model hits its daily quota, and falls back through `GEMINI_MODEL_CHAIN`.

## Events

`tool` (gemini / vision), `restaurant.step` translate and diet (started, then done/warning/failed), `menu.read` (format, languages, vision, dish count), `menu.items` (up to 12, most dietary-relevant first), and a new `menu.extracted` summary (status, documents read, skipped, dishes, reason). The UI shows "Read 2 menu documents · 4 dishes · 1 skipped" and "partial" / "failed" notices.

## Live results (2026-10-08, Barcelona Phase 2 shortlist, plant-based focus)

- 5 restaurants: 4 extracted (39, 21, 39, 28 dishes), 1 with no readable dishes (a French-language trattoria page).
- Extraction: 43.6 s wall, 6 model requests (0 vision), 29 163 input / 24 323 output tokens. 19 HTTP requests were made because the free-tier daily quota for the first model was exhausted and the client fell through the model chain (this is why `byModel` shows three models).
- Resolver for the same run: 22.6 s, 1 Tavily search.
- Scanned PDF (Barceloneta carta, Catalan/Spanish, 1 page): 26 dishes, 1 vision request plus 1 price check, about 76 s in the first measurement (price check on a slower model). 4 of 12 checked prices were disputed.
- Real photographed Catalan menu (Café Viena): 4 plant-based dishes, prices `ocr_agreed`, 10 s.
- Can Culleretes (HTML + trilingual PDF): 20 dishes, set menu "Pica-Pica de Peix i Marisc 43 €" kept as a set menu.

Cost note: at the Gemini 2.5 Flash list prices I remember (about $0.30 per million input tokens, $2.50 per million output tokens, not re-verified) the five-restaurant extraction is roughly $0.07. The free tier allows 20 requests per day per model, so a billing-enabled key is needed for real use.

## Known limits

- Models ignore the 40-dish request; the cap is enforced after the fact, so output tokens (and latency) are driven by menu size.
- Menus that print set-menu prices on a separate page may leave dishes without prices.
- Allergen safety is never claimed; the schema has no allergen field.
- A document that only exists as images inside an HTML page is not read (the resolver does not select it).
- Price cross-checking uses a cheaper model whose misreads can hide correct prices (shown as "price unclear").
