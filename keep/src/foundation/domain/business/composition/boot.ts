// `Backend(appName, module, options?)` — the layer applied to a FRESH
// composition root it boots itself (lazily, on the first request; it never
// calls `listen()`). The structural pieces — the `Frontend` contract, the
// mount, the provisioning — live in ./mod.ts; this file only adds the boot.

import type { Type } from "@types";
import {
  BootstrapServer,
  type BootstrapOptions,
} from "@foundation/domain/coordinators/bootstrap-server/mod.ts";
import type { ComposedHandler } from "@foundation/domain/business/mount/mod.ts";
import { BackendFrom, type Frontend } from "./mod.ts";

export interface BackendOptions {
  // forwarded through, unchanged, to the composition root:
  swagger?: BootstrapOptions["swagger"];
  onStart?: BootstrapOptions["onStart"];
  onStop?: BootstrapOptions["onStop"];
  // Backend's own addition:
  frontend?: Frontend;
}

/**
 * Build the composed handler. Returned SYNCHRONOUSLY (so `Deno.serve` binds it
 * directly); the composition root boots lazily on the first request — it is
 * initialized, never `listen()`ed, and the forwarded `onStart`/`onStop` fire
 * via the handler path exactly as the composition root defines.
 */
export function Backend(
  appName: string,
  module: Type | Type[],
  options: BackendOptions = {},
): ComposedHandler {
  const { frontend, ...bootstrapOpts } = options;

  // Init once, lazily; keep exactly two things from the composition root: its
  // unprefixed handler and its raw, scope-less in-process client.
  let readyPromise: Promise<ComposedHandler> | null = null;
  const ready = () => {
    readyPromise ??= BootstrapServer.create(appName, module, bootstrapOpts)
      .then((server) =>
        BackendFrom(
          { handler: server.handler, backend: server.backend },
          { frontend },
        )
      );
    return readyPromise;
  };

  return async (req, info, client) => (await ready())(req, info, client);
}

