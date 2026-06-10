import { assert, assertEquals } from "#assert";
import { createLimiter } from "./mod.ts";

Deno.test("createLimiter - never exceeds maxConcurrency", async () => {
  const limiter = createLimiter({ maxConcurrency: 2, requestsPerSecond: 1000 });
  let active = 0;
  let peak = 0;
  const task = () =>
    limiter.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 15));
      active--;
    });
  await Promise.all([task(), task(), task(), task(), task(), task()]);
  assertEquals(peak, 2);
});

Deno.test("createLimiter - spaces starts by the configured rate", async () => {
  // 100 req/s ⇒ 10ms spacing; 5 single-slot tasks ⇒ ≥ ~40ms total.
  const limiter = createLimiter({ maxConcurrency: 1, requestsPerSecond: 100 });
  const started = Date.now();
  for (let i = 0; i < 5; i++) await limiter.run(() => Promise.resolve());
  assert(Date.now() - started >= 35, `expected spacing, took ${Date.now() - started}ms`);
});

Deno.test("createLimiter - returns the fn result and releases on throw", async () => {
  const limiter = createLimiter({ maxConcurrency: 1, requestsPerSecond: 1000 });
  assertEquals(await limiter.run(() => Promise.resolve(42)), 42);
  let threw = false;
  try {
    await limiter.run(() => Promise.reject(new Error("boom")));
  } catch {
    threw = true;
  }
  assert(threw);
  // Slot was released despite the throw — a subsequent run still resolves.
  assertEquals(await limiter.run(() => Promise.resolve("ok")), "ok");
});
