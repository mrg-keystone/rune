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
import {
  createInfraClient,
  type InfraClient,
} from "@foundation/domain/business/infra-client/mod.ts";
import {
  createJwksVerifier,
  type SessionVerifier,
} from "@foundation/domain/business/token/mod.ts";
import {
  createKvSessionStore,
  createMemorySessionStore,
  type IntakeInput,
  type IntakeResult,
  intakeSession,
  resolveSession,
  type SessionStore,
} from "@foundation/domain/business/session-store/mod.ts";
import {
  extractBearer,
  grantsForApp,
  isTrustedOrigin,
  readCookie,
  SESSION_COOKIE_NAME,
  validateCredential,
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
import { Crawler } from "@foundation/domain/business/crawler/mod.ts";
import { warnOpenRoutes } from "@foundation/domain/business/route-audit/mod.ts";
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
// the revocation poll. INFRA_URL overrides; when unset we fall back to the keystone infra so a keep
// app authorizes out of the box without every environment re-declaring the same URL. Point a fork at
// its own infra by exporting INFRA_URL (the org already ships this URL in the README + package name,
// so it is not a secret — only the fallback, not a credential).
const DEFAULT_INFRA_URL = "https://infra.mrg-keystone.deno.net";
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

/**
 * Gate for the framework's own `/docs/_*` control-plane routes (traces, run, heal, fixtures,
 * scenarios, heal-rules). There is NO localhost bypass: a caller is allowed only when it is the
 * **in-process client** (matching internal key) or presents an **infra bearer whose app-grants
 * include `dev` or `*`**. Everything else is denied.
 */
async function controlPlaneAllowed(
  c: Context,
  internalKey: string,
  verifier: SessionVerifier | undefined,
  appName: string,
): Promise<boolean> {
  if (isTrustedOrigin(c, internalKey)) return true;
  const cred = extractBearer(c.req.header("authorization")) ??
    c.req.query("token");
  if (!cred || !verifier) return false;
  const r = await validateCredential(cred, { verifier });
  if (!r) return false;
  const g = grantsForApp(r.claims, appName);
  return g.includes("dev") || g.includes("*");
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

/** The session-store profile read a gateway surfaces as `GET /auth/me` — see {@link BootstrapServer.sessionProfile}. */
export interface SessionProfile {
  /** The user's real display name (infra profile), when known. */
  name?: string;
  /** The user's real email (infra profile), when known. */
  email?: string;
  /**
   * The session's app-scoped grants — UX-only, so the UI can render the right controls. NOT a trust
   * boundary: the guard still enforces grants deny-by-default from the *verified* bearer on every
   * request, so a client that fakes these only fools its own UI and every gated call still 403s.
   */
  grants: string[];
}

/** The slice of the infra client {@link BootstrapServer} keeps for intake + silent refresh. */
interface InfraExchange {
  exchange(token: string): Promise<string>;
  exchangeProfile(
    token: string,
  ): Promise<{ token: string; name?: string; email?: string }>;
  loginProfile(
    idToken: string,
    email?: string,
  ): Promise<{ token: string; name?: string; email?: string }>;
}

export class BootstrapServer {
  private adapter: DanetHttpAdapter;
  private module: Type;
  readonly backend: BackendClient;
  /** The per-module OpenAPI docs (with `x-keep-process`) built at boot; empty when swagger is off. */
  readonly docs: SwaggerDocEntry[];

  /** Cleared on stop() so the revocation poll timer never outlives the server. */
  private revocationPoller?: number;

  /**
   * The server-side session store, present by default (absent only when explicitly disabled via
   * `KEEP_SESSION_KV=false/0/off/empty` or when `INFRA_URL` is empty). The `sprig_session`
   * cookie is resolved through this on every request (with silent refresh); a host gateway (e.g.
   * sprig's `serveSprig`) mints sessions with {@link intakeSession} and clears them with
   * {@link destroySession}, setting/clearing the httpOnly cookie itself. `undefined` ⇒ cookie
   * sessions are off and only the `Authorization` header / `?token=` query authorize.
   */
  readonly sessions?: SessionStore;
  private readonly appName: string;
  private readonly infra?: InfraExchange;

  private constructor(
    module: Type,
    adapter: DanetHttpAdapter,
    backend: BackendClient,
    docs: SwaggerDocEntry[],
    appName: string,
    revocationPoller?: number,
    sessions?: SessionStore,
    infra?: InfraExchange,
  ) {
    this.module = module;
    this.adapter = adapter;
    this.backend = backend;
    this.docs = docs;
    this.appName = appName;
    this.revocationPoller = revocationPoller;
    this.sessions = sessions;
    this.infra = infra;
  }

  /**
   * Intake a credential into a server-side session: exchange it at infra for a signed bearer, store
   * the ORIGINAL credential + bearer + profile, and return the opaque id a gateway drops into the
   * httpOnly `sprig_session` cookie (the bearer never reaches the browser). Throws when the session
   * store is off (`KEEP_SESSION_KV=false/0/off/empty`, or `INFRA_URL` empty) or infra rejects the
   * credential. The gateway owns the
   * `Set-Cookie`; keep owns the exchange + store + silent refresh on subsequent requests.
   */
  intakeSession(input: IntakeInput): Promise<IntakeResult> {
    if (!this.sessions || !this.infra) {
      throw new Error(
        "Session store is disabled — it is on by default; re-enable by unsetting KEEP_SESSION_KV=false/0/off and leaving INFRA_URL non-empty.",
      );
    }
    return intakeSession(this.sessions, this.infra, input, this.appName);
  }

  /** Destroy a session (logout): the gateway clears the cookie; this drops the stored credential. */
  destroySession(id: string): Promise<void> {
    return this.sessions?.destroy(id) ?? Promise.resolve();
  }

  /**
   * Resolve the `sprig_session` cookie to the session's cached profile — the read behind a
   * `GET /auth/me` (surfaced by sprig's `serveSprig` gateway). Because the client is cookie-based and
   * never sees the bearer, this is the only way `getUserData()` learns `{ name, email, grants }`.
   * Returns `null` when the cookie is absent, the session is gone, or the session store is off — the
   * gateway maps `null` → 401. Silent refresh runs here too (via the stored credential), so a
   * long-lived tab keeps a fresh session. `grants` are UX-only — see {@link SessionProfile.grants}.
   */
  async sessionProfile(
    cookieHeader: string | undefined,
  ): Promise<SessionProfile | null> {
    if (!this.sessions) return null;
    const id = readCookie(cookieHeader, SESSION_COOKIE_NAME);
    if (!id) return null;
    const rec = await resolveSession(
      this.sessions,
      id,
      this.infra ? { exchange: (c) => this.infra!.exchange(c) } : {},
    );
    if (!rec) return null;
    return { name: rec.name, email: rec.email, grants: rec.grants ?? [] };
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

    // infra connection: the exchange broker + JWKS verifier + revocation poller. INFRA_URL overrides;
    // unset falls back to the keystone infra (DEFAULT_INFRA_URL) so a keep app can exchange opaque
    // tokens and verify session bearers without every environment re-declaring the same URL. Setting
    // INFRA_URL="" (empty) explicitly opts out — only trusted origins (in-process / localhost)
    // authorize and every infra network call fails closed.
    const infraEnv = Deno.env.get(INFRA_URL_ENV);
    const infraBaseUrl = infraEnv === undefined ? DEFAULT_INFRA_URL : infraEnv;
    const infraClient: InfraClient | undefined = infraBaseUrl
      ? createInfraClient({
        baseUrl: infraBaseUrl,
        jwksUrl: Deno.env.get(INFRA_JWKS_URL_ENV) || undefined,
      })
      : undefined;
    if (!infraClient) {
      warnOnce(
        `[${appName}] ${INFRA_URL_ENV} set empty — opaque-token exchange and session-bearer verification are disabled (only trusted origins authorize).`,
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

    // Server-side session store: ON by default so cookie sessions work out of the box. Holds the
    // ORIGINAL credential so a lapsed ~1h bearer is re-minted transparently, and lets a request
    // authenticate from the tiny httpOnly `sprig_session` cookie instead of the client holding the
    // bearer. KEEP_SESSION_KV selects the store: unset or "1"/"true" → Deno KV at the default
    // location; a path → KV at that path (native per-key TTL, survives restarts / scales across
    // instances). Opt OUT with "false"/"0"/"off"/empty. If KV won't open (no --unstable-kv) it falls
    // back to a process-local store (warns once) — fine for local dev; Deno Deploy has KV natively.
    // Needs infra for the silent re-exchange (INFRA_URL, itself defaulted above). KEEP_SESSION_TTL_DAYS
    // bounds idle retention.
    const sessionEnv = Deno.env.get("KEEP_SESSION_KV") ?? "1";
    const sessionOff = ["false", "0", "off", ""].includes(sessionEnv.toLowerCase());
    let sessionStore: SessionStore | undefined;
    if (!sessionOff) {
      if (!infraClient) {
        warnOnce(
          `[${appName}] session store wanted but ${INFRA_URL_ENV} is empty — cookie sessions can't silently re-exchange; disabling the session store (set ${INFRA_URL_ENV} to re-enable).`,
        );
      } else {
        const ttlDays = Number(Deno.env.get("KEEP_SESSION_TTL_DAYS"));
        const ttl = Number.isFinite(ttlDays) && ttlDays > 0
          ? ttlDays
          : undefined;
        const lower = sessionEnv.toLowerCase();
        const path = lower === "1" || lower === "true" ? undefined : sessionEnv;
        sessionStore = (await createKvSessionStore(path, ttl)) ??
          createMemorySessionStore(ttl);
      }
    }
    // Resolve the `sprig_session` cookie → a fresh bearer (silent refresh from the stored credential).
    const cookieSession = sessionStore && infraClient
      ? (id: string) =>
        resolveSession(sessionStore!, id, {
          exchange: (cred) => infraClient.exchange(cred),
        }).then((r) => r?.bearer ?? null)
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
          bootTimer.id = setTimeout(
            resolve,
            BOOT_REVOCATION_POLL_TIMEOUT_MS,
          ) as unknown as number;
        }),
      ]).finally(() => {
        if (bootTimer.id !== undefined) clearTimeout(bootTimer.id);
      });
      revocationPoller = setInterval(
        pollOnce,
        revocationPollMs,
      ) as unknown as number;
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

    const server = Server.create();
    server.registerModule(rootModule);

    const adapter = new DanetHttpAdapter(port);
    // Register the logging middleware first so it wraps every route (controllers + swagger).
    adapter.app.use(createRequestLoggingMiddleware(log));
    // Credential auth is enforced as a Danet GLOBAL guard (registered after init below) rather
    // than a Hono middleware, so it can honor the per-route `@Public()` decorator. Controllers
    // are deny-by-default; the framework's own direct routes (`/docs`, docs `/json`, `/docs/_*`)
    // aren't controllers, so they self-gate. Clients exchange opaque tokens for a session bearer
    // at infra directly and present the bearer to keep — keep never mints or exchanges.
    type RouteHandler = (...args: unknown[]) => unknown;

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
        // Gated spec: the in-process client needs no token; every other caller must present an
        // infra bearer whose app-grants include `dev` or `*` (Authorization header or ?token).
        adapter.registerRoute(
          "get",
          `/docs${path}/json`,
          createDocsJsonHandler({
            specJson: JSON.stringify(doc),
            verifier,
            appName,
            internalKey,
            logger: log,
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
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
          // scenario: "<name>" replays a saved spec/misc/scenarios file headlessly: its flow plus
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
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
      // The cake's persistent config artifact (spec/misc/cake.json): per-module setup steps and
      // the variables a user marked "persist". GET restores it on cake load; POST merges a page's
      // slice and writes it back. Localhost-only (same posture as /_run, /_heal) — the
      // artifact carries variable values and writes the dev machine's disk.
      adapter.registerRoute(
        "get",
        "/docs/_fixtures",
        (async (c: Context) => {
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
              { error: `Could not write spec/misc/cake.json — ${msg}` },
              500,
            );
          }
        }) as RouteHandler,
      );
      // Project heal rules (spec/misc/heal-rules.json): the declarative per-project tier of the
      // cake's heal panel — error slug → suggestions. keep executes them; the project (usually
      // rune, from spec fault slugs) authors them. Missing file ⇒ empty rule set, generic tier only.
      adapter.registerRoute(
        "get",
        "/docs/_heal-rules",
        (async (c: Context) => {
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
      // Scenarios (spec/misc/scenarios/<name>.json): named, committable snapshots of a module's
      // walk (flow + per-step bodies/params). GET lists them all; POST saves one (same name
      // overwrites). The cake offers load/run; /docs/_run accepts { scenario } for CI replay.
      adapter.registerRoute(
        "get",
        "/docs/_scenarios",
        (async (c: Context) => {
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
          if (!(await controlPlaneAllowed(c, internalKey, verifier, appName))) {
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
      revokeAll: () => revokeAllState.value,
      honorSkeleton,
      logger: log,
      cookieSession,
    });
    // deno-lint-ignore no-explicit-any
    await (adapter.app as any).injector.registerInjectables([{
      token: GLOBAL_GUARD,
      useValue: guard,
    }]);

    // Authorization audit: name every controller route that declares neither @Public nor
    // @Grant/@LoggedIn. Deny-by-default leaves such a route reachable only by `*` (or nobody under
    // honorSkeleton:false) — safe, but indistinguishable from a route someone forgot to gate. Warn
    // once so a bare route is a conscious choice. On by default; KEEP_ROUTE_AUDIT=off silences it.
    if ((Deno.env.get("KEEP_ROUTE_AUDIT") ?? "on").toLowerCase() !== "off") {
      const open = warnOpenRoutes(new Crawler().crawl([rootModule]), {
        appName,
        honorSkeleton,
        warn: warnOnce,
      });
      if (open.length === 0) {
        log.debug(
          "route-audit: every controller route is @Public or explicitly gated.",
        );
      }
    }

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
      appName,
      revocationPoller,
      sessionStore,
      infraClient,
    );
  }

  /**
   * The standalone request dispatcher — the same `(Request) => Response` that `listen()` serves.
   * Use it to run on Deno Deploy without binding a port (`Deno.serve(app.handler)` or
   * `export default { fetch: app.handler }`), or to compose the backend into another app (e.g.
   * mount it under `/api` alongside a sprig UI — `serveSprig`/`sprigUi` from `@sprig/keep` do this,
   * or the framework-agnostic `withBasePath`).
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
  // The session engine, surfaced so a host gateway (sprig's `serveSprig({ keep })`) can mint/read/clear
  // the httpOnly `sprig_session` cookie. Without these three, serveSprig's /auth gateway stays in legacy
  // bearer-proxy mode and NEVER sets a cookie, so an SSR guard reading `ctx.session` always bounces —
  // even though the store is on by default. `sessions` is the store the SSR pipeline reads per request.
  sessions?: SessionStore;
  intakeSession: (input: IntakeInput) => Promise<IntakeResult>;
  destroySession: (id: string) => Promise<void>;
}> {
  const server = await BootstrapServer.create(appName, module, options);
  return {
    listen: () => server.listen(),
    stop: () => server.stop(),
    backend: server.backend,
    handler: server.handler,
    docs: server.docs,
    sessions: server.sessions,
    intakeSession: (input) => server.intakeSession(input),
    destroySession: (id) => server.destroySession(id),
  };
}
