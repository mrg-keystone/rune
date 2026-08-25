// `withBasePath` — the low-level mount primitive, a LAYER by the composition
// algebra: `withBasePath(prefix, handler)` returns `(inner?) => Handler`, the
// pure intercept/delegate split. A request under `prefix/*` (segment-boundary
// matched) intercepts — the prefix is stripped and `handler` runs; anything
// else delegates to `inner`, or 404s when no inner was supplied (the total-
// coverage base case). The third argument — a provisioned capability — is
// forwarded on BOTH branches; `withBasePath` provisions nothing of its own.

import type { FetchHandler } from "@types";

/** The full three-argument handler shape of the composition algebra: a fetch
 *  handler that may receive a provisioned capability (e.g. the in-process
 *  client) as an optional third argument. */
export type ComposedHandler = (
  req: Request,
  info?: Deno.ServeHandlerInfo,
  client?: unknown,
) => Response | Promise<Response>;

/**
 * Mount `handler` (whose routes live at root) under `prefix`, as a layer.
 *
 * - Matching is SEGMENT-BOUNDARY only: `/api` itself and everything under
 *   `/api/...` match; `/apixyz` does not. `prefix` is normalized internally,
 *   so `/api` and `/api/` are equivalent inputs.
 * - On intercept the remainder keeps its leading slash; a request to exactly
 *   the prefix reaches `handler` as `/`, never as the empty string.
 * - The third argument is forwarded unchanged on intercept AND delegate —
 *   dropping it would break provisioning for every layer nested below.
 * - No inner → the unmatched request is `404 Not Found` (total coverage:
 *   every request terminates somewhere, never a hang or a throw).
 *
 * ```ts
 * const layer = withBasePath("/api", api.handler);
 * Deno.serve(layer());            // API-only: /api/* served, everything else 404
 * Deno.serve(layer(frontend));    // composed: /api/* → backend, else → frontend
 * ```
 */
export function withBasePath(
  basePath: string,
  handler: ComposedHandler | FetchHandler,
): (inner?: ComposedHandler) => ComposedHandler {
  const base = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
  return (inner?: ComposedHandler): ComposedHandler => (req, info, client) => {
    const url = new URL(req.url);
    if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
      url.pathname = url.pathname.slice(base.length) || "/";
      // Forward conn info AND the provisioned third argument (symmetric with
      // the delegate branch; `Backend`'s own intercepted handler happens to
      // receive none at top level, but that's its position, not this rule).
      return (handler as ComposedHandler)(new Request(url, req), info, client);
    }
    if (inner) return inner(req, info, client);
    return new Response("Not Found", { status: 404 });
  };
}
