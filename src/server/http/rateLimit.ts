export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  maxConcurrentPerClient: number;
  maxConcurrentTotal: number;
  maxClients: number;
  globalMaxRequests: number;
  globalWindowMs: number;
  now?: () => number;
}

export type Admission =
  | { ok: true; release(): void }
  | { ok: false; reason: "rate_limited" | "already_running" | "busy" | "capacity"; retryAfterSec: number };

export const DEFAULT_RATE_LIMIT: RateLimitOptions = { maxRequests: 6, windowMs: 10 * 60_000, maxConcurrentPerClient: 1, maxConcurrentTotal: 4, maxClients: 5_000, globalMaxRequests: 100, globalWindowMs: 24 * 60 * 60_000 };

export class RateLimiter {
  readonly #opts: RateLimitOptions;
  readonly #hits = new Map<string, number[]>();
  readonly #active = new Map<string, number>();
  #total = 0;
  #global: number[] = [];

  constructor(opts: Partial<RateLimitOptions> = {}) {
    this.#opts = { ...DEFAULT_RATE_LIMIT, ...opts };
  }

  get activeRuns(): number {
    return this.#total;
  }

  tryStart(client: string): Admission {
    const now = (this.#opts.now ?? Date.now)();
    const recent = (this.#hits.get(client) ?? []).filter((t) => now - t < this.#opts.windowMs);
    if ((this.#active.get(client) ?? 0) >= this.#opts.maxConcurrentPerClient) return { ok: false, reason: "already_running", retryAfterSec: 10 };
    if (recent.length >= this.#opts.maxRequests) return { ok: false, reason: "rate_limited", retryAfterSec: Math.max(1, Math.ceil((recent[0] + this.#opts.windowMs - now) / 1000)) };
    if (this.#total >= this.#opts.maxConcurrentTotal) return { ok: false, reason: "busy", retryAfterSec: 15 };
    this.#global = this.#global.filter((t) => now - t < this.#opts.globalWindowMs);
    if (this.#global.length >= this.#opts.globalMaxRequests) return { ok: false, reason: "capacity", retryAfterSec: Math.min(3600, Math.max(60, Math.ceil((this.#global[0] + this.#opts.globalWindowMs - now) / 1000))) };
    this.#global.push(now);

    this.#hits.set(client, [...recent, now]);
    this.#active.set(client, (this.#active.get(client) ?? 0) + 1);
    this.#total++;
    this.#prune(now);
    let released = false;
    return {
      ok: true,
      release: () => {
        if (released) return;
        released = true;
        this.#total--;
        const left = (this.#active.get(client) ?? 1) - 1;
        if (left <= 0) this.#active.delete(client);
        else this.#active.set(client, left);
      },
    };
  }

  #prune(now: number): void {
    if (this.#hits.size <= this.#opts.maxClients) return;
    for (const [client, times] of this.#hits) {
      if (!times.some((t) => now - t < this.#opts.windowMs) && !this.#active.has(client)) this.#hits.delete(client);
      if (this.#hits.size <= this.#opts.maxClients) break;
    }
  }
}
