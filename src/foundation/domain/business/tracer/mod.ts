/**
 * Request tracing — the data behind the `/docs/_trace` waterfall UI.
 *
 * Every inbound request opens a **trace**: a tree of timed **spans**. The root span is the whole
 * request (auto-opened by the request-logging middleware); the in-process `BackendClient` opens a
 * span around each sub-call; and user code wraps its own hot functions with {@linkcode span} (or
 * the {@linkcode Traced} method decorator) so they show up as their own segment. When a span
 * throws, the error is recorded ON that span and stamped as the trace's crash point — the UI
 * draws a ✕ exactly where execution died.
 *
 * Design constraints:
 * - **Never throw into the request path.** A bug in tracing must not break a real request, so
 *   every public entry point degrades to running the wrapped function untraced.
 * - **Concurrency-correct parenting.** The "current parent" rides in the same AsyncLocalStorage
 *   frame as the trace, so `Promise.all([span(a), span(b)])` nests both under the right parent
 *   without a shared mutable pointer race.
 * - **Bounded memory.** Completed traces land in a fixed-size ring buffer (newest wins); nothing
 *   is persisted. Capture is in-process only and reads cost nothing until the UI asks.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** A single timed segment within a request. Times are ms relative to the trace start. */
export interface Span {
  /** 1-based id, unique within its trace. The root span is id 1. */
  id: number;
  /** Parent span id; null only for the root. */
  parentId: number | null;
  name: string;
  /** What opened the span — drives the UI's color and the crash semantics. */
  kind: "request" | "backend" | "user";
  /** Start offset in ms from the trace's t0. */
  start: number;
  /** End offset in ms from the trace's t0 (set when the span closes). */
  end: number;
  /** Present when this span's function threw; the message is shown at the crash marker. */
  error?: { message: string; type?: string };
  /** Free-form extras (e.g. a backend span's `{ method, status }`). */
  meta?: Record<string, unknown>;
}

/** One request's complete trace — the unit the ring buffer stores and the UI renders as a bar. */
export interface Trace {
  /** The request id (correlates with the structured logs). */
  id: string;
  app: string;
  method: string;
  route: string;
  /**
   * Who made the request. Defaults to the verified token identity (the logger `source`); an app
   * can override it with its own notion of a user (e.g. a memberId) via {@linkcode Tracer.setUser}
   * / {@linkcode traceUser}. Undefined for unauthenticated (localhost/in-process) callers.
   */
  user?: string;
  /** Final HTTP status, set by the middleware at egress. */
  status?: number;
  /** Wall-clock start (epoch ms) — for the "5s ago" label only; never used for span math. */
  startedAt: number;
  /** Total request duration in ms. */
  durationMs: number;
  /** false when any span errored or the status is >= 400. */
  ok: boolean;
  /** The deepest span that threw — where the ✕ marker lands. null when nothing crashed. */
  crashedSpanId: number | null;
  spans: Span[];
}

/** What rides in the ALS frame: the trace being built plus the id of the enclosing span. */
interface TraceState {
  trace: Trace;
  parentId: number;
  /** Monotonic span-id source for this trace. */
  seq: { n: number };
  /** performance.now() captured at trace start — the zero point for span offsets. */
  t0: number;
}

const DEFAULT_CAPACITY = 200;

/**
 * Where completed traces are stored and read. Methods may be sync or async so the in-memory ring
 * stays synchronous while the Deno KV sink can await — the tracer awaits both uniformly.
 */
export interface TraceSink {
  record(trace: Trace): void | Promise<void>;
  /** Newest-first, optionally scoped to one user and/or capped. */
  list(opts?: { user?: string; limit?: number }): Trace[] | Promise<Trace[]>;
  /** Distinct users seen, for the filter dropdown. */
  users(): string[] | Promise<string[]>;
  clear(): void | Promise<void>;
}

/** Fixed-size newest-wins ring buffer — the default sink, zero dependencies, process-local. */
export class MemoryTraceSink implements TraceSink {
  private buf: Trace[] = [];
  private cap: number;

  constructor(capacity: number = DEFAULT_CAPACITY) {
    this.cap = Math.max(1, Math.floor(capacity));
  }

  record(trace: Trace): void {
    this.buf.push(trace);
    if (this.buf.length > this.cap) this.buf.shift();
  }

  list(opts?: { user?: string; limit?: number }): Trace[] {
    let r = this.buf.slice().reverse();
    if (opts?.user) r = r.filter((t) => t.user === opts.user);
    if (opts?.limit && r.length > opts.limit) r = r.slice(0, opts.limit);
    return r;
  }

  users(): string[] {
    const s = new Set<string>();
    for (const t of this.buf) if (t.user) s.add(t.user);
    return [...s].sort();
  }

  clear(): void {
    this.buf = [];
  }
}

/**
 * Process-wide request tracer. `bootstrapServer` calls {@linkcode configure} once; the
 * middleware and `BackendClient` drive it; the `/docs/_traces` route reads {@linkcode list}.
 */
export class Tracer {
  private appName = "app";
  enabled = true;
  private readonly als = new AsyncLocalStorage<TraceState>();
  private sink: TraceSink = new MemoryTraceSink();
  private persistent = false;

  configure(
    opts: { appName: string; enabled?: boolean; capacity?: number },
  ): void {
    this.appName = opts.appName;
    if (typeof opts.enabled === "boolean") this.enabled = opts.enabled;
    if (typeof opts.capacity === "number") {
      this.sink = new MemoryTraceSink(opts.capacity);
      this.persistent = false;
    }
  }

  /**
   * Swap in a custom sink (e.g. the Deno KV one). `bootstrapServer` calls this after confirming KV
   * actually opened; `persistent` flags the UI that traces survive restarts. Pass the in-memory
   * sink back to revert.
   */
  useSink(sink: TraceSink, persistent: boolean): void {
    this.sink = sink;
    this.persistent = persistent;
  }

  /** Whether the active sink durably persists traces (Deno KV) vs the in-memory ring. */
  isPersistent(): boolean {
    return this.persistent;
  }

  /** The trace currently being built, if any — lets the middleware skip nested in-process calls. */
  current(): Trace | undefined {
    return this.als.getStore()?.trace;
  }

  /**
   * Open a root trace, run `fn` inside it, and record the finished trace to the ring buffer.
   * The middleware wraps `await next()` with this. `annotate` runs after `fn` settles (success
   * or throw) so the caller can stamp the final status onto the root span/trace.
   */
  async trace<T>(
    meta: { requestId: string; method: string; route: string },
    fn: () => Promise<T>,
    annotate?: (trace: Trace) => void,
  ): Promise<T> {
    if (!this.enabled) return await fn();
    let t0: number;
    let trace: Trace;
    try {
      t0 = performance.now();
      trace = {
        id: meta.requestId,
        app: this.appName,
        method: meta.method,
        route: meta.route,
        startedAt: Date.now(),
        durationMs: 0,
        ok: true,
        crashedSpanId: null,
        spans: [{
          id: 1,
          parentId: null,
          name: `${meta.method} ${meta.route}`,
          kind: "request",
          start: 0,
          end: 0,
        }],
      };
    } catch {
      // Tracing setup must never break the request.
      return await fn();
    }
    const state: TraceState = { trace, parentId: 1, seq: { n: 1 }, t0 };
    try {
      return await this.als.run(state, fn);
    } catch (err) {
      this.markCrash(trace, 1, err);
      throw err;
    } finally {
      try {
        trace.durationMs = round(performance.now() - t0);
        trace.spans[0].end = trace.durationMs;
        annotate?.(trace);
        // Fire-and-forget: the sink may be async (KV), but recording must never delay or break
        // the response. A sync sink (memory) still records before this returns.
        void Promise.resolve(this.sink.record(trace)).catch(() => {});
      } catch {
        // Recording must never break the request either.
      }
    }
  }

  /**
   * Time `fn` as a span under the current trace. Outside a trace it's a pass-through, so it is
   * always safe to wrap code with it. On throw the error is recorded on the span and marked as
   * the trace's crash point, then re-thrown unchanged.
   */
  async span<T>(
    name: string,
    fn: () => T | Promise<T>,
    opts: { kind?: Span["kind"]; meta?: Record<string, unknown> } = {},
  ): Promise<T> {
    const parent = this.als.getStore();
    if (!parent) return await fn();
    let entry: Span;
    try {
      const id = ++parent.seq.n;
      entry = {
        id,
        parentId: parent.parentId,
        name,
        kind: opts.kind ?? "user",
        start: round(performance.now() - parent.t0),
        end: 0,
        ...(opts.meta ? { meta: opts.meta } : {}),
      };
      parent.trace.spans.push(entry);
    } catch {
      return await fn();
    }
    const child: TraceState = { ...parent, parentId: entry.id };
    try {
      return await this.als.run(child, fn);
    } catch (err) {
      try {
        entry.error = describeError(err);
        this.markCrash(parent.trace, entry.id, err);
      } catch { /* never break the throw path */ }
      throw err;
    } finally {
      try {
        entry.end = round(performance.now() - parent.t0);
      } catch { /* ignore */ }
    }
  }

  /**
   * Label the current request's trace with a user id — your own notion of identity (memberId,
   * email…), which overrides the auto-captured token source. No-op outside a request.
   */
  setUser(user: string): void {
    try {
      const s = this.als.getStore();
      if (s && user) s.trace.user = user;
    } catch { /* never break the request */ }
  }

  /** Attach `meta` to the span enclosing the current call (e.g. a backend span's status). */
  annotateCurrent(meta: Record<string, unknown>): void {
    try {
      const state = this.als.getStore();
      if (!state) return;
      const span = state.trace.spans.find((s) => s.id === state.parentId);
      if (span) span.meta = { ...span.meta, ...meta };
    } catch { /* ignore */ }
  }

  /** Newest-first traces, optionally scoped to one user and/or capped (default 200). */
  list(opts?: { user?: string; limit?: number }): Promise<Trace[]> {
    return Promise.resolve(this.sink.list(opts));
  }

  /** Distinct users seen — drives the filter dropdown. */
  users(): Promise<string[]> {
    return Promise.resolve(this.sink.users());
  }

  clear(): Promise<void> {
    return Promise.resolve(this.sink.clear()).then(() => {});
  }

  /** Record the crash point — keep the DEEPEST throwing span, since the error unwinds outward. */
  private markCrash(trace: Trace, spanId: number, err: unknown): void {
    trace.ok = false;
    const prev = trace.crashedSpanId;
    if (prev === null || spanId > prev) trace.crashedSpanId = spanId;
    if (!trace.spans[0].error) trace.spans[0].error = describeError(err);
  }
}

function describeError(err: unknown): { message: string; type?: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name, type: err.name };
  }
  return { message: typeof err === "string" ? err : String(err) };
}

function round(ms: number): number {
  return Math.round(ms * 1000) / 1000;
}

/** Process-wide tracer. `bootstrapServer` configures it; import it anywhere to read or extend. */
export const tracer: Tracer = new Tracer();

/**
 * Time a user function as its own segment in the current request's trace. Safe to use anywhere —
 * outside a request it just runs the function. Wrap your hot paths to see them in `/docs/_trace`:
 *
 * ```ts
 * const total = await span("priceCart", () => priceCart(items));
 * ```
 */
export function span<T>(
  name: string,
  fn: () => T | Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  return tracer.span(name, fn, { kind: "user", meta });
}

/**
 * Label the current request's trace with your own user id (memberId, email…), so the
 * `/docs/_trace` browser can group and filter by it. Overrides the auto-captured token identity;
 * safe to call anywhere (no-op outside a request).
 *
 * ```ts
 * traceUser(member.id);
 * ```
 */
export function traceUser(user: string): void {
  tracer.setUser(user);
}

/**
 * Method decorator equivalent of {@linkcode span}: every call to the method becomes a span named
 * `"<Class>.<method>"` (or the supplied name). Works on async and sync methods.
 *
 * ```ts
 * class Pricing {
 *   @Traced()
 *   async priceCart(items: Item[]) { ... }
 * }
 * ```
 */
export function Traced(name?: string): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    if (typeof original !== "function") return descriptor;
    const label = name ??
      `${
        (target as { constructor?: { name?: string } })?.constructor?.name ??
          "fn"
      }.${String(propertyKey)}`;
    descriptor.value = function (this: unknown, ...args: unknown[]) {
      return tracer.span(label, () => original.apply(this, args), {
        kind: "user",
      });
    };
    return descriptor;
  };
}
