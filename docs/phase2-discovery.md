# Phase 2: Places discovery

Run: `npm run phase2` (assignment scenario), `npm run phase2 -- --meal breakfast --diet vegan --cuisine Italian --budget 15`, or `--request file.json`, `--json`.

## Pipeline

`UserRequest -> normalizeRequest -> buildPlacesQueries -> Places Text Search (<=2) -> merge by placeId -> filterCandidates -> buildShortlist (5)`

Events emitted from the real operations: `run.started`, `understood`, `discover.started`, `tool` (one per Places call), `discover.found`, `shortlist.done`. Every event is validated against `AgentEventSchema` before it is emitted.

## Query strategy (max 2 Places requests per run)

| Query | When | Example |
|---|---|---|
| q1 primary | always | `italian restaurants in Barcelona` |
| q2 diet supplement | a diet is requested | `vegetarian italian restaurants in Barcelona` |
| q2 second cuisine | no diet, 2+ cuisines | `japanese restaurants in Barcelona` |

- Breakfast and brunch add the meal word. Lunch and dinner do not (Text Search does not use them well; hours filter handles them).
- The diet is never in the primary query, so restaurants Google does not label vegetarian still appear.
- Each query asks for 20 results (page 1 only). Results are merged by `placeId`; `foundBy` keeps query id and rank.
- Request body: `includedType=restaurant`, `languageCode=en`, `regionCode` from the city, `locationBias` circle (city center, radius clamped to 50 km).
- No retries, no pagination, no Place Details calls.

## Field mask

```
places.id, places.displayName, places.formattedAddress, places.location, places.types,
places.primaryType, places.businessStatus, places.googleMapsUri                      (Pro tier)
places.rating, places.userRatingCount, places.priceLevel, places.websiteUri,
places.regularOpeningHours                                                          (Enterprise tier)
places.servesVegetarianFood                                                         (optional, see below)
```

Not requested: reviews, photos, priceRange, phone, editorialSummary, currentOpeningHours.

Billing (Google's usage page): a request is billed at the highest SKU among the requested fields. Ratings, opening hours and website URIs are Enterprise. The official pages I could read do not state the tier of `servesVegetarianFood`; I believe it sits in the higher Atmosphere tier, which is unverified. It is only a weak shortlist bonus, so `PLACES_REQUEST_VEGETARIAN_SIGNAL=false` drops it from the mask. Check the Google Cloud billing report after the first runs.

## Caching

None. Places content is kept in memory for the duration of a run only. Dev fixtures with Places data would go in `fixtures/places/` (git-ignored).

## Filtering (deterministic, conservative)

Excluded: invalid candidate; permanently or temporarily closed; place types contain no food venue; farther than 2.5x the city radius (15 km for Barcelona) or `maxDistanceKm`; opening hours exist and show no service during the meal window on any day (breakfast 08-11, brunch 10-14, lunch 13-16, dinner 19-23).

Never excluded for: missing or false `servesVegetarianFood`, missing price level, missing website, missing rating, missing hours, budget mismatch, subjective preferences.

## Shortlist score (0..1)

`score = sum(weight * value) / sum(weight of applicable signals)`

| Signal | Weight | Value |
|---|---|---|
| rating | 0.28 | Bayesian rating `(n/(n+50))*r + (50/(n+50))*4.2`, mapped `(x-3.5)/1.5` and clamped |
| credibility | 0.14 | `log10(1+n)/3.5`, clamped |
| priceFit | 0.14 | price level vs budget bands (1: 5-12, 2: 12-25, 3: 25-45, 4: 45-80 EUR); not scored if either is missing |
| cuisineMatch | 0.18 | 1 Places type match, 0.8 name match, 0.5 found by a cuisine query, else 0.2; not scored without a cuisine |
| searchRank | 0.12 | position in Google's own relevance order, small bonus for appearing in both queries |
| distance | 0.09 | 1 within 1 km, falling linearly to 0 at 8 km |
| vegetarianSignal | 0.05 | 1 if `servesVegetarianFood`, else 0; only when vegetarian/vegan is requested |

Ties: higher rating count, then `placeId`. One location per brand key (name before ` - `, `|`, `(`); duplicates get a `duplicate brand location` penalty note. Each entry keeps `signals`, `penalties`, `included`, `reason`.

## Known limits

- Price bands are heuristics for EUR per person, not Google data.
- Brand de-duplication is name-based; "Billy Brunch & Park" and "Billy Brunch" are not recognised as one brand.
- "Not too crowded" and other preferences stay in `unresolvedPreferences` for the review phase.
- Free text without a form field is rejected until natural-language parsing exists.
