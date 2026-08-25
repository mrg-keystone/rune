// `Backend` — the backend framework's LAYER, by the book. It owns the `/api/`
// namespace (intrinsic to the layer: the wrapped composition root stays
// unprefixed and serves at root), delegates everything else unchanged to the
// wrapped `Frontend`, carries NO guard (auth is an app-composed guard layer),
// and provisions a fresh REQUEST-BOUND in-process client into the delegated
// frontend — per request, minted from that request's own cookies; the raw,
// scope-less client never leaves this layer's own scope.
//
// The three canonical serving shapes a scaffolder emits:
//
//   Deno.serve(Backend(appName, module))                          // backend alone
//   Deno.serve(Backend(appName, module, { frontend: Frontend }))  // full-stack
//   Deno.serve(Frontend)                                          // frontend alone
//
// An app that wants an auth boundary wraps the composition in its own guard:
// Deno.serve(Auth(Backend(appName, module, { frontend: Frontend }))).

import { type ComposedHandler, withBasePath } from "@foundation/domain/business/mount/mod.ts";
import {
  collectSetCookies,
  requestBoundClient,
} from "@foundation/domain/business/request-jar/mod.ts";

/** The `Frontend` contract: a fetch handler that accepts the provisioned
 *  in-process client as an optional third argument. Nothing else about it is
 *  known — the third-argument slot IS the entire seam. */
export type Frontend = (
  req: Request,
  info?: Deno.ServeHandlerInfo,
  backend?: { fetch: typeof fetch },
) => Response | Promise<Response>;

/** The already-booted slice of a composition root `BackendFrom` composes:
 *  exactly what `bootstrapServer()` returns. */
export interface BootedApi {
  handler: (
    req: Request,
    info?: Deno.ServeHandlerInfo,
  ) => Response | Promise<Response>;
  backend: { fetch: typeof fetch };
}

/**
 * `Backend`'s construction applied to an ALREADY-BOOTED composition root —
 * the same layer (intrinsic `/api/` mount, delegate-else, per-request
 * provisioned client, outer Set-Cookie collection), minus the boot: the app's
 * `bootstrap/mod.ts` already built `api`, and its dev loop / headless runner
 * keep using that single instance. This is what a scaffolded `serve.ts`
 * composes:
 *
 * ```ts
 * import { BackendFrom } from "@mrg-keystone/rune";
 * import { Frontend } from "@mrg-keystone/sprig/keep";
 * import { api } from "./server/bootstrap/mod.ts";
 * export default { fetch: BackendFrom(api, { frontend: Frontend() }) };
 * ```
 */
export function BackendFrom(
  api: BootedApi,
  options: { frontend?: Frontend } = {},
): ComposedHandler {
  const { frontend } = options;
  const provisioned: ComposedHandler | undefined = frontend
    ? async (req, info) => {
      const client = requestBoundClient(
        (r) => api.backend.fetch(r),
        req,
        "/api",
      );
      const res = await frontend(req, info, { fetch: client.fetch });
      return collectSetCookies(res, client.jar);
    }
    : undefined;
  return withBasePath("/api", api.handler as ComposedHandler)(provisioned);
}
