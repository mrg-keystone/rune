import { assert, assertEquals } from "#assert";
import { toOtlp, TraceShipper } from "./ship.ts";
import type { Span, Trace } from "./mod.ts";

// Minimal typing of the OTLP/HTTP traces request we build — enough to assert on without `any`.
interface OtlpVal {
  stringValue?: string;
  intValue?: string;
  boolValue?: boolean;
  doubleValue?: number;
}
interface OtlpAttr {
  key: string;
  value: OtlpVal;
}
interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttr[];
  status: { code: number; message?: string };
}
interface OtlpDoc {
  resourceSpans: {
    resource: { attributes: OtlpAttr[] };
    scopeSpans: { scope: { name: string }; spans: OtlpSpan[] }[];
  }[];
}

const doc = (t: Trace, service: string, env: string): OtlpDoc =>
  toOtlp(t, service, env) as unknown as OtlpDoc;
const spansOf = (d: OtlpDoc): OtlpSpan[] =>
  d.resourceSpans[0].scopeSpans[0].spans;
const byName = (spans: OtlpSpan[]): Record<string, OtlpSpan> =>
  Object.fromEntries(spans.map((s) => [s.name, s]));

function span(
  id: number,
  parentId: number | null,
  name: string,
  kind: Span["kind"],
  start: number,
  end: number,
  error?: { message: string; type?: string },
  meta?: Record<string, unknown>,
): Span {
  return {
    id,
    parentId,
    name,
    kind,
    start,
    end,
    ...(error ? { error } : {}),
    ...(meta ? { meta } : {}),
  };
}

function trace(): Trace {
  return {
    id: "req-123",
    app: "shop",
    method: "POST",
    route: "/orders",
    user: "alice",
    status: 500,
    startedAt: 1_700_000_000_000, // epoch ms
    durationMs: 80,
    ok: false,
    crashedSpanId: 3,
    spans: [
      span(1, null, "POST /orders", "request", 0, 80),
      span(2, 1, "priceCart", "user", 1, 40),
      span(3, 2, "chargeCard", "user", 41, 79, {
        message: "declined",
        type: "Error",
      }),
      span(4, 1, "POST /inventory", "backend", 5, 9, undefined, {
        status: 200,
      }),
    ],
  };
}

Deno.test("toOtlp - one resource with service + env, scope 'keep'", () => {
  const d = doc(trace(), "shop", "local");
  assertEquals(d.resourceSpans.length, 1);
  const byKey = Object.fromEntries(
    d.resourceSpans[0].resource.attributes.map((
      a,
    ) => [a.key, a.value.stringValue]),
  );
  assertEquals(byKey["service.name"], "shop");
  assertEquals(byKey["deployment.environment"], "local");
  assertEquals(d.resourceSpans[0].scopeSpans[0].scope.name, "keep");
});

Deno.test("toOtlp - ids are correct width, shared trace id, parents linked", () => {
  const spans = spansOf(doc(trace(), "shop", "production"));
  const traceIds = new Set(spans.map((s) => s.traceId));
  assertEquals(traceIds.size, 1, "all spans share one trace id");
  for (const s of spans) {
    assertEquals(s.traceId.length, 32, "trace id is 16 bytes (32 hex)");
    assertEquals(s.spanId.length, 16, "span id is 8 bytes (16 hex)");
    assert(
      /^[0-9a-f]+$/.test(s.traceId) && /^[0-9a-f]+$/.test(s.spanId),
      "lowercase hex",
    );
  }
  const n = byName(spans);
  assertEquals(n["POST /orders"].parentSpanId, undefined, "root has no parent");
  assertEquals(n["priceCart"].parentSpanId, n["POST /orders"].spanId);
  assertEquals(n["chargeCard"].parentSpanId, n["priceCart"].spanId);
});

Deno.test("toOtlp - kinds, error status, absolute nano timestamps, meta attrs", () => {
  const n = byName(spansOf(doc(trace(), "shop", "production")));

  assertEquals(n["POST /orders"].kind, 2, "request = SERVER");
  assertEquals(n["priceCart"].kind, 1, "user = INTERNAL");
  assertEquals(n["POST /inventory"].kind, 3, "backend = CLIENT");

  assertEquals(n["chargeCard"].status, { code: 2, message: "declined" });
  assertEquals(n["priceCart"].status, { code: 0 });

  // 1_700_000_000_000 ms + 1 ms offset = 1_700_000_000_001 ms => * 1e6 nanos.
  assertEquals(
    n["priceCart"].startTimeUnixNano,
    String(1_700_000_000_001 * 1e6),
  );
  assertEquals(
    n["POST /orders"].endTimeUnixNano,
    String(1_700_000_000_080 * 1e6),
  );

  const invAttrs = Object.fromEntries(
    n["POST /inventory"].attributes.map((a) => [a.key, a.value]),
  );
  assertEquals(invAttrs["keep.kind"].stringValue, "backend");
  assertEquals(invAttrs["status"].intValue, "200");
});

function stubFetch(status = 200) {
  const calls: { url: string; body: OtlpDoc; headers: Headers }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(init?.body as string),
      headers: new Headers(init?.headers),
    });
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test("ship - sends configured guard headers (e.g. X-Keep-Token) on every POST", async () => {
  const { fn, calls } = stubFetch();
  const s = new TraceShipper();
  s.configure({
    endpoint: "http://vps:4318",
    service: "shop",
    env: "production",
    enabled: true,
    headers: { "X-Keep-Token": "s3cret" },
    transport: fn,
  });
  await s.ship(trace());
  assertEquals(calls[0].headers.get("x-keep-token"), "s3cret");
  assertEquals(calls[0].headers.get("content-type"), "application/json");
});

Deno.test("ship - disabled returns null and never fetches", () => {
  const { fn, calls } = stubFetch();
  const s = new TraceShipper();
  s.configure({
    endpoint: "http://vps:4318",
    service: "shop",
    env: "local",
    enabled: false,
    transport: fn,
  });
  assertEquals(s.ship(trace()), null);
  assertEquals(calls.length, 0);
});

Deno.test("ship - enabled POSTs OTLP JSON to <endpoint>/v1/traces and is awaitable", async () => {
  const { fn, calls } = stubFetch();
  const s = new TraceShipper();
  s.configure({
    endpoint: "http://vps:4318",
    service: "shop",
    env: "production",
    enabled: true,
    transport: fn,
  });
  const p = s.ship(trace());
  assert(p, "returns a promise to flush");
  await p;
  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "http://vps:4318/v1/traces");
  assert(calls[0].body.resourceSpans, "body is an OTLP request");
});

Deno.test("ship - endpoint that already ends in /v1/traces is not doubled", async () => {
  const { fn, calls } = stubFetch();
  const s = new TraceShipper();
  s.configure({
    endpoint: "http://vps:4318/v1/traces/",
    service: "shop",
    env: "production",
    enabled: true,
    transport: fn,
  });
  await s.ship(trace());
  assertEquals(calls[0].url, "http://vps:4318/v1/traces");
});

Deno.test("ship - a failing transport never rejects (fire-and-forget is safe to await)", async () => {
  const fn = (() => Promise.reject(new Error("connrefused"))) as typeof fetch;
  const s = new TraceShipper();
  s.configure({
    endpoint: "http://vps:4318",
    service: "shop",
    env: "local",
    enabled: true,
    transport: fn,
  });
  await s.ship(trace()); // must resolve, not throw
});
