/**
 * The headless counterpart to the emulator: discover a bootstrapped app's endpoints from its
 * generated Swagger docs (`x-keep-process` and all), order them by their explicit
 * `order`/`dependsOn`, run them in order under a rate limiter while chaining each response into
 * the next request via `bind`, and loop until everything passes (or a cap). Claude/CI call this to
 * prove a rune's logic without clicking through the UI.
 *
 * Transport: with no `baseUrl` it dispatches in-process via `backend.fetch` (no port, bypasses
 * auth) — the default for tests/CI. With a `baseUrl` it drives Playwright's `APIRequestContext`
 * against the running server (Playwright is an optional peer, lazy-imported only on this path).
 */

import type { BackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import type { SwaggerDocEntry } from "@types";
import { endpointsFromDoc, type SpecEndpoint } from "@foundation/domain/business/endpoint-spec/mod.ts";
import { processOrder } from "@foundation/domain/business/process-graph/mod.ts";
import { createLimiter, type RateLimitOptions } from "@foundation/domain/business/rate-limiter/mod.ts";
import { signToken } from "@foundation/domain/business/token/mod.ts";

/** The relevant slice of a `bootstrapServer(...)` return. */
export interface ExerciseTarget {
  backend: Pick<BackendClient, "fetch">;
  docs: SwaggerDocEntry[];
}

export type ExerciseAuth =
  | { kind: "in-process" }
  | { kind: "token"; token: string }
  | { kind: "mint"; signingKey: string; source: string; appName: string; roles?: string[] };

export interface SeedOverrides {
  /** Literal values injected into any endpoint's request by field name. */
  seeds?: Record<string, unknown>;
  /** Per-endpoint overrides keyed by endpoint id (operationId); win over seeds + bind. */
  byEndpoint?: Record<string, Record<string, unknown>>;
  /** How the runner authenticates. Defaults to in-process (no token). */
  auth?: ExerciseAuth;
}

export interface ExerciseOptions {
  api: ExerciseTarget;
  /** Running server origin. Set ⇒ Playwright over HTTP; unset ⇒ in-process backend.fetch. */
  baseUrl?: string;
  rateLimit?: RateLimitOptions;
  maxIterations?: number;
  overrides?: SeedOverrides;
}

export interface EndpointResult {
  id: string;
  method: string;
  path: string;
  ok: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

export interface ExerciseReport {
  passed: EndpointResult[];
  failed: EndpointResult[];
  iterations: number;
  order: string[];
  cycles: string[][];
}

interface CallResult {
  status: number;
  body: unknown;
  error?: string;
}

type Transport = (method: string, path: string, body: unknown) => Promise<CallResult>;

/** Assemble an endpoint's request values from seeds → bind (captured outputs) → per-endpoint overrides. */
function buildValues(
  ep: SpecEndpoint,
  store: Map<string, Record<string, unknown>>,
  overrides: SeedOverrides,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of ep.inputFields) {
    if (overrides.seeds && field in overrides.seeds) values[field] = overrides.seeds[field];
  }
  for (const [field, ref] of Object.entries(ep.bind)) {
    const [depId, outField] = ref.split(".");
    const src = store.get(depId);
    if (src && outField in src) values[field] = src[outField];
  }
  Object.assign(values, overrides.byEndpoint?.[ep.id] ?? {});
  return values;
}

/** Substitute `{name}` path params from the assembled values. */
function resolvePath(path: string, values: Record<string, unknown>): string {
  return path.replace(/\{([^}]+)\}/g, (_m, name) =>
    name in values ? encodeURIComponent(String(values[name])) : `{${name}}`);
}

async function buildTransport(opts: ExerciseOptions): Promise<{ transport: Transport; dispose: () => Promise<void> }> {
  const auth = opts.overrides?.auth ?? { kind: "in-process" };
  const headers: Record<string, string> = {};
  if (auth.kind === "token") headers.authorization = `Bearer ${auth.token}`;
  else if (auth.kind === "mint") {
    const token = await signToken(
      { source: auth.source, appName: auth.appName, roles: auth.roles },
      auth.signingKey,
    );
    headers.authorization = `Bearer ${token}`;
  }

  if (opts.baseUrl) {
    const { request } = await import("#playwright");
    const ctx = await request.newContext({ baseURL: opts.baseUrl, extraHTTPHeaders: headers });
    const transport: Transport = async (method, path, body) => {
      try {
        const res = await ctx.fetch(path, {
          method,
          data: method === "GET" ? undefined : (body ?? {}),
          headers: method === "GET" ? undefined : { "content-type": "application/json" },
        });
        const text = await res.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        return { status: res.status(), body: parsed };
      } catch (err) {
        return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
      }
    };
    return { transport, dispose: () => ctx.dispose() };
  }

  const transport: Transport = async (method, path, body) => {
    try {
      const init: RequestInit = { method, headers: { ...headers } };
      if (method !== "GET") {
        (init.headers as Record<string, string>)["content-type"] = "application/json";
        init.body = JSON.stringify(body ?? {});
      }
      const res = await opts.api.backend.fetch(path, init);
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
      return { status: res.status, body: parsed };
    } catch (err) {
      return { status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
    }
  };
  return { transport, dispose: () => Promise.resolve() };
}

/** Discover, order, and exercise every endpoint, chaining outputs into inputs until green. */
export async function exerciseEndpoints(opts: ExerciseOptions): Promise<ExerciseReport> {
  const overrides = opts.overrides ?? {};
  const maxIterations = opts.maxIterations ?? 5;
  const limiter = createLimiter(opts.rateLimit);

  // Flatten endpoints across all module docs; ids/paths are app-root-relative and globally usable.
  const endpoints = opts.api.docs.flatMap((d) => endpointsFromDoc(d.doc));
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  const { order, cycles } = processOrder(endpoints);

  const { transport, dispose } = await buildTransport(opts);
  const store = new Map<string, Record<string, unknown>>();
  const results = new Map<string, EndpointResult>();
  for (const ep of endpoints) {
    results.set(ep.id, { id: ep.id, method: ep.method, path: ep.path, ok: false, attempts: 0 });
  }

  let iterations = 0;
  try {
    while (iterations < maxIterations) {
      iterations++;
      const pending = order.filter((id) => !results.get(id)!.ok);
      if (pending.length === 0) break;

      for (const id of pending) {
        const ep = byId.get(id)!;
        const values = buildValues(ep, store, overrides);
        const path = resolvePath(ep.path, values);
        const result = results.get(id)!;
        result.attempts++;
        const call = await limiter.run(() => transport(ep.method, path, values));
        result.status = call.status;
        result.error = call.error;
        if (call.status >= 200 && call.status < 300) {
          result.ok = true;
          if (call.body && typeof call.body === "object") {
            store.set(id, call.body as Record<string, unknown>);
          }
        }
      }
      // No progress this pass ⇒ further passes won't help; stop early.
      const progressed = order.some((id) => results.get(id)!.ok);
      const stillPending = order.some((id) => !results.get(id)!.ok);
      if (stillPending && !progressed) break;
      // If a pass made zero *new* progress, also stop (prevents spinning on persistent failures).
      const newlyPending = order.filter((id) => !results.get(id)!.ok);
      if (newlyPending.length === pending.length && pending.every((id) => !results.get(id)!.ok)) break;
    }
  } finally {
    await dispose();
  }

  const all = [...results.values()];
  return {
    passed: all.filter((r) => r.ok),
    failed: all.filter((r) => !r.ok),
    iterations,
    order,
    cycles,
  };
}
