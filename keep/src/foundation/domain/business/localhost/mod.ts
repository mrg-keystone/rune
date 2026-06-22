import type { Context } from "#hono";

/**
 * Loopback detection shared by every localhost-only door (the `/docs/_*` control routes, the
 * `/_token` exchange endpoint). A request is "local" only when its connecting socket address is a
 * loopback host — that address comes from the real TCP peer (`remoteAddr`) and cannot be forged by
 * a remote client. We deliberately do NOT fall back to the `Host` header (client-spoofable): if the
 * peer address is unavailable we fail closed, since this is the sole gate on those routes.
 *
 * To make this work when the backend is mounted behind another listener, forward Deno's conn info:
 * `handler(req, info)`.
 */
export const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
]);

/** True only when the connecting socket's peer address is loopback. */
export function isLocalRequest(c: Context): boolean {
  const peer = remoteHostname(c);
  return peer !== undefined && LOOPBACK_HOSTS.has(peer);
}

function remoteHostname(c: Context): string | undefined {
  // Deno.serve passes conn info as Hono's `env`; it is absent for in-process dispatch.
  const env = c.env as { remoteAddr?: { hostname?: string } } | undefined;
  return env?.remoteAddr?.hostname;
}
