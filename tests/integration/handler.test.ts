// MOCKED run function: these tests cover the HTTP layer (validation, limits, streaming, cancellation) only.
import { describe, expect, it, vi } from "vitest";
import { loadEnv } from "@/config/env";
import { parseSseFrame } from "@/lib/agent/sse";
import { RateLimiter } from "@/server/http/rateLimit";
import { createRecommendHandler, type HandlerDeps } from "@/server/http/recommendHandler";
import type { runRecommendation } from "@/server/agent/run";

const env = loadEnv({ GOOGLE_PLACES_API_KEY: "fake-places-key" });
const providers = { places: { searchText: async () => ({ restaurants: [], sources: [], droppedUnmappable: 0, latencyMs: 1 }) }, fetcher: { fetch: async () => { throw new Error("unused"); } } };

type Run = typeof runRecommendation;

function setup(run: Run, over: Partial<HandlerDeps> = {}) {
  const logs: Record<string, unknown>[] = [];
  const limiter = new RateLimiter({ maxRequests: 10, maxConcurrentPerClient: 1, maxConcurrentTotal: 4 });
  const handler = createRecommendHandler({ env: () => env, providers: () => providers, limiter, run, log: (l) => logs.push(l), ...over });
  return { handler, logs, limiter };
}

const okRun: Run = async (_body, deps) => {
  deps.emitter.emit({ type: "run.started" });
  deps.emitter.emit({ type: "discover.found", count: 0 });
  return { outcome: "no_results" };
};

function post(body: unknown, init: { headers?: Record<string, string>; signal?: AbortSignal; raw?: string } = {}) {
  return new Request("http://localhost/api/recommend", {
    method: "POST",
    headers: { "content-type": "application/json", ...init.headers },
    body: init.raw ?? JSON.stringify(body),
    signal: init.signal,
  });
}

describe("validation", () => {
  const { handler } = setup(okRun);

  it("requires JSON", async () => {
    const res = await handler(new Request("http://localhost/api/recommend", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" }));
    expect(res.status).toBe(415);
  });

  it("rejects malformed JSON, wrong shapes and empty requests with friendly messages", async () => {
    expect((await handler(post(null, { raw: "{nope" }))).status).toBe(400);
    const wrong = await handler(post({ text: 42 }));
    expect(wrong.status).toBe(400);
    expect((await wrong.json()).error.code).toBe("invalid_request");
    const empty = await handler(post({ text: "   ", form: { city: "Barcelona", meal: "any", diet: [], cuisines: [] } }));
    expect(empty.status).toBe(400);
    expect((await empty.json()).error.message).toMatch(/Describe what you are hungry for|Tell Forkcast what you are looking for/);
  });

  it("rejects over-long text and oversized bodies", async () => {
    expect((await handler(post({ text: "a".repeat(1001) }))).status).toBe(400);
    expect((await handler(post({ text: "x", pad: "y".repeat(20_000) }))).status).toBe(413);
    const lying = post({ text: "ok" }, { headers: { "content-length": "99999" } });
    expect((await handler(lying)).status).toBe(413);
  });

  it("returns 503 without leaking configuration details when the server is not configured", async () => {
    const { handler: h } = setup(okRun, { providers: () => undefined });
    const res = await h(post({ text: "vegan dinner" }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/GOOGLE|KEY|env/i);
  });
});

describe("streaming", () => {
  it("streams validated events as server-sent events and releases the slot when done", async () => {
    const { handler, limiter } = setup(okRun);
    const res = await handler(post({ text: "vegan dinner" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const text = await res.text();
    const events = text.split("\n\n").map(parseSseFrame).filter(Boolean);
    expect(events.map((e) => e!.type)).toEqual(["run.started", "discover.found"]);
    expect(limiter.activeRuns).toBe(0);
  });

  it("logs the outcome without the query text", async () => {
    const { handler, logs } = setup(okRun);
    await (await handler(post({ text: "my secret craving for kale" }))).text();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ evt: "recommend.run", outcome: "no_results" });
    expect(JSON.stringify(logs)).not.toContain("kale");
  });

  it("turns an unexpected failure into a generic error event with no internals", async () => {
    const boom: Run = async () => {
      throw new Error("AIzaSyLEAKED-KEY connection string postgres://user:pw@host");
    };
    const { handler } = setup(boom);
    const text = await (await handler(post({ text: "vegan dinner" }))).text();
    expect(text).not.toContain("AIza");
    expect(text).not.toContain("postgres");
    expect(parseSseFrame(text.split("\n\n")[0])).toMatchObject({ type: "error", code: "internal", recoverable: true });
  });
});

describe("limits and concurrency", () => {
  it("rejects a second search from the same client while one is running", async () => {
    let finish!: () => void;
    const slow: Run = (_b, deps) => new Promise((resolve) => {
      finish = () => resolve({ outcome: "completed" });
      deps.emitter.emit({ type: "run.started" });
    });
    const { handler } = setup(slow);
    const first = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "1.1.1.1" } }));
    const second = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "1.1.1.1" } }));
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error.code).toBe("already_running");
    expect(second.headers.get("retry-after")).toBeTruthy();
    finish();
    await first.text();
    const third = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "1.1.1.1" } }));
    expect(third.status).toBe(200);
    finish?.();
    await third.text();
  });

  it("serves different clients at the same time and caps total concurrency", async () => {
    const finishers: Array<() => void> = [];
    const slow: Run = (_b, deps) => new Promise((resolve) => {
      finishers.push(() => resolve({ outcome: "completed" }));
      deps.emitter.emit({ type: "run.started" });
    });
    const limiter = new RateLimiter({ maxConcurrentTotal: 2, maxRequests: 50 });
    const { handler } = setup(slow, { limiter });
    const a = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "10.0.0.1" } }));
    const b = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "10.0.0.2" } }));
    const c = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "10.0.0.3" } }));
    expect([a.status, b.status, c.status]).toEqual([200, 200, 429]);
    expect((await c.json()).error.code).toBe("busy");
    finishers.forEach((f) => f());
    await Promise.all([a.text(), b.text()]);
    expect(limiter.activeRuns).toBe(0);
  });

  it("stops accepting searches from anyone once the global ceiling is reached", async () => {
    const limiter = new RateLimiter({ globalMaxRequests: 2, maxRequests: 50 });
    const { handler } = setup(okRun, { limiter });
    for (const ip of ["1.1.1.1", "2.2.2.2"]) await (await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": ip } }))).text();
    const blocked = await handler(post({ text: "vegan dinner" }, { headers: { "x-forwarded-for": "3.3.3.3" } }));
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.error.code).toBe("capacity");
    expect(body.error.message).toContain("search limit");
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThanOrEqual(60);
  });

  it("applies a per-client rate limit", async () => {
    const limiter = new RateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const { handler } = setup(okRun, { limiter });
    const h = { "x-forwarded-for": "9.9.9.9" };
    for (let i = 0; i < 2; i++) await (await handler(post({ text: "vegan dinner" }, { headers: h }))).text();
    const blocked = await handler(post({ text: "vegan dinner" }, { headers: h }));
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error.code).toBe("rate_limited");
  });
});

describe("cancellation", () => {
  it("aborts the run and frees the slot when the client disconnects", async () => {
    let seen: AbortSignal | undefined;
    const waiting: Run = (_b, deps) => new Promise((resolve) => {
      seen = deps.signal;
      deps.signal.addEventListener("abort", () => resolve({ outcome: "cancelled" }));
    });
    const { handler, limiter, logs } = setup(waiting);
    const controller = new AbortController();
    const res = await handler(post({ text: "vegan dinner" }, { signal: controller.signal }));
    expect(limiter.activeRuns).toBe(1);
    controller.abort();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
    await vi.waitFor(() => expect(limiter.activeRuns).toBe(0));
    await res.body?.cancel().catch(() => undefined);
    expect(logs.at(-1)).toMatchObject({ outcome: "cancelled" });
  });

  it("aborts the run when the response stream is cancelled by the reader", async () => {
    let seen: AbortSignal | undefined;
    const waiting: Run = (_b, deps) => new Promise((resolve) => {
      seen = deps.signal;
      deps.signal.addEventListener("abort", () => resolve({ outcome: "cancelled" }));
    });
    const { handler, limiter } = setup(waiting);
    const res = await handler(post({ text: "vegan dinner" }));
    await res.body!.cancel();
    await vi.waitFor(() => expect(seen?.aborted).toBe(true));
    await vi.waitFor(() => expect(limiter.activeRuns).toBe(0));
  });
});

describe("RateLimiter", () => {
  it("forgets old requests after the window", () => {
    let now = 0;
    const limiter = new RateLimiter({ maxRequests: 1, windowMs: 1000, now: () => now });
    const first = limiter.tryStart("a");
    expect(first.ok).toBe(true);
    if (first.ok) first.release();
    expect(limiter.tryStart("a")).toMatchObject({ ok: false, reason: "rate_limited" });
    now = 1500;
    expect(limiter.tryStart("a").ok).toBe(true);
  });

  it("releases a slot only once", () => {
    const limiter = new RateLimiter();
    const a = limiter.tryStart("a");
    if (!a.ok) throw new Error("unexpected");
    a.release();
    a.release();
    expect(limiter.activeRuns).toBe(0);
  });

  it("bounds memory by pruning idle clients", () => {
    let now = 0;
    const limiter = new RateLimiter({ maxClients: 3, windowMs: 100, maxConcurrentTotal: 100, now: () => now });
    for (let i = 0; i < 10; i++) {
      const a = limiter.tryStart(`c${i}`);
      if (a.ok) a.release();
      now += 200;
    }
    expect(limiter.tryStart("fresh").ok).toBe(true);
  });
});
