import type { FetchHandler, SwaggerDocEntry, Type } from "@types";
import { Server } from "@foundation/domain/business/server/mod.ts";
import { DanetHttpAdapter } from "@foundation/domain/data/http-adapter/mod.ts";
import { createBackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import type { BackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import { log } from "@foundation/domain/business/logger/mod.ts";
import { DatadogTransport } from "@foundation/domain/data/datadog/mod.ts";
import { PostmarkAlerter } from "@foundation/domain/data/postmark/mod.ts";
import { createRequestLoggingMiddleware } from "@foundation/domain/business/request-logger/mod.ts";
import { GLOBAL_GUARD, type HttpContext } from "#danet/core";
import { createCredentialGuard } from "@foundation/domain/business/token-auth/mod.ts";
import { createMintUi } from "@foundation/domain/business/mint-ui/mod.ts";
import { appModule } from "@foundation/domain/business/endpoint-decorator/mod.ts";
import { createFirebaseVerifier } from "@foundation/domain/business/firebase-auth/mod.ts";
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
import { endpointsFromDoc } from "@foundation/domain/business/endpoint-spec/mod.ts";

interface BootstrapOptions {
  port?: number;
  swagger?: boolean | { filters: string[] };
}

// The per-app secret used to sign and verify access tokens. Read from the environment so it
// never lives in the (public) package source.
const SIGNING_KEY_ENV = "MANUAL_KEY";

// Datadog region is fixed; alert routing is read from the environment so internal email
// addresses stay out of the (public) package source.
const DATADOG_SITE = "us5.datadoghq.com";

const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
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
  const ddKey = Deno.env.get("DD_API_KEY");
  const datadog = ddKey
    ? new DatadogTransport({
      apiKey: ddKey,
      service: appName,
      site: DATADOG_SITE,
    })
    : undefined;
  if (!datadog) {
    warnOnce(
      `[${appName}] DD_API_KEY not set — Datadog disabled; logging to console only.`,
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
}

export class BootstrapServer {
  private adapter: DanetHttpAdapter;
  private module: Type;
  readonly backend: BackendClient;
  /** The per-module OpenAPI docs (with `x-keep-process`) built at boot; empty when swagger is off. */
  readonly docs: SwaggerDocEntry[];

  private constructor(
    module: Type,
    adapter: DanetHttpAdapter,
    backend: BackendClient,
    docs: SwaggerDocEntry[],
  ) {
    this.module = module;
    this.adapter = adapter;
    this.backend = backend;
    this.docs = docs;
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
    configureLoggingFromEnv(appName);

    const signingKey = Deno.env.get(SIGNING_KEY_ENV) ?? "";
    if (!signingKey) {
      warnOnce(
        `[${appName}] ${SIGNING_KEY_ENV} not set — access tokens cannot be minted or verified.`,
      );
    }

    // Optional Firebase Auth: a request authorizes with EITHER a signed token OR a Firebase
    // ID token. Verifying ID tokens needs only the project id (signature is checked against
    // Google's public certs). Unset ⇒ Firebase path is off (signed tokens only).
    const firebaseProjectId = Deno.env.get("FIREBASE_PROJECT_ID") ?? "";
    const firebaseVerifier = firebaseProjectId
      ? createFirebaseVerifier({ projectId: firebaseProjectId })
      : undefined;
    if (!firebaseVerifier) {
      warnOnce(
        `[${appName}] FIREBASE_PROJECT_ID not set — Firebase Auth disabled; only signed tokens are accepted on network requests.`,
      );
    }

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
    // are deny-by-default; the framework's own direct routes (`/_mint`, `/docs`, docs `/json`)
    // aren't controllers, so they self-gate (mint localhost guard; docs json token check).

    // Localhost-only token minting UI. The docs link on the minted-token page only renders
    // when docs are actually served.
    const mintUi = createMintUi({
      appName,
      signingKey,
      logger: log,
      docsEnabled: Boolean(swagger),
    });
    type RouteHandler = (...args: unknown[]) => unknown;
    adapter.registerRoute("get", "/_mint", mintUi.form as RouteHandler);
    adapter.registerRoute("post", "/_mint", mintUi.mint as RouteHandler);

    // Dev mode (`rune dev` sets KEEP_DEV to a status-file path): serve `/docs/_dev` so the
    // emulator pages can poll for restarts (bootId change) and spec-check errors, and inject
    // the reload poller into every emulator page.
    const devStatusPath = Deno.env.get("KEEP_DEV");

    let docs: SwaggerDocEntry[] = [];
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
            if (!producersByField.has(field)) {
              producersByField.set(field, `${moduleName}:${ep.id}`);
            }
          }
        }
      }

      for (const { path, doc, moduleName, endpoints } of moduleEntries) {
        const title = `API · ${moduleName}`;
        // This module's $inputs that a DIFFERENT composed module produces — names with no
        // producer (or only this module itself) stay explicit-only.
        const producers: Record<string, string> = {};
        for (const ep of endpoints) {
          for (const ref of Object.values(ep.bind)) {
            for (const candidate of Array.isArray(ref) ? ref : [ref]) {
              if (!candidate.startsWith("$")) continue;
              const name = candidate.slice(1);
              const producer = producersByField.get(name);
              if (!producer || producer.startsWith(`${moduleName}:`)) continue;
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
            signingKey,
            firebaseVerifier,
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
    // @mrg-keystone/keep/assert) map to HTTP 422. Detection is duck-typed on
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
      signingKey,
      internalKey,
      firebaseVerifier,
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

    return new BootstrapServer(rootModule, adapter, backend, docs);
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

  listen() {
    return this.adapter.listen(this.module);
  }

  stop() {
    return this.adapter.stop();
  }
}

export async function bootstrapServer(
  appName: string,
  module: Type | Type[],
  options?: BootstrapOptions,
): Promise<{
  listen: () => Promise<void>;
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
