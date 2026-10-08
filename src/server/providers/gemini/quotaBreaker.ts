export type BlockReason = "daily_quota" | "rate_limit" | "unavailable" | "not_found";

export const COOLDOWN_MS: Record<BlockReason, number> = {
  daily_quota: 60 * 60_000,
  rate_limit: 30_000,
  unavailable: 20_000,
  not_found: 24 * 60 * 60_000,
};

export interface BlockedModel {
  reason: BlockReason;
  remainingMs: number;
}

export class QuotaBreaker {
  readonly #blocked = new Map<string, { reason: BlockReason; until: number }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  block(model: string, reason: BlockReason, ms: number = COOLDOWN_MS[reason]): void {
    const until = this.#now() + ms;
    const existing = this.#blocked.get(model);
    if (!existing || existing.until < until) this.#blocked.set(model, { reason, until });
  }

  blocked(model: string): BlockedModel | undefined {
    const entry = this.#blocked.get(model);
    if (!entry) return undefined;
    const remainingMs = entry.until - this.#now();
    if (remainingMs <= 0) {
      this.#blocked.delete(model);
      return undefined;
    }
    return { reason: entry.reason, remainingMs };
  }

  clear(model: string): void {
    this.#blocked.delete(model);
  }

  snapshot(): Record<string, BlockedModel> {
    const out: Record<string, BlockedModel> = {};
    for (const model of [...this.#blocked.keys()]) {
      const state = this.blocked(model);
      if (state) out[model] = state;
    }
    return out;
  }
}

export const sharedQuotaBreaker = new QuotaBreaker();
