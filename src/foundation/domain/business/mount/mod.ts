import type { FetchHandler } from "@types";

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
export function withBasePath(basePath: string, handler: FetchHandler): FetchHandler {
  const base = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  return (req) => {
    const url = new URL(req.url);
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      url.pathname = url.pathname.slice(base.length) || "/";
      return handler(new Request(url, req));
    }
    return new Response("Not Found", { status: 404 });
  };
}
