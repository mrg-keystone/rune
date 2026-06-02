import type { Context, MiddlewareHandler } from "#hono";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";
import { TokenError, verifyToken } from "@foundation/domain/business/token/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import type { FirebaseVerifier } from "@foundation/domain/business/firebase-auth/mod.ts";

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
 * Any other (network) request must present, in `Authorization: Bearer <credential>`, EITHER a
 * valid signed access token OR (when a Firebase verifier is configured) a valid Firebase Auth
 * ID token. Either one authorizes the request; otherwise it is rejected with 401. The resolved
 * identity (`source` for a signed token, email/uid for Firebase) is attributed to the request's
 * logs, so register this AFTER the request-logging middleware.
 */
export interface TokenAuthConfig {
  /** The secret signing key (env variable). Empty ⇒ signed tokens cannot be verified. */
  signingKey: string;
  logger: Logger;
  /** Process-private key the in-process client stamps on its requests. Minted at boot. */
  internalKey: string;
  /** Optional Firebase ID token verifier. When set, a valid Firebase token also authorizes. */
  firebaseVerifier?: FirebaseVerifier;
  /**
   * Whether loopback (localhost) callers are trusted without a token. Defaults to true. Set to
   * false (e.g. behind a same-host reverse proxy, or to test the gated path) to require a token
   * even from localhost. The in-process key trust is unaffected.
   */
  trustLocalhost?: boolean;
  /**
   * Path prefixes that bypass auth entirely (public). A prefix matches a request whose path
   * equals it or starts with `prefix + "/"`, e.g. `/docs` exempts the Swagger docs. Matched
   * against the path the handler sees, so a mounted `/api/docs` (prefix stripped by
   * `withBasePath`) is covered by `/docs` too.
   */
  publicPaths?: string[];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function createTokenAuthMiddleware(config: TokenAuthConfig): MiddlewareHandler {
  const { signingKey, logger, internalKey, firebaseVerifier, publicPaths = [] } = config;
  const trustLocalhost = config.trustLocalhost ?? true;

  return async (c, next) => {
    if (isTrustedOrigin(c, internalKey, trustLocalhost)) return next();
    if (isPublicPath(c.req.path, publicPaths)) return next();

    const token = bearer(c.req.header("authorization"));
    if (!token) return unauthorized(c, "Missing credentials.");

    // 1) Signed service token.
    if (signingKey) {
      try {
        const payload = await verifyToken(token, signingKey);
        logger.setSource(payload.source);
        return await next();
      } catch (err) {
        // With no Firebase fallback, report the specific reason; otherwise try Firebase.
        if (!firebaseVerifier) {
          const detail = err instanceof TokenError ? err.message : "Invalid access token.";
          return unauthorized(c, detail);
        }
      }
    }

    // 2) Firebase Auth ID token (e.g. from the browser/frontend).
    if (firebaseVerifier) {
      try {
        const claims = await firebaseVerifier.verify(token);
        logger.setSource(claims.email ?? claims.uid);
        return await next();
      } catch {
        // fall through to the generic rejection
      }
    }

    return unauthorized(c, "Invalid or expired credentials.");
  };
}

/** Extracts the bearer credential from an `Authorization` header value, if present. */
export function extractBearer(header: string | undefined): string | undefined {
  return bearer(header);
}

/**
 * Validates a bearer credential as EITHER a signed access token OR (when a Firebase verifier is
 * configured) a Firebase ID token. Returns the resolved identity (`source`), or null if neither
 * validates. Used by the auth middleware and by the gated docs `/json` endpoint.
 */
export async function validateCredential(
  credential: string,
  opts: { signingKey: string; firebaseVerifier?: FirebaseVerifier },
): Promise<{ source: string } | null> {
  if (opts.signingKey) {
    try {
      const payload = await verifyToken(credential, opts.signingKey);
      return { source: payload.source };
    } catch {
      // try Firebase next
    }
  }
  if (opts.firebaseVerifier) {
    try {
      const claims = await opts.firebaseVerifier.verify(credential);
      return { source: claims.email ?? claims.uid };
    } catch {
      // neither validated
    }
  }
  return null;
}

/**
 * In-process requests (carrying the matching internal key) and localhost callers (loopback
 * peer) are trusted. A network request neither knows the internal key nor reports a loopback
 * peer, so it is never trusted.
 */
export function isTrustedOrigin(
  c: Context,
  internalKey: string,
  trustLocalhost = true,
): boolean {
  const stamped = c.req.header(INTERNAL_REQUEST_HEADER);
  if (stamped !== undefined && safeEqual(stamped, internalKey)) return true;

  if (!trustLocalhost) return false;
  const peer = remoteHostname(c);
  return peer !== undefined && LOOPBACK_HOSTS.has(peer);
}

/** A path is public when it equals a prefix or sits under it (`/docs` ⇒ `/docs`, `/docs/x`). */
function isPublicPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`));
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
