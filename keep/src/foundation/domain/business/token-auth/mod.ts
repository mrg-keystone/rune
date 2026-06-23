import type { Context, MiddlewareHandler } from "#hono";
import { ForbiddenException, UnauthorizedException } from "#danet/core";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";
import {
  type SessionVerifier,
  verifyToken,
} from "@foundation/domain/business/token/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import type { FirebaseVerifier } from "@foundation/domain/business/firebase-auth/mod.ts";
import {
  type InfraClient,
  InfraError,
} from "@foundation/domain/business/infra-client/mod.ts";
import { isPublicContext } from "@foundation/domain/business/public-route/mod.ts";
import { requiredRoles } from "@foundation/domain/business/roles/mod.ts";
import { requiredClaims } from "@foundation/domain/business/claims/mod.ts";

/**
 * Network credential handling for the infra-centralized model. A request from a trusted origin
 * (in-process key / localhost) passes through unauthenticated. Every other request must present, in
 * `Authorization: Bearer <credential>` (or `?token=`), ONE of:
 *
 *  1. an **opaque manual token** `mtk_…` — keep calls infra `manualToken.exchange` to trade it for a
 *     signed ~1h session bearer, authorizes from that, and hands the fresh bearer back to the client
 *     (response header) so the client can cache and re-send it;
 *  2. a **session bearer** (infra-signed compact JWT) — verified OFFLINE against infra's JWKS;
 *  3. a **Firebase ID token** — when a Firebase verifier is configured.
 *
 * Revocation: when the polled global `revokeAll` flag is ON (break glass), keep stops trusting
 * cached session bearers and validates every auth live — opaque tokens are re-exchanged each request,
 * and a bare session bearer is rejected (401) so the client re-exchanges its opaque token.
 */

/** `Authorization` header keep writes the freshly-exchanged session bearer to, for the client. */
export const SESSION_BEARER_HEADER = "x-session-bearer";

/** Hono context key under which a freshly-exchanged session bearer is stashed for SSR/handlers. */
export const SESSION_BEARER_CONTEXT_KEY = "danet:session-bearer";

/** Default skeleton (`*`) cap: a `*` token is honored only if minted within this window. */
export const DEFAULT_SKELETON_MAX_AGE_SECONDS = 24 * 60 * 60;

const OPAQUE_PREFIX = "mtk_";

/** True when the credential is an opaque manual token (`mtk_…`) rather than a signed bearer. */
export function isOpaqueToken(credential: string): boolean {
  return credential.startsWith(OPAQUE_PREFIX);
}

export interface TokenAuthConfig {
  /** Offline verifier for infra-signed session bearers (JWKS). */
  verifier?: SessionVerifier;
  logger: Logger;
  /** Process-private key the in-process client stamps on its requests. Minted at boot. */
  internalKey: string;
  /** Optional Firebase ID token verifier. When set, a valid Firebase token also authorizes. */
  firebaseVerifier?: FirebaseVerifier;
  /** infra client for opaque-token exchange (and live re-validation under revokeAll). */
  infraClient?: InfraClient;
  /** Reads the polled global revoke-all flag. Default: always false (offline mode). */
  revokeAll?: () => boolean;
  /** Whether loopback (localhost) callers are trusted without a token. Defaults to true. */
  trustLocalhost?: boolean;
  /** Path prefixes that bypass auth entirely (public). */
  publicPaths?: string[];
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function createTokenAuthMiddleware(
  config: TokenAuthConfig,
): MiddlewareHandler {
  const { logger, internalKey, publicPaths = [] } = config;
  const trustLocalhost = config.trustLocalhost ?? true;
  const revokeAll = config.revokeAll ?? (() => false);

  return async (c, next) => {
    if (isTrustedOrigin(c, internalKey, trustLocalhost)) return next();
    if (isPublicPath(c.req.path, publicPaths)) return next();

    const credential = bearer(c.req.header("authorization")) ??
      c.req.query("token");
    if (!credential) return unauthorized(c, "Missing credentials.");

    const outcome = await resolveNetworkCredential(credential, {
      verifier: config.verifier,
      firebaseVerifier: config.firebaseVerifier,
      infraClient: config.infraClient,
      revokeAll: revokeAll(),
    });
    if ("error" in outcome) return unauthorized(c, messageFor(outcome.error));

    logger.setSource(outcome.resolved.source);
    if (outcome.freshBearer) {
      c.header(SESSION_BEARER_HEADER, outcome.freshBearer);
    }
    return await next();
  };
}

/** Extracts the bearer credential from an `Authorization` header value, if present. */
export function extractBearer(header: string | undefined): string | undefined {
  return bearer(header);
}

export interface CredentialGuardConfig {
  /** This app's name. Role claims are namespaced `appName:role`; the guard scopes to this app. */
  appName: string;
  /** Offline verifier for infra-signed session bearers (JWKS). */
  verifier?: SessionVerifier;
  /** Process-private key identifying in-process (BackendClient) callers. */
  internalKey: string;
  firebaseVerifier?: FirebaseVerifier;
  /** infra client for opaque-token exchange (and live re-validation under revokeAll). */
  infraClient?: InfraClient;
  /** Reads the polled global revoke-all flag. Default: always false (offline mode). */
  revokeAll?: () => boolean;
  logger: Logger;
  /** Whether loopback callers are trusted without a credential. Defaults to true. */
  trustLocalhost?: boolean;
  /**
   * Honor the `*` skeleton key (a `*` role claim bypasses required claims). Default true.
   * **infra runs with `honorSkeleton: false`** so `*` never opens the control plane.
   */
  honorSkeleton?: boolean;
  /** Max age of a `*` token for it to be honored as skeleton. Default 24h. */
  skeletonMaxAgeSeconds?: number;
}

/**
 * Scopes namespaced `appName:role` claims to this app, returning the bare role names.
 *
 * Hardening: an empty bare role is dropped. A claim that is exactly the app prefix (e.g. `"test:"`)
 * slices to `""`; left in, that empty remainder could spuriously satisfy a mis-typed `@Roles("")` /
 * `@claims([""])` (the `required.some((r) => scoped.includes(r))` check would match `"" === ""`) and
 * would also leak onto the resolved identity. No legitimate role is named `""`, so filtering empty
 * remainders changes nothing for any real, non-empty role.
 */
export function scopeRoles(roles: string[], appName: string): string[] {
  const prefix = `${appName}:`;
  return roles
    .filter((r) => r.startsWith(prefix))
    .map((r) => r.slice(prefix.length))
    .filter((r) => r.length > 0);
}

/** Splits the comma-separated `role` claim into trimmed, non-empty namespaced role entries. */
export function rolesFromClaims(claims: Record<string, string>): string[] {
  return (claims.role ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
}

/** A Danet guard: returns true to allow, throws to reject. */
export interface DanetGuard {
  canActivate(context: Context): boolean | Promise<boolean>;
}

/**
 * The global credential guard. Deny-by-default for every controller route, with `@Public()` as the
 * only opt-out. A request is allowed when it is `@Public` (credential optional), from a trusted
 * origin, or carrying a valid credential that also satisfies the route's required claims.
 *
 * Authorization is claims-based: `@claims([...])` and `@Roles(...)` both contribute an ANY-of list
 * matched against the caller's app-scoped role claims. The `*` skeleton key bypasses the list when
 * honored (config `honorSkeleton`, and only within the 24h mint-age cap).
 */
export function createCredentialGuard(
  config: CredentialGuardConfig,
): DanetGuard {
  const trustLocalhost = config.trustLocalhost ?? true;
  const honorSkeleton = config.honorSkeleton ?? true;
  const skeletonMaxAge = config.skeletonMaxAgeSeconds ??
    DEFAULT_SKELETON_MAX_AGE_SECONDS;
  const revokeAll = config.revokeAll ?? (() => false);

  return {
    async canActivate(context: Context): Promise<boolean> {
      // deno-lint-ignore no-explicit-any
      const ctx = context as any;
      // WS messages run through a synthetic context; they were gated at the handshake.
      if (ctx.websocketTopic !== undefined) return true;

      const isPublic = isPublicContext(ctx);
      // `@claims` and `@Roles` both authorize ANY-of against the caller's scoped role claims.
      const required = [...requiredClaims(ctx), ...requiredRoles(ctx)];

      if (isTrustedOrigin(context, config.internalKey, trustLocalhost)) {
        return true;
      }

      const credential = extractBearer(context.req.header("authorization")) ??
        context.req.query("token");

      let resolved: ResolvedCredential | null = null;
      if (credential) {
        const outcome = await resolveNetworkCredential(credential, {
          verifier: config.verifier,
          firebaseVerifier: config.firebaseVerifier,
          infraClient: config.infraClient,
          revokeAll: revokeAll(),
        });
        if ("error" in outcome) {
          // Present but unresolvable on a protected route → reject (public routes ignore it).
          if (!isPublic) throw new UnauthorizedException();
        } else {
          resolved = outcome.resolved;
          config.logger.setSource(resolved.source);
          const scoped = scopeRoles(
            rolesFromClaims(resolved.claims),
            config.appName,
          );
          const identity: Identity = {
            source: resolved.source,
            claims: resolved.claims,
            roles: scoped,
          };
          if (typeof ctx.set === "function") {
            ctx.set(IDENTITY_CONTEXT_KEY, identity);
          }
          if (outcome.freshBearer) {
            if (typeof ctx.set === "function") {
              ctx.set(SESSION_BEARER_CONTEXT_KEY, outcome.freshBearer);
            }
            if (typeof context.header === "function") {
              context.header(SESSION_BEARER_HEADER, outcome.freshBearer);
            }
          }
        }
      }

      // Authentication: a credential is required unless @Public — and a required-claims route always
      // needs one (claims can't be checked without a verified identity).
      if (!resolved) {
        if (required.length > 0 || !isPublic) throw new UnauthorizedException();
        return true;
      }

      // Authorization. Skeleton `*` bypasses the required list when honored and within the cap.
      const rawRoles = rolesFromClaims(resolved.claims);
      const scoped = scopeRoles(rawRoles, config.appName);
      if (
        honorSkeleton && hasSkeleton(rawRoles, scoped) &&
        skeletonFresh(resolved.mintedAt, skeletonMaxAge)
      ) {
        return true;
      }
      if (required.length === 0) return true; // any authenticated identity
      if (required.some((r) => scoped.includes(r))) return true;
      throw new ForbiddenException();
    },
  };
}

/** True when the caller holds the `*` skeleton key (bare, or scoped `<app>:*`). */
function hasSkeleton(rawRoles: string[], scopedRoles: string[]): boolean {
  return rawRoles.includes("*") || scopedRoles.includes("*");
}

/**
 * Whether a `*` token is fresh enough to honor. The cap needs the original mint time (carried as a
 * claim in the session bearer). If it is absent we **fail closed** — an undatable `*` is not honored.
 */
function skeletonFresh(
  mintedAt: number | undefined,
  maxAgeSeconds: number,
  now: number = Math.floor(Date.now() / 1000),
): boolean {
  if (typeof mintedAt !== "number") return false;
  return now - mintedAt <= maxAgeSeconds;
}

/** The caller identity resolved from a verified credential. */
export interface Identity {
  source: string;
  /** The verified claim map — the authorization surface. */
  claims: Record<string, string>;
  /** Convenience: this app's scoped (bare) role names, derived from `claims.role`. */
  roles: string[];
}

/** A resolved credential before it becomes an {@link Identity} (carries the credential kind). */
export interface ResolvedCredential {
  source: string;
  claims: Record<string, string>;
  /** Original mint time (Unix seconds), when carried — gates the `*` 24h cap. */
  mintedAt?: number;
  /** How the credential authenticated. */
  kind: "session" | "firebase";
}

/**
 * Validates a bearer credential OFFLINE as either an infra session bearer (JWKS) or a Firebase ID
 * token. Does NOT exchange opaque tokens — that is `resolveNetworkCredential`'s job. Used by the
 * gated docs `/json` endpoint and internally by the guard/middleware.
 */
export async function validateCredential(
  credential: string,
  opts: {
    verifier?: SessionVerifier;
    firebaseVerifier?: FirebaseVerifier;
    now?: number;
  },
): Promise<ResolvedCredential | null> {
  if (opts.verifier) {
    try {
      const p = await verifyToken(credential, opts.verifier, opts.now);
      return {
        source: p.source,
        claims: p.claims,
        mintedAt: p.mintedAt,
        kind: "session",
      };
    } catch {
      // try Firebase next
    }
  }
  if (opts.firebaseVerifier) {
    try {
      const claims = await opts.firebaseVerifier.verify(credential);
      return {
        // Fall back to a fixed label so attribution is never blank.
        source: claims.email ?? claims.uid ?? "firebase-user",
        // Unify onto the claim surface: roles become the comma-separated `role` claim.
        claims: { role: claims.roles.join(",") },
        kind: "firebase",
      };
    } catch {
      // neither validated
    }
  }
  return null;
}

/**
 * Resolves a network credential of any kind, performing the live exchange for opaque tokens.
 * Returns the resolved identity (and, for an opaque token, the fresh bearer to hand back), or an
 * `error` discriminating the failure for the 401 message.
 */
export async function resolveNetworkCredential(
  credential: string,
  opts: {
    verifier?: SessionVerifier;
    firebaseVerifier?: FirebaseVerifier;
    infraClient?: InfraClient;
    revokeAll: boolean;
    now?: number;
  },
): Promise<
  | { resolved: ResolvedCredential; freshBearer?: string }
  | { error: "exchange" | "invalid" | "revoked-bearer" }
> {
  if (isOpaqueToken(credential)) {
    if (!opts.infraClient) return { error: "invalid" };
    let freshBearer: string;
    try {
      // Always a live infra call — so opaque tokens satisfy revokeAll mode by construction.
      freshBearer = await opts.infraClient.exchange(credential);
    } catch (err) {
      // 404 (revoked/unknown) / 410 (expired) / unreachable → 401 to the client.
      if (err instanceof InfraError) return { error: "exchange" };
      return { error: "exchange" };
    }
    const resolved = await validateCredential(freshBearer, {
      verifier: opts.verifier,
      now: opts.now,
    });
    if (!resolved) return { error: "invalid" };
    return { resolved, freshBearer };
  }

  const resolved = await validateCredential(credential, {
    verifier: opts.verifier,
    firebaseVerifier: opts.firebaseVerifier,
    now: opts.now,
  });
  if (!resolved) return { error: "invalid" };
  // Break glass: a cached infra session bearer can't be live-checked — force a re-exchange.
  // (Firebase tokens are a separate, independently-verified source and stay trusted.)
  if (opts.revokeAll && resolved.kind === "session") {
    return { error: "revoked-bearer" };
  }
  return { resolved };
}

function messageFor(error: "exchange" | "invalid" | "revoked-bearer"): string {
  switch (error) {
    case "exchange":
      return "Token exchange failed (revoked, unknown, or expired).";
    case "revoked-bearer":
      return "Session bearer not trusted (revoke-all active) — re-exchange your token.";
    default:
      return "Invalid or expired credentials.";
  }
}

/** Hono context key under which the resolved {@link Identity} is stored by the guard. */
export const IDENTITY_CONTEXT_KEY = "danet:identity";

/** Reads the caller {@link Identity} the guard attached to the context, if any. */
// deno-lint-ignore no-explicit-any
export function getIdentity(context: any): Identity | undefined {
  return typeof context?.get === "function"
    ? context.get(IDENTITY_CONTEXT_KEY)
    : undefined;
}

/**
 * In-process requests (carrying the matching internal key) and localhost callers (loopback peer)
 * are trusted. A network request neither knows the internal key nor reports a loopback peer.
 */
export function isTrustedOrigin(
  c: Context,
  internalKey: string,
  trustLocalhost = true,
): boolean {
  const stamped = c.req.header(INTERNAL_REQUEST_HEADER);
  if (stamped !== undefined && safeEqual(stamped, internalKey)) return true;

  // ⚠️ FOOTGUN: with trustLocalhost (default true) ANY loopback peer is trusted with no token.
  // Behind a SAME-HOST reverse proxy every forwarded request arrives over loopback and is thus
  // auth-exempt. Expose the app directly, or set TRUST_LOCALHOST=false when fronted by a local proxy.
  return trustLocalhost && isLoopbackRequest(c);
}

/**
 * True only when the connecting socket is a loopback address. Unlike the in-process key (a header),
 * this comes from the real TCP peer and cannot be set by a network client.
 */
export function isLoopbackRequest(c: Context): boolean {
  const peer = remoteHostname(c);
  return peer !== undefined && LOOPBACK_HOSTS.has(peer);
}

/**
 * A path is public when it equals a prefix or sits under it (`/docs` ⇒ `/docs`, `/docs/x`).
 *
 * Hardening: empty / whitespace-only entries are dropped — an `""` prefix would otherwise make
 * `path.startsWith("/")` true for EVERY route and open the whole app (a real footgun for an
 * integrator doing `publicPaths: env.split(",")` with an accidental empty entry). A single trailing
 * slash is normalized so a mis-typed `"/docs/"` matches like the documented `"/docs"` (a lone `"/"`
 * is preserved so a root-only public entry behaves exactly as before). Matching for every legitimate
 * non-empty prefix is otherwise unchanged.
 */
function isPublicPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((raw) => {
    if (raw.trim().length === 0) return false;
    const stripped = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const p = stripped.length > 0 ? stripped : raw;
    return path === p || path.startsWith(`${p}/`);
  });
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
