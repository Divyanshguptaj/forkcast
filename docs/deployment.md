# Deployment guide (Vercel) and cost safeguards

Status: **prepared, not deployed.** Nothing here has been run on Vercel. Platform facts below come from Vercel's documentation (linked); anything marked "verify" can only be confirmed after the first preview deployment.

## 1. Compatibility check

| Topic | Finding |
|---|---|
| Framework | Next.js 16 (App Router). `vercel.json` sets `framework: nextjs` and one region (`fra1`, Frankfurt, close to Spain). Region choice is free; adding more regions is not. |
| Node | `engines.node` is `>=22`; Vercel supports Node 22 and the local build was verified on 22.13. |
| Route runtime | `/api/recommend` is a Node.js route handler (not Edge). It exports `maxDuration = 120`. Vercel supports a named `maxDuration` export for the Next.js App Router, and the duration includes time spent streaming the response ([Configuring maximum duration](https://vercel.com/docs/functions/configuring-functions/duration)). |
| Duration limit | With Fluid compute, Hobby has a 300 s maximum and Pro 800 s ([Limits](https://vercel.com/docs/functions/limitations)). A search takes 15-45 s and is hard-stopped at 90 s, so 120 s is safe. Projects created before 23 April 2025 without Fluid compute have a 60 s maximum on Hobby, which would be too short: check that Fluid compute is on for the project. |
| Memory | Hobby functions have up to 2 GB. Measured in live runs: about +170 to +280 MB resident memory per search (menus up to a few MB each, 10-20 MB fetched per search). With the default `MAX_CONCURRENT_RUNS=4` that is roughly 1.1 GB worst case plus the Next.js baseline, under 2 GB. Do not raise the concurrency without re-measuring. |
| SSE streaming | The Node runtime streams by default. The handler sends `text/event-stream`, `cache-control: no-store, no-transform`, and an SSE comment heartbeat every 15 s. Vercel also sends HTTP/2 PING frames while a response is idle, and recommends progress or heartbeat data for HTTP/1.1 clients, which the heartbeat provides. **Verify** after the first preview deployment that events arrive progressively (not all at once) in a real browser. |
| Cancellation | The browser aborts the fetch; the handler's `req.signal` aborts the run, which cancels in-flight provider calls and queued work. This was verified locally with a real browser and with a dropped client. **Verify** on Vercel that closing the tab stops work (check the function log line `outcome: cancelled`). |
| Client IP | The rate limiter keys on `x-forwarded-for`. Vercel overwrites that header from the TCP connection and does not forward client-supplied values ([Request headers](https://vercel.com/docs/headers/request-headers)), so it cannot be spoofed on Vercel. Keep `TRUST_PROXY_HEADERS=true` on Vercel; set it to `false` on a host without a trusted proxy. |
| Secrets | Keys are only read in server code (`process.env` in route handlers and providers). No `NEXT_PUBLIC_` variables exist. `.env*` is git-ignored and `.vercelignore` excludes it. Add keys in the Vercel dashboard (Project Settings, Environment Variables), marked Sensitive, for Production and Preview. |
| Logs | One JSON line per search: outcome, timings, call counts, tokens, estimated cost. It never contains the query text, keys or provider error bodies (covered by tests). |
| Build | `npm run build` is green; production responses carry a CSP and security headers (`next.config.ts`). |
| Upload size | `.vercelignore` excludes tests, fixtures, scripts, screenshots and local output. |

## 2. Environment variables to set

Required: `GOOGLE_PLACES_API_KEY`. Recommended: `GEMINI_API_KEY`, `TAVILY_API_KEY`. Optional: `GEMINI_MODEL_CHAIN`, `GEMINI_PRICE_CHECK_MODEL`, `RATE_LIMIT_MAX_REQUESTS`, `RATE_LIMIT_WINDOW_SEC`, `MAX_CONCURRENT_RUNS`, `GLOBAL_MAX_SEARCHES_PER_DAY`, `TRUST_PROXY_HEADERS`. Leave `PLACES_REVIEWS_TO_LLM=false`. Defaults are in `.env.example`.

## 3. Cost per search and safeguards

**Estimated** cost per completed search is about **$0.12 to $0.17**. This is computed from assumed list prices (`src/server/agent/cost.ts`: Gemini $0.30 / $2.50 per million input / output tokens, Tavily $0.008 per credit, Places $0.035 per request). These prices have not been checked against current provider pricing and the number is **not a billed amount**. The Gemini free tier was used for every live run, so no billing has been observed. Use your provider consoles for actual cost.

Observed ranges in live runs: 6-12 Gemini calls (output 15-28 thousand tokens), 1-8 Tavily credits, 2 Places requests, 10-25 MB of pages fetched.

Safeguards in the code (all enforced server-side):

| Safeguard | Default | Where |
|---|---|---|
| Gemini calls per search | at most 16 (observed 6-12); after that menus fall back to the basic parser and the result says so | `RUN_LIMITS.geminiCallsPerSearch`, `src/server/agent/budget.ts` |
| Tavily calls per search | at most 12 (observed 1-8) | `RUN_LIMITS.tavilyCallsPerSearch` |
| Places requests per search | 2 (fixed by the query plan) | `queryBuilder` |
| Output tokens per Gemini call | 7,000 (price checks 2,500); estimated input tokens per restaurant 160,000 | `extract/limits.ts` |
| Documents per restaurant / per search | 2 / 10 | extraction limits |
| Provider timeouts | Places 8 s, Tavily 12 s, Gemini 60 s per call, understanding step 6 s | provider clients |
| Search deadline | soft stop at 72 s, hard stop at 90 s, with partial results | `run.ts` |
| Per-client limit | 6 searches per 10 minutes, one at a time | `RateLimiter` |
| Concurrent searches | 4 per instance | `MAX_CONCURRENT_RUNS` |
| Global ceiling | 100 searches per 24 h per instance, then a friendly "demo limit reached" | `GLOBAL_MAX_SEARCHES_PER_DAY` |
| Cancellation | closing the tab or pressing Cancel aborts all in-flight provider calls | handler + orchestrator |
| Gemini quota exhaustion | daily-quota models are paused (circuit breaker), no retries on exhausted quota, result discloses it | `quotaBreaker.ts` |

Theoretical ceiling (all limits hit at once): about $0.48 per search with the assumed prices (16 Gemini calls at the 7,000-token output cap, 12 Tavily calls, 2 Places requests), so about $48 per day per instance at the default daily cap. Typical use is far lower. These figures are arithmetic from assumed prices, not measurements.

**Limitation that matters for cost**: the rate limiter, the daily ceiling, and the extraction cache live in each server instance's memory. Vercel can run several instances, so the real global ceiling is `GLOBAL_MAX_SEARCHES_PER_DAY` times the number of instances (Fluid compute reuses instances for concurrent requests, which helps but does not guarantee a single one). No shared store was added because none is justified for a small demo. If you need a hard global cap, use provider-side limits (below) rather than relying on in-memory counters.

## 4. Manual steps before and after deploying (not done)

1. Provider-side spending limits (the only hard caps): set a budget and alerts in Google Cloud for the Places API key and restrict the key to the Places API (New); set a spend cap or keep the Gemini key on the free tier; check the Tavily plan limit. Restrict each key to its API.
2. Vercel: create the project from the private repository, confirm Fluid compute is enabled, add environment variables, deploy a **Preview** first.
3. Check the Vercel spend-management setting for the team so a traffic spike cannot run up Vercel usage; consider a Vercel Firewall rate-limit rule on `/api/recommend` if your plan includes it (verify availability on your plan before relying on it).
4. Smoke test on the preview: run one search in a real browser, confirm progressive events, then cancel one and confirm the log shows `cancelled`; confirm `GET /api/health` shows all three keys `true`.
5. Git history: this repository already has the Google Places recordings removed from every commit (see `docs/git-history-cleanup.md`); the private predecessor repository still contains them and should stay private or be deleted.
6. Optional: protect the preview/production URL (Vercel Deployment Protection) while you evaluate it, so only people you share it with can spend your quota.

## 5. Rollback

Redeploy the previous deployment from the Vercel dashboard. No data store or migration is involved.
