import type { FetchHandler } from "@types";
import type { BackendClient } from "@foundation/domain/business/backend-client/mod.ts";

/**
 * Mounts a root-based handler under `basePath`. The returned handler matches requests whose
 * path is exactly `basePath` or starts with `basePath + "/"`, strips the prefix, and dispatches
 * to the underlying handler (so its routes — registered at root — still match). Any other path
 * returns 404.
 *
 * This lets the backend be exposed under e.g. `/api` alongside a Fresh frontend, while the very
 * same handler keeps serving at root when the backend is deployed standalone:
 *
 * ```ts
 * // Fresh main.ts — delegate /api/* to the in-process backend (network calls, token-gated)
 * app.all("/api/*", (ctx) => withBasePath("/api", api.handler)(ctx.req));
 * ```
 *
 * Note: only the URL is rebased; conn info is not forwarded, so requests arriving this way are
 * treated as network traffic (token required) — exactly what you want for an externally exposed
 * `/api`. In-process calls should still go through `backend.fetch`, which bypasses the token.
 */
export function withBasePath(
  basePath: string,
  handler: FetchHandler,
): FetchHandler {
  const base = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  return (req, info) => {
    const url = new URL(req.url);
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      url.pathname = url.pathname.slice(base.length) || "/";
      // Forward conn info so the mounted backend can still detect loopback/localhost.
      return handler(new Request(url, req), info);
    }
    return new Response("Not Found", { status: 404 });
  };
}

/** The slice of `bootstrapServer`'s result that `embed` consumes. */
export interface EmbeddableBackend {
  handler: FetchHandler;
  backend: BackendClient;
}

/** What `embed` puts on Fresh's `ctx.state` — extend your app `State` with this. */
export interface KeepState {
  /** In-process client: server-side code calls the API with no token and no network hop. */
  api: BackendClient;
}

/**
 * Structural slice of a Fresh 2 middleware context (typed structurally so keep does not
 * depend on the fresh package). Fresh's `Context<State>` satisfies it.
 */
export interface EmbedContext {
  req: Request;
  info?: Deno.ServeHandlerInfo;
  state: Partial<KeepState>;
  next(): Response | Promise<Response>;
}

/**
 * One-call Fresh 2 integration: returns a middleware that exposes the backend under
 * `options.at` (default `/api`) and gives every other request the in-process client.
 *
 * ```ts
 * export const app = new App<State>()
 *   .use(staticFiles())
 *   .use(embed(api))        // /api/* → token-gated backend; ctx.state.api elsewhere
 *   .fsRoutes();
 * ```
 *
 * Requests under the prefix are rebased with {@linkcode withBasePath} and dispatched to
 * `api.handler` with Fresh's conn info forwarded — so loopback detection (localhost trust,
 * `/_token`) keeps working without the caller having to remember `ctx.info`. All other
 * requests get `ctx.state.api = api.backend` (the token-free in-process client) and fall
 * through to the next handler. Register it before `.fsRoutes()`; Fresh's builder is
 * order-sensitive.
 */
export function embed(
  api: EmbeddableBackend,
  options: { at?: string } = {},
): (ctx: EmbedContext) => Response | Promise<Response> {
  const base = `/${(options.at ?? "/api").replace(/^\/+|\/+$/g, "")}`;
  const mounted = withBasePath(base, api.handler);
  return (ctx) => {
    const { pathname } = new URL(ctx.req.url);
    if (pathname === base || pathname.startsWith(`${base}/`)) {
      return mounted(ctx.req, ctx.info);
    }
    ctx.state.api = api.backend;
    return ctx.next();
  };
}
