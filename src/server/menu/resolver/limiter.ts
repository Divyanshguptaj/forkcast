export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly peak: number;
}

export function createLimiter(concurrency: number): Limiter {
  const max = Math.max(1, Math.floor(concurrency));
  let active = 0;
  let peak = 0;
  const waiting: Array<() => void> = [];

  const release = () => {
    active--;
    waiting.shift()?.();
  };

  return {
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
      active++;
      peak = Math.max(peak, active);
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
