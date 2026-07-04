import type { FetchHandler } from "@types";

/**
 * Mounts a root-based handler under `basePath`. The returned handler matches requests whose
 * path is exactly `basePath` or starts with `basePath + "/"`, strips the prefix, and dispatches
 * to the underlying handler (so its routes — registered at root — still match). Any other path
 * returns 404.
 *
 * This lets the backend be exposed under e.g. `/api` inside a larger host, while the very same
 * handler keeps serving at root when the backend is deployed standalone:
 *
 * ```ts
 * // delegate /api/* to the in-process backend (network calls, token-gated)
 * host.all("/api/*", (req, info) => withBasePath("/api", api.handler)(req, info));
 * ```
 *
 * Note: only the URL is rebased; conn info IS forwarded (the second arg), so the mounted backend
 * can still detect loopback/localhost. Requests arriving this way are treated as network traffic
 * (token required) — exactly what you want for an externally exposed `/api`. In-process calls
 * should still go through `backend.fetch`, which bypasses the token.
 *
 * For mounting a sprig UI in front of the backend, prefer `serveSprig`/`sprigUi` from
 * `@sprig/keep`, which wrap this primitive and bind the in-process client to sprig's `Backend`
 * DI token. `withBasePath` remains the low-level, framework-agnostic mount.
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
