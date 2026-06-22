/**
 * Durable trace storage on **Deno KV** — the opt-in alternative to the in-memory ring buffer, so
 * `/docs/_trace` can look past the last few hundred requests and answer "show me everything user X
 * did" with a fast indexed scan instead of an in-memory filter.
 *
 * Layout (all keys carry a TTL so storage stays bounded without a sweeper):
 *   ["keep_trace","time", startedAt, id]        -> Trace   // every trace, time-ordered
 *   ["keep_trace","user", user, startedAt, id]  -> Trace   // per-user secondary index
 *   ["keep_trace","users", user]                -> startedAt // distinct users, for the dropdown
 *
 * `startedAt` is a number, so KV's numeric key ordering gives chronological order for free; a
 * `reverse` range scan is newest-first. Reading by user is a single scan of the `user` index — no
 * full-table filter. The full trace is stored in BOTH the time and user index (not a pointer) so
 * either read is one round trip with no N+1 fan-out — the fastest lookup, at the cost of a second
 * copy that the TTL reaps anyway.
 *
 * Deno KV is an **unstable** API (needs `--unstable-kv`). To keep the package type-checkable and
 * publishable WITHOUT forcing that flag on every consumer, we don't reference `Deno.openKv`
 * through its unstable types — we reach it through a minimal locally-typed gate and degrade to a
 * disabled sink (the tracer then keeps using memory) when the flag is absent or KV won't open.
 */

import type { Trace, TraceSink } from "./mod.ts";

// ── Minimal local typing of the slice of Deno KV we use ──────────────────────
// Deliberately NOT the unstable Deno.Kv types, so `deno check` passes flag-free.
type KvKeyPart = string | number;
type KvKey = KvKeyPart[];
interface KvEntry {
  key: KvKey;
  value: unknown;
}
interface KvListSelector {
  prefix: KvKey;
}
interface KvListOptions {
  reverse?: boolean;
  limit?: number;
}
interface KvAtomic {
  set(key: KvKey, value: unknown, opts?: { expireIn?: number }): KvAtomic;
  commit(): Promise<unknown>;
}
interface Kv {
  atomic(): KvAtomic;
  list(
    selector: KvListSelector,
    options?: KvListOptions,
  ): AsyncIterable<KvEntry>;
  delete(key: KvKey): Promise<void>;
  close(): void;
}
type OpenKv = (path?: string) => Promise<Kv>;

const PREFIX = "keep_trace";
const DEFAULT_TTL_DAYS = 7;

let warnedOnce = false;
function warn(message: string): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(message);
}

/** The `Deno.openKv` function, or undefined when `--unstable-kv` isn't enabled. */
function openKvGate(): OpenKv | undefined {
  return (Deno as unknown as { openKv?: OpenKv }).openKv;
}

/**
 * A {@linkcode TraceSink} backed by Deno KV. Opens lazily on first use and memoizes the handle;
 * if KV is unavailable it logs once and behaves as a no-op (records drop, reads return empty) so
 * the request path is never affected — the tracer should be configured to fall back to memory in
 * that case (see {@linkcode createKvTraceSink}).
 */
export class KvTraceSink implements TraceSink {
  private handle?: Promise<Kv | null>;
  private readonly ttlMs: number;

  constructor(
    private readonly path: string | undefined,
    ttlDays: number = DEFAULT_TTL_DAYS,
  ) {
    this.ttlMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
  }

  /** True once a KV handle has actually opened — lets the tracer verify before committing to KV. */
  async available(): Promise<boolean> {
    return (await this.kv()) !== null;
  }

  private kv(): Promise<Kv | null> {
    if (!this.handle) this.handle = this.open();
    return this.handle;
  }

  private async open(): Promise<Kv | null> {
    const openKv = openKvGate();
    if (!openKv) {
      warn(
        "[keep] KEEP_TRACE_KV set but Deno KV is unavailable — run with --unstable-kv to persist traces. Falling back to in-memory traces.",
      );
      return null;
    }
    try {
      return await openKv(this.path);
    } catch (err) {
      warn(
        `[keep] could not open Deno KV for traces (${
          err instanceof Error ? err.message : String(err)
        }). Falling back to in-memory traces.`,
      );
      return null;
    }
  }

  async record(trace: Trace): Promise<void> {
    const kv = await this.kv();
    if (!kv) return;
    try {
      const at = trace.startedAt;
      const id = trace.id;
      const a = kv.atomic().set([PREFIX, "time", at, id], trace, {
        expireIn: this.ttlMs,
      });
      if (trace.user) {
        a.set([PREFIX, "user", trace.user, at, id], trace, {
          expireIn: this.ttlMs,
        });
        a.set([PREFIX, "users", trace.user], at, { expireIn: this.ttlMs });
      }
      await a.commit();
    } catch {
      // Persisting a trace must never disturb the request that produced it.
    }
  }

  async list(opts?: { user?: string; limit?: number }): Promise<Trace[]> {
    const kv = await this.kv();
    if (!kv) return [];
    const prefix: KvKey = opts?.user
      ? [PREFIX, "user", opts.user]
      : [PREFIX, "time"];
    const out: Trace[] = [];
    try {
      for await (
        const e of kv.list({ prefix }, {
          reverse: true,
          limit: opts?.limit ?? 200,
        })
      ) {
        out.push(e.value as Trace);
      }
    } catch {
      // a transient read error degrades to "nothing", never an exception into the route
    }
    return out;
  }

  async users(): Promise<string[]> {
    const kv = await this.kv();
    if (!kv) return [];
    const out: string[] = [];
    try {
      for await (const e of kv.list({ prefix: [PREFIX, "users"] })) {
        const u = e.key[e.key.length - 1];
        if (typeof u === "string") out.push(u);
      }
    } catch {
      // ignore
    }
    return out.sort();
  }

  async clear(): Promise<void> {
    const kv = await this.kv();
    if (!kv) return;
    try {
      for await (const e of kv.list({ prefix: [PREFIX] })) {
        await kv.delete(e.key);
      }
    } catch {
      // ignore
    }
  }

  /** Close the underlying KV handle. Long-lived servers never need this; tests do. */
  async close(): Promise<void> {
    const kv = await this.kv().catch(() => null);
    try {
      kv?.close();
    } catch {
      // ignore
    }
    this.handle = Promise.resolve(null);
  }
}

/**
 * Build a KV sink and confirm it actually opened. Returns the sink when KV is live, or `null` when
 * it isn't (flag missing / open failed) — the caller then keeps the in-memory sink, so enabling
 * persistence can never silently break tracing.
 */
export async function createKvTraceSink(
  path: string | undefined,
  ttlDays?: number,
): Promise<KvTraceSink | null> {
  const sink = new KvTraceSink(path, ttlDays ?? DEFAULT_TTL_DAYS);
  return (await sink.available()) ? sink : null;
}
