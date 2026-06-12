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
import {
  endpointsFromDoc,
  type SpecEndpoint,
} from "@foundation/domain/business/endpoint-spec/mod.ts";
import { processOrder } from "@foundation/domain/business/process-graph/mod.ts";
import {
  createLimiter,
  type RateLimitOptions,
} from "@foundation/domain/business/rate-limiter/mod.ts";
import { signToken } from "@foundation/domain/business/token/mod.ts";

/** The relevant slice of a `bootstrapServer(...)` return. */
export interface ExerciseTarget {
  backend: Pick<BackendClient, "fetch">;
  docs: SwaggerDocEntry[];
}

export type ExerciseAuth =
  | { kind: "in-process" }
  | { kind: "token"; token: string }
  | {
    kind: "mint";
    signingKey: string;
    source: string;
    appName: string;
    roles?: string[];
  };

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
  /**
   * Exercise one named branch: endpoints tagged with other flows are excluded; untagged
   * endpoints (part of every flow) stay. Unset ⇒ every endpoint.
   */
  flow?: string;
  /**
   * Build the run order, cycles, and unresolved $inputs without sending a single request — a
   * cheap graph pre-flight. The report's passed/failed/optionalFailed are empty, iterations 0.
   */
  dryRun?: boolean;
}

export interface EndpointResult {
  /** Bare operationId. Not unique across composed modules — pair with `module` to disambiguate. */
  id: string;
  /** The owning module (the docs path without its leading slash). */
  module: string;
  method: string;
  path: string;
  ok: boolean;
  optional: boolean;
  status?: number;
  attempts: number;
  error?: string;
}

export interface ExerciseReport {
  passed: EndpointResult[];
  /** Required endpoints that didn't go green — empty means the process works. */
  failed: EndpointResult[];
  /** `optional: true` endpoints that didn't pass — reported, but not a failure. */
  optionalFailed: EndpointResult[];
  iterations: number;
  order: string[];
  cycles: string[][];
  /** External `$inputs` with no seed and no composed producer — nothing will satisfy them. */
  unresolvedInputs: string[];
}

interface CallResult {
  status: number;
  body: unknown;
  error?: string;
}

type Transport = (
  method: string,
  path: string,
  body: unknown,
) => Promise<CallResult>;

/**
 * A flattened endpoint carrying its module-namespaced working id (`id`, unique across the
 * composed app) alongside the bare operationId (`bareId`, used in the report and for `byEndpoint`
 * overrides). `dependsOn`/`bind` references are rewritten to working ids.
 */
type RunEndpoint = SpecEndpoint & { bareId: string; module: string };

/** Assemble an endpoint's request values from seeds → bind (captured outputs) → per-endpoint overrides. */
function buildValues(
  ep: RunEndpoint,
  store: Map<string, Record<string, unknown>>,
  overrides: SeedOverrides,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of ep.inputFields) {
    if (overrides.seeds && field in overrides.seeds) {
      values[field] = overrides.seeds[field];
    }
  }
  for (const [field, ref] of Object.entries(ep.bind)) {
    // An array declares alternatives (the join after a branch) — first resolvable wins.
    const candidates = Array.isArray(ref) ? ref : [ref];
    for (const candidate of candidates) {
      if (candidate.startsWith("$")) {
        // External input: `"$name"` declares a value produced outside this module (another
        // service, a human). The runner's variable scope is `overrides.seeds` — it always
        // wins. When no seed exists, composition fulfills the contract: the first captured
        // response (insertion = run order) owning a same-named field provides the value.
        const name = candidate.slice(1);
        if (overrides.seeds && name in overrides.seeds) {
          values[field] = overrides.seeds[name];
          break;
        }
        let captured = false;
        for (const src of store.values()) {
          if (name in src) {
            values[field] = src[name];
            captured = true;
            break;
          }
        }
        if (captured) break;
        continue;
      }
      const [depId, outField] = candidate.split(".");
      const src = store.get(depId);
      if (src && outField in src) {
        values[field] = src[outField];
        break;
      }
    }
  }
  Object.assign(values, overrides.byEndpoint?.[ep.bareId] ?? {});
  // Coerce assembled values to their declared schema type (mirrors the cake client): a clean
  // string form for an integer/number/boolean/object field is converted, so a headless caller can
  // pass `{ fid: "3" }` via seeds/byEndpoint and it still validates as a number. Captured values
  // are already native (non-strings), so only seed/input strings are touched.
  for (const f of ep.inputSchema) {
    const v = values[f.name];
    if (typeof v !== "string") continue;
    if (f.type === "integer" || f.type === "number") {
      if (v.trim() !== "" && !isNaN(Number(v))) values[f.name] = Number(v);
    } else if (f.type === "boolean") {
      if (v === "true") values[f.name] = true;
      else if (v === "false") values[f.name] = false;
    } else if (f.type === "object" || f.type === "array") {
      try {
        values[f.name] = JSON.parse(v);
      } catch {
        /* not clean JSON — leave for the server's validation to name */
      }
    }
  }
  return values;
}

/** Substitute `{name}` path params from the assembled values. */
function resolvePath(path: string, values: Record<string, unknown>): string {
  return path.replace(
    /\{([^}]+)\}/g,
    (_m, name) =>
      name in values ? encodeURIComponent(String(values[name])) : `{${name}}`,
  );
}

async function buildTransport(
  opts: ExerciseOptions,
): Promise<{ transport: Transport; dispose: () => Promise<void> }> {
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
    // The specifier is a variable so bundlers can't follow it into playwright-core (whose
    // internal requires rollup can't resolve, which broke `vite build` for every consumer).
    // It only executes for baseUrl runs, which never happen inside a bundled Fresh app; the
    // cast keeps full typing and erases at emit.
    const playwrightSpecifier = "#playwright";
    const { request } = await import(
      /* @vite-ignore */ playwrightSpecifier
    ) as typeof import("#playwright");
    const ctx = await request.newContext({
      baseURL: opts.baseUrl,
      extraHTTPHeaders: headers,
    });
    const transport: Transport = async (method, path, body) => {
      try {
        const res = await ctx.fetch(path, {
          method,
          data: method === "GET" ? undefined : (body ?? {}),
          headers: method === "GET"
            ? undefined
            : { "content-type": "application/json" },
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
        return {
          status: 0,
          body: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };
    return { transport, dispose: () => ctx.dispose() };
  }

  const transport: Transport = async (method, path, body) => {
    try {
      const init: RequestInit = { method, headers: { ...headers } };
      if (method !== "GET") {
        (init.headers as Record<string, string>)["content-type"] =
          "application/json";
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
      return {
        status: 0,
        body: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
  return { transport, dispose: () => Promise.resolve() };
}

/** Discover, order, and exercise every endpoint, chaining outputs into inputs until green. */
export async function exerciseEndpoints(
  opts: ExerciseOptions,
): Promise<ExerciseReport> {
  const overrides = opts.overrides ?? {};
  const maxIterations = opts.maxIterations ?? 5;
  const limiter = createLimiter(opts.rateLimit);

  // Flatten endpoints across all module docs. Two composed modules can expose the same
  // operationId (e.g. both have `create`); the working `id` is namespaced `<module>:<op>` so
  // results, captures, ordering, and `byId` never collide. The bare operationId is kept for the
  // report and `byEndpoint` overrides. `module` is the docs path without its leading slash —
  // matching the contract-index keys the emulator pages use (`<module>:<endpointId>`).
  let endpoints: RunEndpoint[] = opts.api.docs.flatMap((d) => {
    const module = d.path.replace(/^\//, "");
    return endpointsFromDoc(d.doc).map((ep) => ({
      ...ep,
      bareId: ep.id,
      module,
      id: `${module}:${ep.id}`,
    }));
  });
  if (opts.flow) {
    const flow = opts.flow;
    endpoints = endpoints.filter((ep) =>
      ep.flows.length === 0 || ep.flows.includes(flow)
    );
  }
  // Resolve a `dependsOn`/`bind` reference (written with bare operationIds) to a working id:
  // a same-module endpoint wins; otherwise the single cross-module endpoint with that
  // operationId (preserving the "reference another module's endpoint by bare id" convenience).
  // Ambiguous or unknown ids are left bare — processOrder ignores ids it can't resolve.
  const keyForRef = (module: string, bareRef: string): string => {
    const local = `${module}:${bareRef}`;
    if (endpoints.some((e) => e.id === local)) return local;
    const matches = endpoints.filter((e) => e.bareId === bareRef);
    return matches.length === 1 ? matches[0].id : bareRef;
  };
  for (const ep of endpoints) {
    // Replace (never mutate in place): these arrays/objects alias the doc's x-keep-process
    // metadata, so a push would poison every later bootstrap in the same process.
    ep.dependsOn = ep.dependsOn.map((dep) =>
      Array.isArray(dep)
        ? dep.map((d) => keyForRef(ep.module, d))
        : keyForRef(ep.module, dep)
    );
    const rewriteRef = (r: string): string => {
      if (r.startsWith("$")) return r; // external input — resolved by field name, not id
      const dot = r.indexOf(".");
      return dot < 0
        ? keyForRef(ep.module, r)
        : keyForRef(ep.module, r.slice(0, dot)) + r.slice(dot);
    };
    ep.bind = Object.fromEntries(
      Object.entries(ep.bind).map((
        [field, ref],
      ) => [field, Array.isArray(ref) ? ref.map(rewriteRef) : rewriteRef(ref)]),
    );
  }
  // Synthetic contract edges: a "$name" bind whose name some endpoint in the composed app
  // produces (same-named output field) must run AFTER that producer, so its capture exists
  // when the consumer's request is built — the fallback then hits in pass one. The endpoint
  // objects are fresh per call (endpointsFromDoc builds them above), but their `dependsOn`
  // ARRAYS alias the doc's `x-keep-process` metadata (which in turn is the decorator's) — so
  // never push into them; replace the property with a copy. Mutating would poison every later
  // bootstrap in the same process with a cross-module edge its emulator page can never satisfy.
  // All producers of each output field, in encounter (run) order — not just the first. The
  // first-wins pass was cycle-blind: an endpoint that merely *echoes* a field (outputs what it
  // also consumes) could be chosen as the producer and create a run→get / get→run cycle.
  const producersByField = new Map<string, string[]>();
  for (const ep of endpoints) {
    for (const field of ep.outputFields) {
      const list = producersByField.get(field) ?? [];
      if (!list.includes(ep.id)) list.push(ep.id);
      producersByField.set(field, list);
    }
  }
  const byId = new Map(endpoints.map((e) => [e.id, e]));
  // A synthetic edge `consumer ← producer` closes a cycle iff the producer already
  // (transitively) depends on the consumer — ordering the producer first would then be
  // impossible. Walk the current dependsOn graph (including edges added earlier in this loop)
  // to detect that before committing the edge.
  const producerDependsOnConsumer = (
    producer: string,
    consumer: string,
  ): boolean => {
    const seen = new Set<string>();
    const stack = [producer];
    while (stack.length) {
      const cur = stack.pop()!;
      if (cur === consumer) return true;
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const dep of (byId.get(cur)?.dependsOn ?? []).flat()) stack.push(dep);
    }
    return false;
  };
  for (const ep of endpoints) {
    for (const ref of Object.values(ep.bind)) {
      for (const candidate of Array.isArray(ref) ? ref : [ref]) {
        if (!candidate.startsWith("$")) continue;
        // Prefer a producer that isn't the consumer itself and isn't already downstream of it
        // (which would make the synthetic edge close a cycle). With none, fall back to whatever
        // capture exists at run time; processOrder keeps a clean topological order either way.
        const producers = (producersByField.get(candidate.slice(1)) ?? [])
          .filter((p) => p !== ep.id && !producerDependsOnConsumer(p, ep.id));
        if (producers.length === 0) continue;
        if (producers.some((p) => ep.dependsOn.flat().includes(p))) continue;
        ep.dependsOn = [...ep.dependsOn, producers[0]];
      }
    }
  }
  const { order, cycles } = processOrder(endpoints);
  // Report bare operationIds (working ids are module-namespaced); each result's `module`
  // disambiguates same-named handlers across composed modules.
  const bare = (key: string) => byId.get(key)?.bareId ?? key;
  // External $inputs nothing will satisfy (no seed, no composed producer) — the static signal a
  // dry run surfaces (e.g. an unset $fid) before any request fires.
  const unresolvedInputs = (() => {
    const seeds = overrides.seeds ?? {};
    const unmet = new Set<string>();
    for (const ep of endpoints) {
      for (const ref of Object.values(ep.bind)) {
        for (const candidate of Array.isArray(ref) ? ref : [ref]) {
          if (!candidate.startsWith("$")) continue;
          const name = candidate.slice(1);
          if (name in seeds || producersByField.has(name)) continue;
          unmet.add("$" + name);
        }
      }
    }
    return [...unmet].sort();
  })();
  if (opts.dryRun) {
    return {
      passed: [],
      failed: [],
      optionalFailed: [],
      iterations: 0,
      order: order.map(bare),
      cycles: cycles.map((c) => c.map(bare)),
      unresolvedInputs,
    };
  }

  const { transport, dispose } = await buildTransport(opts);
  const store = new Map<string, Record<string, unknown>>();
  const results = new Map<string, EndpointResult>();
  for (const ep of endpoints) {
    results.set(ep.id, {
      id: ep.bareId,
      module: ep.module,
      method: ep.method,
      path: ep.path,
      ok: false,
      optional: ep.optional,
      attempts: 0,
    });
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
        const call = await limiter.run(() =>
          transport(ep.method, path, values)
        );
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
      if (
        newlyPending.length === pending.length &&
        pending.every((id) => !results.get(id)!.ok)
      ) break;
    }
  } finally {
    await dispose();
  }

  const all = [...results.values()];
  return {
    passed: all.filter((r) => r.ok),
    failed: all.filter((r) => !r.ok && !r.optional),
    optionalFailed: all.filter((r) => !r.ok && r.optional),
    iterations,
    order: order.map(bare),
    cycles: cycles.map((c) => c.map(bare)),
    unresolvedInputs,
  };
}
