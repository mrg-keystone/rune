/**
 * Ship finished traces to an OTLP/HTTP endpoint — a Datadog Agent (or OpenTelemetry Collector)
 * that forwards to Datadog APM, where they render as flame graphs.
 *
 * No OpenTelemetry SDK, no context manager, no runtime span machinery: we already hold the whole
 * trace tree in memory by the time the request ends, so we just serialize it to OTLP/JSON and
 * POST it. The request-logger middleware fires this at request end and pushes the returned promise
 * into the request's `pending` list, so it's awaited in the SAME `settle()` flush as the logs,
 * right before danet returns the response. Fire-and-forget that we flush — exactly the logger's
 * pattern, reused.
 *
 * Wire format: OTLP/HTTP JSON (`POST <endpoint>/v1/traces`, `application/json`), which the
 * Datadog Agent's / Collector's OTLP receiver accepts. We hand-build the JSON — the only thing the
 * Agent dictates is the shape, and the shape is just data.
 *
 * IDs: a trace needs a 16-byte trace id and 8-byte span ids, in hex. We derive them
 * deterministically from the requestId (FNV-1a) so every span in a request shares one trace id and
 * parent links resolve, without pulling in a uuid/crypto dependency.
 */

import type { Span, Trace } from "./mod.ts";

/** OTLP span kind: 2=SERVER (request entry), 3=CLIENT (backend call), 1=INTERNAL (user fn). */
function otlpKind(kind: Span["kind"]): number {
  return kind === "request" ? 2 : kind === "backend" ? 3 : 1;
}

// ── deterministic hex ids via FNV-1a (no deps) ───────────────────────────────
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

function fnv64(s: string): bigint {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i) & 0xff);
    h = (h * FNV_PRIME) & MASK64;
  }
  return h;
}

/** 8-byte (16 hex) span id from a seed; never all-zero. */
function spanIdHex(seed: string): string {
  const h = fnv64(seed) || 1n;
  return h.toString(16).padStart(16, "0");
}

/** 16-byte (32 hex) trace id from the requestId; two FNV passes for the full width. */
function traceIdHex(requestId: string): string {
  return spanIdHex(requestId) + spanIdHex(requestId + "#");
}

interface OtlpAttr {
  key: string;
  value: Record<string, unknown>;
}

function attr(key: string, v: unknown): OtlpAttr | null {
  if (v == null) return null;
  if (typeof v === "string") return { key, value: { stringValue: v } };
  if (typeof v === "boolean") return { key, value: { boolValue: v } };
  if (typeof v === "number") {
    return Number.isInteger(v)
      ? { key, value: { intValue: String(v) } }
      : { key, value: { doubleValue: v } };
  }
  return { key, value: { stringValue: String(v) } };
}

/**
 * Map a finished {@linkcode Trace} to an OTLP/HTTP traces request body. Pure: trace in, JSON out.
 * Times are absolute Unix nanoseconds (`startedAt` is wall-clock epoch ms; span offsets are ms
 * from the trace start).
 */
export function toOtlp(
  trace: Trace,
  service: string,
  env: string,
): Record<string, unknown> {
  const traceId = traceIdHex(trace.id);
  const baseMs = trace.startedAt;
  const nanos = (ms: number) => String(Math.round((baseMs + ms) * 1e6));

  const spans = trace.spans.map((s) => {
    const attrs: OtlpAttr[] = [];
    const kindAttr = attr("keep.kind", s.kind);
    if (kindAttr) attrs.push(kindAttr);
    if (s.meta) {
      for (const [k, v] of Object.entries(s.meta)) {
        const a = attr(k, v);
        if (a) attrs.push(a);
      }
    }
    return {
      traceId,
      spanId: spanIdHex(`${trace.id}:${s.id}`),
      ...(s.parentId != null
        ? { parentSpanId: spanIdHex(`${trace.id}:${s.parentId}`) }
        : {}),
      name: s.name,
      kind: otlpKind(s.kind),
      startTimeUnixNano: nanos(s.start),
      endTimeUnixNano: nanos(s.end),
      attributes: attrs,
      status: s.error ? { code: 2, message: s.error.message } : { code: 0 },
    };
  });

  const resourceAttrs = [
    attr("service.name", service),
    attr("deployment.environment", env),
  ].filter((a): a is OtlpAttr => a !== null);

  return {
    resourceSpans: [{
      resource: { attributes: resourceAttrs },
      scopeSpans: [{ scope: { name: "keep" }, spans }],
    }],
  };
}

let warnedOnce = false;
function warn(message: string): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(message);
}

/**
 * Process-wide trace shipper. `bootstrapServer` configures it from env; the request-logger fires
 * {@linkcode ship} at request end and flushes the promise in `settle()`.
 */
export class TraceShipper {
  private url?: string;
  private service = "app";
  private env = "production";
  private enabled = false;
  private headers: Record<string, string> = {};
  private fetchFn: typeof fetch = fetch;

  /**
   * `endpoint` is the OTLP HTTP base (e.g. http://vps:4318); `/v1/traces` is appended if absent.
   * `headers` are sent on every POST — use them for a reverse-proxy guard (e.g. a Traefik router
   * that only matches requests carrying a secret `X-Keep-Token`).
   */
  configure(opts: {
    endpoint: string | undefined;
    service: string;
    env: string;
    enabled: boolean;
    headers?: Record<string, string>;
    transport?: typeof fetch;
  }): void {
    this.service = opts.service;
    this.env = opts.env;
    this.enabled = opts.enabled;
    this.headers = opts.headers ?? {};
    if (opts.transport) this.fetchFn = opts.transport;
    this.url = opts.endpoint ? this.resolve(opts.endpoint) : undefined;
  }

  private resolve(endpoint: string): string {
    const base = endpoint.replace(/\/+$/, "");
    return /\/v\d+\/traces$/.test(base) ? base : `${base}/v1/traces`;
  }

  isEnabled(): boolean {
    return this.enabled && Boolean(this.url);
  }

  /**
   * Serialize and POST `trace` (fire-and-forget). Returns the in-flight promise so the caller can
   * push it into the request's `pending` for the settle() flush, or null when shipping is off.
   * Never rejects — a failed ship warns once and is swallowed, exactly like a dropped log.
   */
  ship(trace: Trace): Promise<void> | null {
    if (!this.isEnabled() || !this.url) return null;
    const url = this.url;
    const body = JSON.stringify(toOtlp(trace, this.service, this.env));
    return (async () => {
      try {
        const res = await this.fetchFn(url, {
          method: "POST",
          headers: { "content-type": "application/json", ...this.headers },
          body,
        });
        if (!res.ok) {
          warn(
            `[keep] trace OTLP intake returned ${res.status} ${res.statusText} (${url}). Traces may not be reaching Datadog.`,
          );
        }
        // Drain the body so the connection can be reused / not leak.
        await res.body?.cancel().catch(() => {});
      } catch (err) {
        warn(
          `[keep] could not ship trace to ${url} (${
            err instanceof Error ? err.message : String(err)
          }). Traces disabled until it recovers.`,
        );
      }
    })();
  }
}

/** Process-wide shipper. `bootstrapServer` configures it; the request-logger fires it at egress. */
export const traceShipper: TraceShipper = new TraceShipper();
