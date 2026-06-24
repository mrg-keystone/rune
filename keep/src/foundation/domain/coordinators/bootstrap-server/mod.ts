import type { FetchHandler, SwaggerDocEntry, Type } from "@types";
import { Server } from "@foundation/domain/business/server/mod.ts";
import { DanetHttpAdapter } from "@foundation/domain/data/http-adapter/mod.ts";
import { createBackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import type { BackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import { log } from "@foundation/domain/business/logger/mod.ts";
import { tracer } from "@foundation/domain/business/tracer/mod.ts";
import { createKvTraceSink } from "@foundation/domain/business/tracer/kv-store.ts";
import { traceShipper } from "@foundation/domain/business/tracer/ship.ts";
import { DatadogTransport } from "@foundation/domain/data/datadog/mod.ts";
import { PostmarkAlerter } from "@foundation/domain/data/postmark/mod.ts";
import { createRequestLoggingMiddleware } from "@foundation/domain/business/request-logger/mod.ts";
import { GLOBAL_GUARD, type HttpContext } from "#danet/core";
import { createCredentialGuard } from "@foundation/domain/business/token-auth/mod.ts";
import { isLocalRequest } from "@foundation/domain/business/localhost/mod.ts";
import {
  createInfraClient,
  type InfraClient,
} from "@foundation/domain/business/infra-client/mod.ts";
import { createJwksVerifier } from "@foundation/domain/business/token/mod.ts";
import {
  extractBearer,
  isOpaqueToken,
  resolveNetworkCredential,
} from "@foundation/domain/business/token-auth/mod.ts";
import type { Context } from "#hono";
import {
  exerciseEndpoints,
  type ExerciseOptions,
} from "@foundation/domain/coordinators/exercise-harness/mod.ts";
import {
  callHealer,
  healConfigured,
} from "@foundation/domain/business/heal/mod.ts";
import { appModule } from "@foundation/domain/business/endpoint-decorator/mod.ts";
import {
  createDocsJsonHandler,
  injectDocsScript,
  swaggerShellHtml,
} from "@foundation/domain/business/docs-ui/mod.ts";
// Static imports (no dynamic chunks): a lazily-imported chunk that shares modules with a
// top-level-awaiting entry deadlocks under rollup-bundled output ("Top-level await promise
// never resolved" in `deno serve _fresh/server.js`). The chain is bundler-clean since
// handlebars was replaced with template literals, so eager loading is safe everywhere.
import { SwaggerBuilder } from "@foundation/domain/business/swagger-builder/mod.ts";
import { emulatorShellHtml } from "@foundation/domain/business/emulator-ui/mod.ts";
import { mapShellHtml } from "@foundation/domain/business/map-ui/mod.ts";
import { traceShellHtml } from "@foundation/domain/business/trace-ui/mod.ts";
import { endpointsFromDoc } from "@foundation/domain/business/endpoint-spec/mod.ts";
import {
  type FixturesPatch,
  mergeFixtures,
  normalizeScenario,
  readFixtures,
  readHealRules,
  readScenarios,
  scenarioSlug,
  writeFixtures,
  writeScenario,
} from "@foundation/domain/business/fixtures-store/mod.ts";

interface BootstrapOptions {
  port?: number;
  swagger?: boolean | { filters: string[] };
}

// infra is the minting + signing authority; keep is a verifier + exchange broker. One env var points
// keep at infra — it serves grants, the JWKS to verify session bearers, opaque-token exchange, and
// the revocation poll. Read from the environment so it never lives in the (public) package source.
const INFRA_URL_ENV = "INFRA_URL"; // exchange + revocation poll + JWKS (the single infra endpoint)
const INFRA_JWKS_URL_ENV = "INFRA_JWKS_URL"; // optional explicit JWKS URL (else derived from INFRA_URL)
const HONOR_SKELETON_ENV = "HONOR_SKELETON"; // default true; set false for the infra service itself

// Defaults for the revocation poll cadence and how long a fetched JWKS is trusted before refetch.
const DEFAULT_REVOCATION_POLL_MS = 60_000;
const DEFAULT_JWKS_TTL_SECONDS = 600;
// Upper bound on how long boot waits for the first revocation poll before proceeding — a hung
// infra endpoint (getJson sets no fetch timeout) must never block startup indefinitely.
const BOOT_REVOCATION_POLL_TIMEOUT_MS = 3_000;

// Datadog region is fixed; alert routing is read from the environment so internal email
// addresses stay out of the (public) package source.
const DATADOG_SITE = "us5.datadoghq.com";

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

/** Reads an env flag as a boolean — "1"/"true"/"yes"/"on" (case-insensitive) are true. */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

// Dev-mode boot identity (`rune dev`): minted once per process so the emulator pages' reload
// poller can tell "the same app answered" from "a NEW process is serving" after a restart.
const bootId = crypto.randomUUID();

// danet's global exception-filter container is process-wide and append-only;
// guard so repeated bootstrapServer() calls (test suites, in-process reboots)
// register the stateless RuneAssertError→422 filter exactly once.
let runeAssertFilterRegistered = false;

/**
 * Builds the logging transports from the environment:
 * - `DD_API_KEY` → Datadog (site fixed to DATADOG_SITE). Missing ⇒ warn, console only.
 * - `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM` (+ optional `POSTMARK_TO`, defaults to `FROM`)
 *   → failure-alert emails. Missing ⇒ warn, console fallback.
 */
function configureLoggingFromEnv(appName: string) {
  // Whether to SHIP to Datadog is separate from whether we HAVE a key. The key can live in the
  // env everywhere (so a deploy "just works"); shipping is gated on environment:
  //   • On Deno Deploy (DENO_DEPLOY === "1") → ship automatically, tagged env:production.
  //   • Locally → DON'T ship by default (console only), even with the key present, so dev traffic
  //     never pollutes production logs. Opt in with KEEP_DD_LOCAL=1 to ship, tagged env:local
  //     (and prefixed [LOCAL]) so it stays segmented from production.
  const ddKey = Deno.env.get("DD_API_KEY");
  const isDeployed = Deno.env.get("DENO_DEPLOY") === "1";
  const shipLocal = isTruthy(Deno.env.get("KEEP_DD_LOCAL"));
  const env = isDeployed ? "production" : "local";
  const shouldShip = Boolean(ddKey) && (isDeployed || shipLocal);
  const datadog = ddKey && shouldShip
    ? new DatadogTransport({
      apiKey: ddKey,
      service: appName,
      site: DATADOG_SITE,
      env,
    })
    : undefined;
  if (!ddKey) {
    warnOnce(
      `[${appName}] DD_API_KEY not set — Datadog disabled; logging to console only.`,
    );
  } else if (!shouldShip) {
    warnOnce(
      `[${appName}] DD_API_KEY present but not shipping from local — set KEEP_DD_LOCAL=1 to ship (tagged env:local). Logging to console only.`,
    );
  }

  const pmToken = Deno.env.get("POSTMARK_SERVER_TOKEN");
  const pmFrom = Deno.env.get("POSTMARK_FROM");
  const alerter = pmToken && pmFrom
    ? new PostmarkAlerter({
      serverToken: pmToken,
      from: pmFrom,
      to: Deno.env.get("POSTMARK_TO") ?? undefined,
    })
    : undefined;
  if (!alerter) {
    warnOnce(
      `[${appName}] POSTMARK_SERVER_TOKEN/POSTMARK_FROM not set — logger failure email alerts disabled (console fallback still applies).`,
    );
  }

  log.configure({ appName, datadog, alerter });

  // Request tracing feeds the `/docs/_trace` waterfall. On by default (cheap, bounded);
  // KEEP_TRACE=off disables capture, KEEP_TRACE_BUFFER=<n> sizes the ring buffer.
  const traceEnabled =
    (Deno.env.get("KEEP_TRACE") ?? "on").toLowerCase() !== "off";
  const traceCapacity = Number(Deno.env.get("KEEP_TRACE_BUFFER"));
  tracer.configure({
    appName,
    enabled: traceEnabled,
    capacity: Number.isFinite(traceCapacity) && traceCapacity > 0
      ? traceCapacity
      : undefined,
  });
}

export class BootstrapServer {
  private adapter: DanetHttpAdapter;
  private module: Type;
  readonly backend: BackendClient;
  /** The per-module OpenAPI docs (with `x-keep-process`) built at boot; empty when swagger is off. */
  readonly docs: SwaggerDocEntry[];

  /** Cleared on stop() so the revocation poll timer never outlives the server. */
  private revocationPoller?: number;

  private constructor(
    module: Type,
    adapter: DanetHttpAdapter,
    backend: BackendClient,
    docs: SwaggerDocEntry[],
    revocationPoller?: number,
  ) {
    this.module = module;
    this.adapter = adapter;
    this.backend = backend;
    this.docs = docs;
    this.revocationPoller = revocationPoller;
  }

  static async create(
    appName: string,
    module: Type | Type[],
    options?: BootstrapOptions,
  ) {
    // An array composes into one root module (one entry per rune) — see appModule(). Each
    // child keeps its own Swagger doc; the wrapper itself is skipped by the docs builder.
    const rootModule = Array.isArray(module)
      ? appModule(appName, module)
      : module;
    const { port = 3000, swagger = true } = options ?? {};

    // Configure the process-wide logger from env before anything can emit.
    // ASSUMPTION: one BootstrapServer per process. The logger, tracer, trace
    // shipper, RuneAssertError filter, and bootId are process-global singletons,
    // so calling create() a second time in the same process with a different
    // appName/config last-wins and overwrites the first — fine for tests that run
    // servers sequentially, but do not run two apps concurrently in one process.
    configureLoggingFromEnv(appName);

    // Opt-in durable traces: KEEP_TRACE_KV ("1"/"true" → default KV location, or a path) stores
    // traces in Deno KV (time-ordered + per-user indexed) so `/docs/_trace` survives restarts and
    // looks past the in-memory window. KEEP_TRACE_TTL_DAYS bounds retention (default 7). If KV
    // won't open (no --unstable-kv), it logs once and the in-memory ring stays in use.
    const kvEnv = Deno.env.get("KEEP_TRACE_KV");
    if (kvEnv && kvEnv.toLowerCase() !== "false" && tracer.enabled) {
      const lower = kvEnv.toLowerCase();
      const path = lower === "1" || lower === "true" ? undefined : kvEnv;
      const ttlDays = Number(Deno.env.get("KEEP_TRACE_TTL_DAYS"));
      const sink = await createKvTraceSink(
        path,
        Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : undefined,
      );
      if (sink) tracer.useSink(sink, true);
    }

    // Ship finished traces to an OTLP HTTP endpoint (a Datadog Agent / OTel Collector) so they
    // render as APM flame graphs. Pure fire-and-forget: at request end the finished in-memory
    // trace is serialized to OTLP/JSON, POSTed, and the promise is awaited in the same settle()
    // flush as the logs — no SDK, no context manager. Gated like the logs: ship from Deno Deploy
    // automatically, from local only with KEEP_DD_LOCAL=1. KEEP_TRACE_OTLP_URL is the Agent's
    // OTLP base (e.g. http://your-vps:4318); env tags it production vs local.
    const otlpUrl = Deno.env.get("KEEP_TRACE_OTLP_URL");
    const isDeployed = Deno.env.get("DENO_DEPLOY") === "1";
    const shipLocal = isTruthy(Deno.env.get("KEEP_DD_LOCAL"));
    // Optional shared secret for a reverse-proxy guard (sent as the X-Keep-Token header) so the
    // OTLP endpoint can be exposed publicly without accepting anonymous spans.
    const otlpToken = Deno.env.get("KEEP_TRACE_OTLP_TOKEN");
    traceShipper.configure({
      endpoint: otlpUrl,
      service: appName,
      env: isDeployed ? "production" : "local",
      enabled: Boolean(otlpUrl) && tracer.enabled && (isDeployed || shipLocal),
      headers: otlpToken ? { "X-Keep-Token": otlpToken } : undefined,
    });

    // infra connection: the exchange broker + JWKS verifier + revocation poller. Without an
    // INFRA_URL, keep cannot exchange opaque tokens or verify session bearers — only trusted origins
    // (in-process / localhost) authorize, and every network call fails closed.
    const infraBaseUrl = Deno.env.get(INFRA_URL_ENV) ?? "";
    const infraClient: InfraClient | undefined = infraBaseUrl
      ? createInfraClient({
        baseUrl: infraBaseUrl,
        jwksUrl: Deno.env.get(INFRA_JWKS_URL_ENV) || undefined,
      })
      : undefined;
    if (!infraClient) {
      warnOnce(
        `[${appName}] ${INFRA_URL_ENV} not set — opaque-token exchange and session-bearer verification are disabled (only trusted origins authorize).`,
      );
    }
    // Offline session-bearer verifier, backed by infra's JWKS (cached, kid-selected, alg-from-key).
    const jwksTtl = Number(Deno.env.get("INFRA_JWKS_TTL_SECONDS"));
    const verifier = infraClient
      ? createJwksVerifier({
        fetchJwks: () => infraClient.jwks(),
        cacheTtlSeconds: Number.isFinite(jwksTtl) && jwksTtl > 0
          ? jwksTtl
          : DEFAULT_JWKS_TTL_SECONDS,
      })
      : undefined;

    // The `*` skeleton key bypasses required claims — UNLESS disabled. The infra control plane sets
    // HONOR_SKELETON=false so `*` never opens it; apps default to honoring it.
    const honorSkeleton =
      (Deno.env.get(HONOR_SKELETON_ENV) ?? "true").toLowerCase() !== "false";

    // The polled global revoke-all flag (break glass). A poller updates `.value` ~every 60s; the
    // guard reads it live. ON ⇒ keep stops trusting cached session bearers and re-exchanges/validates
    // every auth against infra.
    const revokeAllState = { value: false };
    const pollMs = Number(Deno.env.get("INFRA_POLL_INTERVAL_MS"));
    const revocationPollMs = Number.isFinite(pollMs) && pollMs > 0
      ? pollMs
      : DEFAULT_REVOCATION_POLL_MS;
    let revocationPoller: number | undefined;
    if (infraClient) {
      const pollOnce = async () => {
        try {
          const status = await infraClient.revocationStatus();
          revokeAllState.value = status.revokeAll;
        } catch (err) {
          warnOnce(
            `[${appName}] revocation poll failed: ${
              err instanceof Error ? err.message : String(err)
            } (keeping last known revokeAll=${revokeAllState.value}).`,
          );
        }
      };
      // Kick once at boot AND wait for it, so the revokeAll flag is genuinely fresh before the
      // first request can reach the guard. `pollOnce` swallows its own errors (a failed poll just
      // logs and keeps the last-known flag), so the only hazard is a hung infra endpoint —
      // `getJson` sets no fetch timeout — which would otherwise block boot indefinitely. Cap the
      // wait: if the first poll hasn't settled within the boot budget, proceed anyway (the
      // interval poller below will pick up the real value shortly) rather than stall startup.
      const bootTimer = { id: undefined as number | undefined };
      await Promise.race([
        pollOnce(),
        new Promise<void>((resolve) => {
          // Deno's setTimeout returns a numeric id; cast guards against Node's
          // `Timeout` typings leaking in under some toolchains (JSR publish check).
          bootTimer.id = setTimeout(resolve, BOOT_REVOCATION_POLL_TIMEOUT_MS) as unknown as number;
        }),
      ]).finally(() => {
        if (bootTimer.id !== undefined) clearTimeout(bootTimer.id);
      });
      revocationPoller = setInterval(pollOnce, revocationPollMs) as unknown as number;
      // Don't keep the process (or test runner) alive on the poll timer alone.
      try {
        Deno.unrefTimer(revocationPoller);
      } catch {
        // older runtimes may lack unrefTimer — harmless
      }
    }

    // Network callers authorize with an infra-signed session bearer (verified offline via infra's
    // JWKS) or an opaque token exchanged at infra — both reached through INFRA_URL. There is no
    // direct Firebase path here: users sign in at infra (which mints the bearer); keep only verifies.

    // Process-private key that identifies in-process (BackendClient) requests. Minted per boot,
    // shared only between the in-process client and the auth middleware; never leaves the process.
    const internalKey = crypto.randomUUID();

    // Localhost callers are trusted (no token) by default. Set TRUST_LOCALHOST=false to require
    // a token even from localhost — e.g. behind a same-host reverse proxy, or to test the gate.
    const trustLocalhost =
      (Deno.env.get("TRUST_LOCALHOST") ?? "true").toLowerCase() !== "false";

    const server = Server.create();
    server.registerModule(rootModule);

    const adapter = new DanetHttpAdapter(port);
    // Register the logging middleware first so it wraps every route (controllers + swagger).
    adapter.app.use(createRequestLoggingMiddleware(log));
    // Credential auth is enforced as a Danet GLOBAL guard (registered after init below) rather
    // than a Hono middleware, so it can honor the per-route `@Public()` decorator. Controllers
    // are deny-by-default; the framework's own direct routes (`/_token`, `/docs`, docs `/json`)
    // aren't controllers, so they self-gate (docs json token check).
    type RouteHandler = (...args: unknown[]) => unknown;

    // OAuth-style exchange: a client POSTs its opaque manual token (`mtk_…`) and gets back the
    // signed ~1h session bearer to cache and re-send as `Authorization: Bearer`, re-exchanging when
    // it lapses. Cleaner than smuggling the bearer back in a response header on every request.
    adapter.registerRoute(
      "post",
      "/_token",
      (async (c: Context) => {
        if (!infraClient) {
          return c.json({
            error: "Token exchange unavailable — INFRA_URL is not set.",
          }, 503);
        }
        let body: Record<string, unknown> = {};
        try {
          body = (await c.req.json()) as Record<string, unknown>;
        } catch {
          body = {};
        }
        // Accept the opaque token in the body, the Authorization header, or `?token=`.
        const token = (typeof body.token === "string" && body.token) ||
          extractBearer(c.req.header("authorization")) ||
          c.req.query("token") ||
          "";
        if (!token) {
          return c.json({ error: "Missing `token`." }, 400);
        }
        if (!isOpaqueToken(token)) {
          return c.json({
            error: "Expected an opaque manual token (mtk_…) to exchange.",
          }, 400);
        }
        const outcome = await resolveNetworkCredential(token, {
          verifier,
          infraClient,
          revokeAll: revokeAllState.value,
        });
        if ("error" in outcome) {
          return c.json({
            error: "unauthorized",
            message: "Token exchange failed (revoked, unknown, or expired).",
          }, 401);
        }
        log.setSource(outcome.resolved.source);
        // The bearer itself carries `sessionExp`; the client decodes it to know when to re-exchange.
        return c.json({
          bearer: outcome.freshBearer,
          source: outcome.resolved.source,
        });
      }) as RouteHandler,
    );

    // Dev mode (`rune dev` sets KEEP_DEV to a status-file path): serve `/docs/_dev` so the
    // emulator pages can poll for restarts (bootId change) and spec-check errors, and inject
    // the reload poller into every emulator page.
    const devStatusPath = Deno.env.get("KEEP_DEV");

    let docs: SwaggerDocEntry[] = [];
    // Late-bound: the backend client exists only after init; /docs/_run answers
    // 503 in the boot window instead of capturing a dead reference.
    let runTarget: { backend: BackendClient; docs: SwaggerDocEntry[] } | null =
      null;
    if (swagger) {
      const filters = typeof swagger === "object" ? swagger.filters : [];
      const builder = new SwaggerBuilder(...filters);
      const { swaggerDocs, docsIndexHtml } = await builder.build(server);
      docs = swaggerDocs as unknown as SwaggerDocEntry[];

      const html = (body: string) =>
        new Response(body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });

      if (devStatusPath) {
        adapter.registerRoute("get", "/docs/_dev", async () => {
          // The status file is written by the watcher between polls — a missing file, a
          // partial write or junk content must never break the channel: degrade to bootId only.
          let status: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(await Deno.readTextFile(devStatusPath));
            if (
              parsed !== null && typeof parsed === "object" &&
              !Array.isArray(parsed)
            ) {
              status = parsed;
            }
          } catch {
            status = {};
          }
          return new Response(JSON.stringify({ ...status, bootId }), {
            headers: { "content-type": "application/json" },
          });
        });
      }

      // Contract auto-wiring index across the composed app: output field name →
      // "<module>:<endpointId>" of the endpoint producing it (first producer wins; stub
      // endpoints are producers too). Each emulator page receives the slice covering its own
      // declared $inputs, so an unset input can auto-resolve from a producer's shared capture.
      const moduleEntries = docs.map(({ path, doc }) => ({
        path,
        doc,
        moduleName: path.replace(/^\//, ""),
        endpoints: endpointsFromDoc(doc),
      }));
      const producersByField = new Map<string, string>();
      for (const { moduleName, endpoints } of moduleEntries) {
        for (const ep of endpoints) {
          for (const field of ep.outputFields) {
            // An echo (consumes the field it outputs) can never bootstrap a value — not a
            // producer for contract purposes.
            if (ep.inputFields.includes(field) || field in ep.bind) continue;
            if (!producersByField.has(field)) {
              producersByField.set(field, `${moduleName}:${ep.id}`);
            }
          }
        }
      }
      // `$name` is satisfiable by an exact `name` output, or by a `name + "s"` collection whose
      // first element supplies the value (the plural half of the composition contract).
      const producerForInput = (name: string): string | undefined =>
        producersByField.get(name) ?? producersByField.get(`${name}s`);
      // App-wide endpoint index for the cake's Module-setup picker: setup can call ANY composed
      // module's endpoint to put the whole app in a known state, so every page gets the slim
      // request-building slice (schema, binds, params) of every endpoint in the app.
      const appEndpoints = moduleEntries.flatMap(({ moduleName, endpoints }) =>
        endpoints.map((ep) => ({
          module: moduleName,
          id: ep.id,
          method: ep.method,
          path: ep.path,
          description: ep.description ?? "",
          bind: ep.bind,
          inputSchema: ep.inputSchema,
          params: ep.params,
        }))
      );

      for (const { path, doc, moduleName, endpoints } of moduleEntries) {
        const title = `API · ${moduleName}`;
        // This module's $inputs that some composed endpoint (any module, including this one)
        // genuinely produces — exact field or its plural collection; echoes never count. The
        // consumer itself can't be its own producer. Names with no producer stay explicit-only.
        const producers: Record<string, string> = {};
        for (const ep of endpoints) {
          for (const ref of Object.values(ep.bind)) {
            for (const candidate of Array.isArray(ref) ? ref : [ref]) {
              if (!candidate.startsWith("$")) continue;
              const name = candidate.slice(1);
              const producer = producerForInput(name);
              if (!producer || producer === `${moduleName}:${ep.id}`) continue;
              producers[name] = producer;
            }
          }
        }
        // Default page: the process emulator (ordered, chainable, click-through). Public shell;
        // the inlined spec renders it, and live endpoint calls carry the stored token.
        adapter.registerRoute(
          "get",
          `/docs${path}`,
          () =>
            html(
              injectDocsScript(emulatorShellHtml(moduleName, doc, {
                producers,
                appEndpoints,
                dev: Boolean(devStatusPath),
              })),
            ),
        );
        // Standard Swagger UI for deeper inspection, moved under /swagger.
        adapter.registerRoute(
          "get",
          `/docs${path}/swagger`,
          () => html(swaggerShellHtml(title)),
        );
        // Gated spec: trusted origins (localhost / in-process) need no token; network callers
        // must present a valid signed/Firebase token (Authorization header or ?token).
        adapter.registerRoute(
          "get",
          `/docs${path}/json`,
          createDocsJsonHandler({
            specJson: JSON.stringify(doc),
            verifier,
            infraClient,
            logger: log,
            trustLocalhost,
          }) as RouteHandler,
        );
      }
      // The whole-app system map: every module's endpoints as one process graph, with live
      // run state read from the emulator sessions. Underscore-prefixed so a module named
      // "map" can still own /docs/map.
      adapter.registerRoute(
        "get",
        "/docs/_map",
        () =>
          html(
            injectDocsScript(
              mapShellHtml(appName, docs, { dev: Boolean(devStatusPath) }),
            ),
          ),
      );
      // The request-trace waterfall: every recent real request as a bar, each user function timed
      // as a segment, with a ✕ where a request crashed. The page (public shell) polls the data
      // route below; the data — route paths, error messages, captured timing — is localhost-only.
      adapter.registerRoute(
        "get",
        "/docs/_trace",
        () =>
          html(
            injectDocsScript(
              traceShellHtml(appName, { dev: Boolean(devStatusPath) }),
            ),
          ),
      );
      // Trace data + control. GET returns the newest-first ring buffer; POST {clear:true} empties
      // it. Localhost-only (same posture as /_run, /_heal) since traces can carry request detail.
      adapter.registerRoute(
        "get",
        "/docs/_traces",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_traces is available on localhost only.",
              },
              403,
            );
          }
          // `?user=` scopes to one user server-side (a fast indexed scan under KV); `?limit=`
          // caps the page (default 200, hard ceiling 1000).
          const user = c.req.query("user") || undefined;
          const limitQ = Number(c.req.query("limit"));
          const limit = Number.isFinite(limitQ) && limitQ > 0
            ? Math.min(limitQ, 1000)
            : 200;
          const [traces, users] = await Promise.all([
            tracer.list({ user, limit }),
            tracer.users(),
          ]);
          return c.json({
            app: appName,
            enabled: tracer.enabled,
            persistent: tracer.isPersistent(),
            users,
            traces,
          });
        }) as RouteHandler,
      );
      adapter.registerRoute(
        "post",
        "/docs/_traces",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_traces is available on localhost only.",
              },
              403,
            );
          }
          let body: Record<string, unknown> = {};
          try {
            body = (await c.req.json()) as Record<string, unknown>;
          } catch {
            body = {};
          }
          if (body.clear === true) await tracer.clear();
          return c.json({ ok: true, traces: await tracer.list() });
        }) as RouteHandler,
      );
      // Headless "Run all in order" over HTTP: a localhost-only door to exerciseEndpoints so an
      // agent, CI, or the map UI can ask a running server "does the whole composed process work
      // right now?" and get a machine-readable verdict. Same blast radius as a human clicking
      // Run all, so it takes the localhost-only trust posture exactly — loopback socket only, and
      // in-process dispatch (which has no conn info) is denied. 503 until the backend exists.
      adapter.registerRoute(
        "post",
        "/docs/_run",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error: "Forbidden: /docs/_run is available on localhost only.",
              },
              403,
            );
          }
          if (!runTarget) {
            return c.json({ error: "Server still booting — try again." }, 503);
          }
          let body: Record<string, unknown> = {};
          try {
            body = (await c.req.json()) as Record<string, unknown>;
          } catch {
            body = {}; // empty/invalid body ⇒ exercise everything with defaults
          }
          // scenario: "<name>" replays a saved fixtures/scenarios file headlessly: its flow plus
          // each step's LITERAL body fields as byEndpoint overrides. Fields holding {{refs}} are
          // dropped — the runner fills those through its own bind machinery, which the refs mirror.
          let scenarioFlow: string | undefined;
          let scenarioByEndpoint:
            | Record<string, Record<string, unknown>>
            | undefined;
          if (typeof body.scenario === "string" && body.scenario !== "") {
            const wanted = scenarioSlug(body.scenario);
            const scenario = (await readScenarios()).find((s) =>
              scenarioSlug(s.name) === wanted
            );
            if (!scenario) {
              return c.json(
                { error: `Unknown scenario "${body.scenario}".` },
                404,
              );
            }
            scenarioFlow = scenario.flow;
            scenarioByEndpoint = {};
            for (const step of scenario.steps) {
              if (step.skip || !step.body) continue;
              try {
                const parsed = JSON.parse(step.body) as Record<string, unknown>;
                const literals: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(parsed)) {
                  if (typeof v === "string" && v.includes("{{")) continue;
                  literals[k] = v;
                }
                if (Object.keys(literals).length) {
                  scenarioByEndpoint[step.id] = literals;
                }
              } catch {
                // unparseable frozen body — leave that step to the runner's defaults
              }
            }
          }
          // Transient slugs come from the project's own heal rules: any slug with a `retry`
          // action (or a `note` with retryAfter) is declared "worth re-attempting", and the
          // built-in transients always are. The walk then waits-and-retries those instead of
          // failing — heal knowledge feeding the runner, not just the UI.
          const healRules = await readHealRules();
          const retrySlugs = new Set<string>(["timeout", "rate-limited"]);
          for (const [slug, rules] of Object.entries(healRules.slugs)) {
            for (const rule of rules) {
              if (
                rule.kind === "retry" ||
                (rule.kind === "note" && rule.retryAfter)
              ) {
                retrySlugs.add(slug);
              }
            }
          }
          const opts: ExerciseOptions = {
            api: runTarget,
            flow: typeof body.flow === "string" ? body.flow : scenarioFlow,
            retry: { slugs: [...retrySlugs] },
            orderBy: body.orderBy === "module" ? "module" : undefined,
            skip: Array.isArray(body.skip)
              ? (body.skip as unknown[]).filter((s): s is string =>
                typeof s === "string"
              )
              : undefined,
            rateLimit: body.rateLimit as ExerciseOptions["rateLimit"],
            maxIterations: typeof body.maxIterations === "number"
              ? body.maxIterations
              : undefined,
            dryRun: body.dryRun === true,
            overrides: {
              seeds: body.seeds as Record<string, unknown> | undefined,
              byEndpoint: (body.byEndpoint ?? scenarioByEndpoint) as
                | Record<string, Record<string, unknown>>
                | undefined,
            },
          };
          // stream: true → ndjson. One {kind:"result",…} line per attempt AS IT COMPLETES (the
          // map paints nodes live from these), then a final {kind:"done",…} summary. Errors
          // mid-run become a {kind:"error"} line — the stream itself always ends cleanly.
          if (body.stream === true && !opts.dryRun) {
            const encoder = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
              start(controller) {
                const send = (obj: unknown) =>
                  controller.enqueue(
                    encoder.encode(JSON.stringify(obj) + "\n"),
                  );
                exerciseEndpoints({
                  ...opts,
                  onResult: (r) => send({ kind: "result", ...r }),
                }).then((report) => {
                  send({
                    kind: "done",
                    ok: report.failed.length === 0 &&
                      report.cycles.length === 0,
                    passed: report.passed.length,
                    failed: report.failed,
                    optionalFailed: report.optionalFailed,
                    cycles: report.cycles,
                    iterations: report.iterations,
                  });
                  controller.close();
                }).catch((e) => {
                  send({
                    kind: "error",
                    error: e instanceof Error ? e.message : String(e),
                  });
                  controller.close();
                });
              },
            });
            return new Response(stream, {
              headers: { "content-type": "application/x-ndjson" },
            });
          }
          const report = await exerciseEndpoints(opts);
          if (opts.dryRun) {
            return c.json({
              order: report.order,
              cycles: report.cycles,
              unresolvedInputs: report.unresolvedInputs,
            });
          }
          return c.json({
            ok: report.failed.length === 0 && report.cycles.length === 0,
            passed: report.passed,
            failed: report.failed,
            optionalFailed: report.optionalFailed,
            order: report.order,
            cycles: report.cycles,
            iterations: report.iterations,
          });
        }) as RouteHandler,
      );
      // Self-healing bridge: POST /docs/_heal forwards an emulator failure
      // bundle (plus the whole composed process graph) to the configured
      // private Claude service and returns its structured verdict. The
      // emulator's RULES run client-side first; this is the long tail.
      // Localhost-only — the bundle carries session data and the upstream
      // call spends the operator's Claude plan.
      adapter.registerRoute(
        "post",
        "/docs/_heal",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return new Response(
              "Forbidden: /docs/_heal is available on localhost only.",
              { status: 403 },
            );
          }
          if (!healConfigured()) {
            return Response.json({
              error:
                "healer not configured — set PRIVATE_CLAUDE_URL (and PRIVATE_CLAUDE_TOKEN) on the server",
            }, { status: 503 });
          }
          let bundle: Record<string, unknown> = {};
          try {
            bundle = await c.req.json();
          } catch {
            // empty body → heal with graph context only
          }
          const graph = docs.map((d) => ({
            module: d.path,
            endpoints: endpointsFromDoc(d.doc).map((ep) => ({
              id: ep.id,
              method: ep.method,
              path: ep.path,
              order: ep.order,
              dependsOn: ep.dependsOn,
              bind: ep.bind,
              flows: ep.flows,
              optional: ep.optional,
              inputFields: ep.inputFields,
              outputFields: ep.outputFields,
            })),
          }));
          try {
            return Response.json(await callHealer(bundle, graph));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return Response.json({ error: msg }, { status: 502 });
          }
        }) as RouteHandler,
      );
      // The cake's persistent config artifact (fixtures/cake.json): per-module setup steps and
      // the variables a user marked "persist". GET restores it on cake load; POST merges a page's
      // slice and writes it back. Localhost-only (same posture as /_run, /_heal) — the
      // artifact carries variable values and writes the dev machine's disk.
      adapter.registerRoute(
        "get",
        "/docs/_fixtures",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_fixtures is available on localhost only.",
              },
              403,
            );
          }
          return c.json(await readFixtures());
        }) as RouteHandler,
      );
      adapter.registerRoute(
        "post",
        "/docs/_fixtures",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_fixtures is available on localhost only.",
              },
              403,
            );
          }
          let patch: FixturesPatch = {};
          try {
            patch = (await c.req.json()) as FixturesPatch;
          } catch {
            patch = {}; // empty/invalid body ⇒ a no-op merge that just re-stamps the file
          }
          try {
            const merged = await writeFixtures(
              mergeFixtures(await readFixtures(), patch),
            );
            return c.json(merged);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            // Most likely cause: the app was started without --allow-write.
            return c.json(
              { error: `Could not write fixtures/cake.json — ${msg}` },
              500,
            );
          }
        }) as RouteHandler,
      );
      // Project heal rules (fixtures/heal-rules.json): the declarative per-project tier of the
      // cake's heal panel — error slug → suggestions. keep executes them; the project (usually
      // rune, from spec fault slugs) authors them. Missing file ⇒ empty rule set, generic tier only.
      adapter.registerRoute(
        "get",
        "/docs/_heal-rules",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_heal-rules is available on localhost only.",
              },
              403,
            );
          }
          return c.json(await readHealRules());
        }) as RouteHandler,
      );
      // Scenarios (fixtures/scenarios/<name>.json): named, committable snapshots of a module's
      // walk (flow + per-step bodies/params). GET lists them all; POST saves one (same name
      // overwrites). The cake offers load/run; /docs/_run accepts { scenario } for CI replay.
      adapter.registerRoute(
        "get",
        "/docs/_scenarios",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_scenarios is available on localhost only.",
              },
              403,
            );
          }
          return c.json({ scenarios: await readScenarios() });
        }) as RouteHandler,
      );
      adapter.registerRoute(
        "post",
        "/docs/_scenarios",
        (async (c: Context) => {
          if (!isLocalRequest(c)) {
            return c.json(
              {
                error:
                  "Forbidden: /docs/_scenarios is available on localhost only.",
              },
              403,
            );
          }
          let parsed: unknown = null;
          try {
            parsed = await c.req.json();
          } catch {
            parsed = null;
          }
          const scenario = normalizeScenario(parsed);
          if (!scenario) {
            return c.json(
              { error: "A scenario needs at least { name, module, steps }." },
              400,
            );
          }
          try {
            return c.json(await writeScenario(scenario));
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return c.json(
              { error: `Could not write the scenario file — ${msg}` },
              500,
            );
          }
        }) as RouteHandler,
      );
      // Public index: seeds the token from ?token into localStorage for the doc pages.
      adapter.registerRoute(
        "get",
        "/docs",
        () => html(injectDocsScript(docsIndexHtml)),
      );
    }

    // Initialize eagerly so the in-process `backend` client is usable without listen().
    await adapter.init(rootModule);

    // Rune assert failures (thrown at validated seams by code importing
    // @mrg-keystone/rune/assert) map to HTTP 422. Detection is duck-typed on
    // name + failures — NOT instanceof — so it works even when the consumer
    // loaded its own copy of the assert module. Returning undefined falls
    // through to danet's defaults: auth HttpExceptions keep their status and
    // plain errors stay 500. danet's global-filter container is PROCESS-wide
    // and never drained by stop(), so register exactly once per process —
    // the filter is stateless, one registration serves every app.
    if (!runeAssertFilterRegistered) {
      runeAssertFilterRegistered = true;
      adapter.app.useGlobalExceptionFilter({
        catch(err: unknown, ctx: HttpContext) {
          const e = err as {
            name?: unknown;
            target?: unknown;
            context?: unknown;
            failures?: unknown;
          };
          if (e?.name === "RuneAssertError" && Array.isArray(e.failures)) {
            return ctx.json(
              {
                name: "RuneAssertError",
                message: (err as Error).message,
                target: e.target,
                context: e.context ?? null,
                failures: e.failures,
              },
              422,
            );
          }
          return undefined;
        },
      });
    }

    // Register the credential auth as Danet's global guard — it governs every controller route
    // and honors `@Public()`. A pre-built instance is bound to the GLOBAL_GUARD token.
    const guard = createCredentialGuard({
      appName,
      verifier,
      internalKey,
      infraClient,
      revokeAll: () => revokeAllState.value,
      honorSkeleton,
      logger: log,
      trustLocalhost,
    });
    // deno-lint-ignore no-explicit-any
    await (adapter.app as any).injector.registerInjectables([{
      token: GLOBAL_GUARD,
      useValue: guard,
    }]);

    // The in-process client dispatches via the non-stripping handler so its trust marker is
    // honored; the public `handler` (and what integrators mount) strips it.
    const backend = createBackendClient(
      adapter.inProcessHandler,
      `http://localhost:${port}`,
      internalKey,
    );
    runTarget = { backend, docs };

    return new BootstrapServer(
      rootModule,
      adapter,
      backend,
      docs,
      revocationPoller,
    );
  }

  /**
   * The standalone request dispatcher — the same `(Request) => Response` that `listen()` serves.
   * Use it to run on Deno Deploy without binding a port (`Deno.serve(app.handler)` or
   * `export default { fetch: app.handler }`), or to compose the backend into another app (e.g.
   * mount it under `/api` alongside a Fresh frontend with `withBasePath`).
   */
  get handler(): FetchHandler {
    return this.adapter.handler;
  }

  /** Start serving. Resolves with the actually-bound port (which may differ
   * from the requested one if it was busy — see DanetHttpAdapter.listen). */
  listen(): Promise<{ port: number }> {
    return this.adapter.listen(this.module);
  }

  stop() {
    if (this.revocationPoller !== undefined) {
      clearInterval(this.revocationPoller);
      this.revocationPoller = undefined;
    }
    return this.adapter.stop();
  }
}

export async function bootstrapServer(
  appName: string,
  module: Type | Type[],
  options?: BootstrapOptions,
): Promise<{
  listen: () => Promise<{ port: number }>;
  stop: () => Promise<void>;
  backend: BackendClient;
  handler: FetchHandler;
  docs: SwaggerDocEntry[];
}> {
  const server = await BootstrapServer.create(appName, module, options);
  return {
    listen: () => server.listen(),
    stop: () => server.stop(),
    backend: server.backend,
    handler: server.handler,
    docs: server.docs,
  };
}
