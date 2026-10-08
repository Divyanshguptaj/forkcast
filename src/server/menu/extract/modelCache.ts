import { createHash } from "node:crypto";
import type { ModelDocument } from "./modelSchema";

export function contentKey(...parts: Array<string | Uint8Array>): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export class ExtractionCache {
  readonly #entries = new Map<string, Promise<ModelDocument>>();
  readonly #max: number;

  constructor(max = 64) {
    this.#max = max;
  }

  get size(): number {
    return this.#entries.size;
  }

  async getOrRun(key: string, run: () => Promise<ModelDocument>): Promise<{ doc: ModelDocument; hit: boolean }> {
    const existing = this.#entries.get(key);
    if (existing) {
      this.#entries.delete(key);
      this.#entries.set(key, existing);
      return { doc: await existing, hit: true };
    }
    const pending = run();
    this.#entries.set(key, pending);
    pending.catch(() => this.#entries.delete(key));
    while (this.#entries.size > this.#max) this.#entries.delete(this.#entries.keys().next().value as string);
    return { doc: await pending, hit: false };
  }
}

export const sharedExtractionCache = new ExtractionCache();
