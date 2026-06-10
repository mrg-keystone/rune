/**
 * A small rate limiter combining a **concurrency cap** (semaphore) with **request spacing** (a
 * minimum interval between starts, derived from `requestsPerSecond`). The headless runner wraps
 * every endpoint call in `run()` so a retry loop can't overwhelm the server; the emulator's
 * "Run all" can pace itself the same way. No dependencies.
 */

export interface RateLimitOptions {
  /** Minimum spacing between request *starts*, expressed as a rate. Default 20. */
  requestsPerSecond?: number;
  /** Maximum number of in-flight requests. Default 4. */
  maxConcurrency?: number;
}

export interface Limiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

const delay = (ms: number) => ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms));

export function createLimiter(opts: RateLimitOptions = {}): Limiter {
  const rps = opts.requestsPerSecond && opts.requestsPerSecond > 0 ? opts.requestsPerSecond : 20;
  const maxConcurrency = opts.maxConcurrency && opts.maxConcurrency > 0 ? opts.maxConcurrency : 4;
  const interval = 1000 / rps;

  let active = 0;
  let nextStart = 0;
  const waiters: Array<() => void> = [];

  const acquireSlot = (): Promise<void> => {
    if (active < maxConcurrency) {
      active++;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => waiters.push(resolve));
  };

  const releaseSlot = () => {
    const next = waiters.shift();
    if (next) next();
    else active--;
  };

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquireSlot();
      // Enforce minimum spacing between starts, even across concurrent callers.
      const now = Date.now();
      const start = Math.max(now, nextStart);
      nextStart = start + interval;
      await delay(start - now);
      try {
        return await fn();
      } finally {
        releaseSlot();
      }
    },
  };
}
