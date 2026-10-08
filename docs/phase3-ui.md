# Phase 3: UI shell, design system and research visualization

Run: `npm run dev`, open `/`. Replay controls are in the "Demo controls" disclosure at the bottom. URL shortcuts: `/?scenario=full-demo|phase2|no-results|places-down|timeout&speed=0|1|3`. Component gallery: `/dev/gallery`.

## Direction

Forkcast is an after-dark market stall: warm charcoal, cream ink, tomato for actions, saffron for highlights, basil for "vegetarian / verified". Thick 2 px borders, hard offset shadows on primary surfaces, sticker-style badges rotated a few degrees, receipt-style "menu tickets". Emoji are used as category markers (stage nodes, meal, diet, cuisine), never alone for meaning. Lucide icons carry functional UI.

## Tokens (`src/app/globals.css`, Tailwind v4 `@theme`)

| Token | Value | Use |
|---|---|---|
| bg / surface / surface-2 / line | `#14110f` / `#1d1815` / `#29211c` / `#43372f` | page, cards, raised, borders |
| ink / muted | `#f6efe4` / `#bdae9c` | text |
| tomato / saffron / basil / chili | `#ff5a36` / `#ffc83d` / `#3ddc84` / `#ff7a7a` | action / highlight, warning / vegetarian, verified, done / problem |
| display / sans / mono | Bricolage Grotesque / DM Sans / JetBrains Mono | headings / body / prices and counts |
| radius | 18 px card, 12 px control, pill chips | |
| shadow | `4px 4px 0 ink` (pop), `3px 3px 0 rgb(0 0 0 / .5)` (soft) | |

Spacing is the Tailwind 4 px scale. No gradients beyond a faint dot grid on the body.

## Motion

`motion` for entrance/stagger/layout only: stage nodes pop on completion, shortlist rows slide in, discovery dots scale in, menu-ticket lines print one by one, counters count up. All reveal pacing is presentation of data that has already arrived. Reduced motion: `MotionConfig reducedMotion="user"`, a `usePrefersReducedMotion` hook that disables stagger and count-up, and a CSS `prefers-reduced-motion` block that removes pulses and sweeps. Everything renders complete with animation off.

## Architecture

```
AgentEventSource (replay now, SSE in Phase 8)
   -> useAgentRun -> agentReducer(RunState) -> selectors -> components
```

- `src/lib/agent/reducer.ts`: pure reducer over the Phase 1 `AgentEvent` contract. Idempotent (duplicate `seq` ignored), monotonic (stages and steps never move backwards), queues restaurant events that arrive before `shortlist.done`, ignores other runs, resets on a new `run.started`.
- `src/lib/agent/selectors.ts`: per-restaurant phase (`waiting`, `researching`, `menu_found`, `menu_reading`, `menu_unreadable`, `menu_unavailable`, `review_research`, `complete`, `degraded`, `failed`) and run-level notices.
- `src/lib/agent/replay.ts`: the only place with timers. Injectable scheduler, speed 0 = immediate.
- `src/mocks/replay/`: fixtures. `phase2` mirrors what the backend emits today. `full-demo` adds simulated menu and review events; `no-results`, `places-down`, `timeout` cover failure states. Every fixture event validates against `AgentEventSchema` (tested).
- The `shortlist.done` event gained optional `ratingCount`, `priceLevel`, `address`, `primaryType`, `mapsUrl`; the Phase 2 pipeline now fills them.

## Components

`compose/` Hero, SearchComposer, PreferenceChips (+ panels), AdvancedFilters, ExampleQueries, composerModel. `research/` AgentResearchView, ResearchTrail, DiscoveryFunnel, ShortlistBoard, RestaurantResearchRow, PipelineChips, MenuResearchState, ReviewResearchState, MenuTicket, ToolActivityBadge. `results/` RecommendationCardShell, ResultsPreview, DishPreview, DietBadge, PriceTag, SourceIndicator, MatchRing. `states/` StatusNotice (10 notice kinds). `shared/` Button, Chip, Badge, DemoSticker, Skeleton, CountUp. `app/` ForkcastApp, DemoBar.

## Honesty rules in the UI

- Free-text parsing is not implemented. The composer says so; chips drive the request. Example prompts set both the sentence and the chips as explicit presets.
- Shortlisted places are labelled "research candidates, not recommendations".
- Simulated stages and the results preview carry a "Demo data" sticker. The discovery-only replay shows no dishes, reviews or percentages.
- Disputed prices render as "Price unclear" with no number; missing prices as "No price listed"; "found but unreadable" menus keep the official link.

## Compliance note

The `phase2` and `full-demo` fixtures contain a handful of Places-derived demo values (names, ratings, review counts, distances) from the 2026-10-07 smoke test. Review or replace them before any public deployment (see the Places caching restriction in `docs/phase2-discovery.md`).

## Tests

Reducer, replay, compose controls, preference chips, shortlist rendering, degraded states, accessibility primitives and reduced motion run in Vitest (jsdom). Playwright (`npm run test:e2e`, desktop and mobile, axe WCAG A/AA) covers landing, example fill, keyboard panels, the full replay, failure states, reduced motion and the gallery. Screenshots are written to `docs/screenshots/`.
