import type { Type, FetchHandler } from "@types";
import { Server } from "@foundation/domain/business/server/mod.ts";
import { SwaggerBuilder } from "@foundation/domain/business/swagger-builder/mod.ts";
import { DanetHttpAdapter } from "@foundation/domain/data/http-adapter/mod.ts";
import { createBackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import type { BackendClient } from "@foundation/domain/business/backend-client/mod.ts";
import { log } from "@foundation/domain/business/logger/mod.ts";
import { DatadogTransport } from "@foundation/domain/data/datadog/mod.ts";
import { PostmarkAlerter } from "@foundation/domain/data/postmark/mod.ts";
import { createRequestLoggingMiddleware } from "@foundation/domain/business/request-logger/mod.ts";
import { createTokenAuthMiddleware } from "@foundation/domain/business/token-auth/mod.ts";
import { createMintUi } from "@foundation/domain/business/mint-ui/mod.ts";

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

/**
 * Builds the logging transports from the environment:
 * - `DD_API_KEY` → Datadog (site fixed to DATADOG_SITE). Missing ⇒ warn, console only.
 * - `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM` (+ optional `POSTMARK_TO`, defaults to `FROM`)
 *   → failure-alert emails. Missing ⇒ warn, console fallback.
 */
function configureLoggingFromEnv(appName: string) {
  const ddKey = Deno.env.get("DD_API_KEY");
  const datadog = ddKey
    ? new DatadogTransport({ apiKey: ddKey, service: appName, site: DATADOG_SITE })
    : undefined;
  if (!datadog) {
    warnOnce(`[${appName}] DD_API_KEY not set — Datadog disabled; logging to console only.`);
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

  private constructor(module: Type, adapter: DanetHttpAdapter, backend: BackendClient) {
    this.module = module;
    this.adapter = adapter;
    this.backend = backend;
  }

  static async create(
    appName: string,
    module: Type,
    options?: BootstrapOptions,
  ) {
    const { port = 3000, swagger = true } = options ?? {};

    // Configure the process-wide logger from env before anything can emit.
    configureLoggingFromEnv(appName);

    const signingKey = Deno.env.get(SIGNING_KEY_ENV) ?? "";
    if (!signingKey) {
      warnOnce(
        `[${appName}] ${SIGNING_KEY_ENV} not set — access tokens cannot be minted or verified.`,
      );
    }

    // Process-private key that identifies in-process (BackendClient) requests. Minted per boot,
    // shared only between the in-process client and the auth middleware; never leaves the process.
    const internalKey = crypto.randomUUID();

    const server = Server.create();
    server.registerModule(module);

    const adapter = new DanetHttpAdapter(port);
    // Register the logging middleware first so it wraps every route (controllers + swagger).
    adapter.app.use(createRequestLoggingMiddleware(log));
    // Token auth runs inside the log scope so a verified token's `source` tags the logs.
    // A token is required on every network request except localhost and in-process callers.
    adapter.app.use(createTokenAuthMiddleware({ signingKey, logger: log, internalKey }));

    // Localhost-only token minting UI.
    const mintUi = createMintUi({ appName, signingKey, logger: log });
    type RouteHandler = (...args: unknown[]) => unknown;
    adapter.registerRoute("get", "/_mint", mintUi.form as RouteHandler);
    adapter.registerRoute("post", "/_mint", mintUi.mint as RouteHandler);

    if (swagger) {
      const filters = typeof swagger === "object" ? swagger.filters : [];
      const builder = new SwaggerBuilder(...filters);
      const { swaggerDocs, docsIndexHtml } = await builder.build(server);
      for (const { path, doc } of swaggerDocs) {
        adapter.registerSwaggerDocument(`/docs${path}`, doc);
      }
      adapter.registerRoute("get", "/docs", () =>
        new Response(docsIndexHtml, {
          headers: { "Content-Type": "text/html" },
        })
      );
    }

    // Initialize eagerly so the in-process `backend` client is usable without listen().
    await adapter.init(module);
    const backend = createBackendClient(adapter.handler, `http://localhost:${port}`, internalKey);

    return new BootstrapServer(module, adapter, backend);
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
  module: Type,
  options?: BootstrapOptions,
): Promise<{
  listen: () => Promise<void>;
  stop: () => Promise<void>;
  backend: BackendClient;
  handler: FetchHandler;
}> {
  const server = await BootstrapServer.create(appName, module, options);
  return {
    listen: () => server.listen(),
    stop: () => server.stop(),
    backend: server.backend,
    handler: server.handler,
  };
}
