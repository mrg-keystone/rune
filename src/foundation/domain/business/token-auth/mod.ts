import type { Context, MiddlewareHandler } from "#hono";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";
import { TokenError, verifyToken } from "@foundation/domain/business/token/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";

/**
 * Hono middleware that requires a signed access token on every request — EXCEPT requests from
 * a trusted origin, which pass through unauthenticated:
 *
 *  - In-process calls (the `BackendClient` / `backend.post()` syntax). These carry the
 *    process-private internal key in `INTERNAL_REQUEST_HEADER`. The key is minted at boot and
 *    never leaves the process, so a network client cannot forge it — this is the explicit,
 *    separate channel that distinguishes in-process from network traffic.
 *  - Localhost callers (loopback peer address).
 *
 * Any other (network) request must carry a valid, unexpired `Authorization: Bearer <token>`;
 * otherwise it is rejected with 401. A verified token's `source` is attributed to the request's
 * logs, so register this AFTER the request-logging middleware.
 */
export interface TokenAuthConfig {
  /** The secret signing key (env variable). Empty ⇒ no token can be verified, so every
   *  non-trusted request is rejected (fails closed). */
  signingKey: string;
  logger: Logger;
  /** Process-private key the in-process client stamps on its requests. Minted at boot. */
  internalKey: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function createTokenAuthMiddleware(config: TokenAuthConfig): MiddlewareHandler {
  const { signingKey, logger, internalKey } = config;

  return async (c, next) => {
    if (isTrustedOrigin(c, internalKey)) return next();

    const token = bearer(c.req.header("authorization"));
    if (!token) return unauthorized(c, "Missing access token.");

    try {
      const payload = await verifyToken(token, signingKey);
      logger.setSource(payload.source);
      return await next();
    } catch (err) {
      const detail = err instanceof TokenError ? err.message : "Invalid access token.";
      return unauthorized(c, detail);
    }
  };
}

/**
 * In-process requests (carrying the matching internal key) and localhost callers (loopback
 * peer) are trusted. A network request neither knows the internal key nor reports a loopback
 * peer, so it is never trusted.
 */
function isTrustedOrigin(c: Context, internalKey: string): boolean {
  const stamped = c.req.header(INTERNAL_REQUEST_HEADER);
  if (stamped !== undefined && safeEqual(stamped, internalKey)) return true;

  const peer = remoteHostname(c);
  return peer !== undefined && LOOPBACK_HOSTS.has(peer);
}

function remoteHostname(c: Context): string | undefined {
  // Deno.serve passes conn info as Hono's `env`; it is absent for in-process dispatch.
  const env = c.env as { remoteAddr?: { hostname?: string } } | undefined;
  return env?.remoteAddr?.hostname;
}

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1];
}

/** Constant-time string compare so probing the internal-key header can't leak it via timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function unauthorized(c: Context, message: string): Response {
  return c.json({ error: "unauthorized", message }, 401);
}
