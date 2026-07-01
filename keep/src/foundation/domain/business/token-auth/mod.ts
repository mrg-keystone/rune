import type { Context, MiddlewareHandler } from "#hono";
import { ForbiddenException, UnauthorizedException } from "#danet/core";
import type { Logger } from "@foundation/domain/business/logger/mod.ts";
import {
  type SessionVerifier,
  verifyToken,
} from "@foundation/domain/business/token/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { isPublicContext } from "@foundation/domain/business/public-route/mod.ts";
import {
  DYNAMIC_GRANT_PREFIX,
  requiredDomains,
  requiredGrants,
} from "@foundation/domain/business/grants/mod.ts";

/**
 * Network credential handling for the infra-only trust model. Exactly two things are trusted:
 *
 *  1. the **in-process client** — a request stamped with the process-private internal key (SSR /
 *     BackendClient), which never crosses the network;
 *  2. an **infra-signed session bearer** — verified OFFLINE against infra's published JWKS.
 *
 * There is no localhost bypass, no keep-side minting/exchange, and no direct Firebase verification:
 * a Firebase user logs in at infra (`session.login`) and an opaque token is exchanged at infra
 * (`authz.exchange`); either way the client presents the resulting infra bearer, and keep only
 * verifies it. Everything else is denied.
 *
 * Revocation: when the polled global `revokeAll` flag is ON (break glass), keep stops trusting every
 * cached session bearer and rejects it (401) so the client re-authenticates at infra.
 */

/** @deprecated No fresh bearer is ever minted by keep now; kept only for import stability. */
export const SESSION_BEARER_HEADER = "x-session-bearer";
/** @deprecated Kept for import stability; keep no longer stashes a freshly-minted bearer. */
export const SESSION_BEARER_CONTEXT_KEY = "danet:session-bearer";

export interface TokenAuthConfig {
  /** Offline verifier for infra-signed session bearers (JWKS). */
  verifier?: SessionVerifier;
  logger: Logger;
  /** Process-private key the in-process client stamps on its requests. Minted at boot. */
  internalKey: string;
  /** Reads the polled global revoke-all flag. Default: always false (offline mode). */
  revokeAll?: () => boolean;
  /** Path prefixes that bypass auth entirely (public). */
  publicPaths?: string[];
}

export function createTokenAuthMiddleware(
  config: TokenAuthConfig,
): MiddlewareHandler {
  const { logger, internalKey, publicPaths = [] } = config;
  const revokeAll = config.revokeAll ?? (() => false);

  return async (c, next) => {
    if (isTrustedOrigin(c, internalKey)) return next();
    if (isPublicPath(c.req.path, publicPaths)) return next();

    const credential = bearer(c.req.header("authorization")) ??
      c.req.query("token");
    if (!credential) return unauthorized(c, "Missing credentials.");

    const outcome = await resolveNetworkCredential(credential, {
      verifier: config.verifier,
      revokeAll: revokeAll(),
    });
    if ("error" in outcome) return unauthorized(c, messageFor(outcome.error));

    logger.setSource(outcome.resolved.source);
    return await next();
  };
}

/** Extracts the bearer credential from an `Authorization` header value, if present. */
export function extractBearer(header: string | undefined): string | undefined {
  return bearer(header);
}

export interface CredentialGuardConfig {
  /** This app's name. Grant claims are namespaced per app; the guard scopes to this app. */
  appName: string;
  /** Offline verifier for infra-signed session bearers (JWKS). */
  verifier?: SessionVerifier;
  /** Process-private key identifying in-process (BackendClient) callers. */
  internalKey: string;
  /** Reads the polled global revoke-all flag. Default: always false (offline mode). */
  revokeAll?: () => boolean;
  logger: Logger;
  /**
   * Honor the `*` skeleton key (a `*` grant bypasses required grants/domains). Default true.
   * **infra runs with `honorSkeleton: false`** so `*` never opens the control plane.
   */
  honorSkeleton?: boolean;
}

/**
 * The grants a caller holds on THIS app. infra carries a user's per-app grants as the comma-separated
 * value under the app's own key in the verified claim map (`claims[appName] = "grant1,grant2"`); this
 * returns them trimmed and non-empty. A user with no entry for the app holds no grants here (and, by
 * fail-closed default, reaches only its `@Public` routes).
 */
export function grantsForApp(
  claims: Record<string, string>,
  appName: string,
): string[] {
  return (claims[appName] ?? "")
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g.length > 0);
}

/** A Danet guard: returns true to allow, throws to reject. */
export interface DanetGuard {
  canActivate(context: Context): boolean | Promise<boolean>;
}

/**
 * The global credential guard. Deny-by-default for every controller route. A request is allowed when
 * it is `@Public`, from the in-process client, or carrying a valid infra bearer that also satisfies
 * the route's `@LoggedIn` domain(s) AND `@Grant` grant(s).
 *
 * Authorization is **fail-closed**: a non-`@Public` route with no `@LoggedIn` and no `@Grant` is
 * closed to everyone but the `*` universal grant. `@Grant(...)` is any-of and app-scoped; a dynamic
 * `@Grant("::key")` requires the request's `key` value to be a grant the caller holds. `@LoggedIn`
 * and `@Grant` stack with AND. The `*` grant (honored via `honorSkeleton`) opens everything.
 */
export function createCredentialGuard(
  config: CredentialGuardConfig,
): DanetGuard {
  const honorSkeleton = config.honorSkeleton ?? true;
  const revokeAll = config.revokeAll ?? (() => false);

  return {
    async canActivate(context: Context): Promise<boolean> {
      // deno-lint-ignore no-explicit-any
      const ctx = context as any;
      // WS messages run through a synthetic context; they were gated at the handshake.
      if (ctx.websocketTopic !== undefined) return true;

      const isPublic = isPublicContext(ctx);
      const requiredRaw = requiredGrants(ctx); // @Grant args (may contain `::key`)
      const domains = requiredDomains(ctx); // @LoggedIn domains

      // In-process trust ONLY — no localhost bypass.
      if (isTrustedOrigin(context, config.internalKey)) return true;

      const credential = extractBearer(context.req.header("authorization")) ??
        context.req.query("token");

      let resolved: ResolvedCredential | null = null;
      if (credential) {
        resolved = await validateCredential(credential, { verifier: config.verifier });
        if (resolved) {
          config.logger.setSource(resolved.source);
          const grants = grantsForApp(resolved.claims, config.appName);
          const identity: Identity = {
            creator: resolved.creator,
            source: resolved.source,
            claims: resolved.claims,
            grants,
          };
          if (typeof ctx.set === "function") ctx.set(IDENTITY_CONTEXT_KEY, identity);
        } else if (!isPublic) {
          // Present but unresolvable on a protected route → reject.
          throw new UnauthorizedException();
        }
      }

      // Authentication: every non-@Public route needs a verified credential.
      if (!resolved) {
        if (isPublic) return true;
        throw new UnauthorizedException();
      }

      // Break glass: a cached infra bearer can't be live-checked — reject until re-auth at infra.
      if (revokeAll()) throw new UnauthorizedException();

      // Authorization — FAIL-CLOSED.
      const grants = grantsForApp(resolved.claims, config.appName);
      // `*` universal grant: app-scoped (`app:*` → value "*") OR global bare (`*` → its own claim key).
      if (honorSkeleton && (grants.includes("*") || "*" in resolved.claims)) return true;
      if (isPublic) return true;

      // @LoggedIn AND @Grant — both enforced when present; neither present (non-@Public, no `*`) = closed.
      const hasConstraint = domains.length > 0 || requiredRaw.length > 0;
      if (domains.length > 0 && !creatorInDomains(resolved.creator, domains)) {
        throw new ForbiddenException();
      }
      if (requiredRaw.length > 0) {
        const needed = await resolveGrantArgs(requiredRaw, context);
        if (!needed.some((g) => g !== null && grants.includes(g))) {
          throw new ForbiddenException();
        }
      }
      if (hasConstraint) return true;
      throw new ForbiddenException();
    },
  };
}

/** True when `creator` is an email whose domain is one of `domains` (case-insensitive). */
function creatorInDomains(creator: string, domains: string[]): boolean {
  const at = creator.lastIndexOf("@");
  if (at < 0) return false; // a non-email creator (machine token) is never "logged in"
  const domain = creator.slice(at + 1).toLowerCase();
  return domains.some((d) => d.trim().toLowerCase() === domain);
}

/**
 * Resolve `@Grant` args to the concrete grants a caller must hold: a static arg is itself; a dynamic
 * `::key` arg is the request's value at `key` (path param → query → header → body), or `null` when
 * the key is absent (so it can never satisfy the any-of, i.e. an absent `::key` → deny).
 */
async function resolveGrantArgs(
  args: string[],
  context: Context,
): Promise<Array<string | null>> {
  const out: Array<string | null> = [];
  for (const a of args) {
    if (a.startsWith(DYNAMIC_GRANT_PREFIX)) {
      out.push(await lookupRequestValue(context, a.slice(DYNAMIC_GRANT_PREFIX.length)));
    } else {
      out.push(a);
    }
  }
  return out;
}

/** Find a request value by key: path param → query → header → JSON body. `null` when absent. */
async function lookupRequestValue(
  context: Context,
  key: string,
): Promise<string | null> {
  // deno-lint-ignore no-explicit-any
  const req = context.req as any;
  const param = typeof req?.param === "function" ? req.param(key) : undefined;
  if (typeof param === "string" && param.length > 0) return param;
  const q = typeof req?.query === "function" ? req.query(key) : undefined;
  if (typeof q === "string" && q.length > 0) return q;
  const h = typeof req?.header === "function" ? req.header(key) : undefined;
  if (typeof h === "string" && h.length > 0) return h;
  try {
    // Hono memoizes json()/parseBody(), so reading it here doesn't consume it for the handler.
    const body = typeof req?.json === "function" ? await req.json() : undefined;
    if (body && typeof body === "object") {
      const v = (body as Record<string, unknown>)[key];
      if (typeof v === "string" && v.length > 0) return v;
      if (v !== undefined && v !== null) return String(v);
    }
  } catch { /* no/invalid body */ }
  return null;
}

/** The caller identity resolved from a verified infra bearer. */
export interface Identity {
  /** The identity the bearer authenticates as — a Firebase email, or a token's creator. */
  creator: string;
  /** Attribution label recorded in this app's logs. */
  source: string;
  /** The verified claim map — the authorization surface. */
  claims: Record<string, string>;
  /** Convenience: this app's grants, from `claims[appName]`. */
  grants: string[];
}

/** A resolved credential before it becomes an {@link Identity}. */
export interface ResolvedCredential {
  creator: string;
  source: string;
  claims: Record<string, string>;
}

/**
 * Validates a bearer credential OFFLINE as an infra session bearer (JWKS). Returns `null` when it
 * does not verify. There is no Firebase or opaque path — those are resolved at infra, not keep.
 */
export async function validateCredential(
  credential: string,
  opts: { verifier?: SessionVerifier; now?: number },
): Promise<ResolvedCredential | null> {
  if (!opts.verifier) return null;
  try {
    const p = await verifyToken(credential, opts.verifier, opts.now);
    return { creator: p.creator, source: p.source, claims: p.claims };
  } catch {
    return null;
  }
}

/**
 * Resolves a network credential (an infra session bearer). Returns the resolved identity, or an
 * `error`: `invalid` (unverifiable) or `revoked-bearer` (break-glass revoke-all is on).
 */
export async function resolveNetworkCredential(
  credential: string,
  opts: { verifier?: SessionVerifier; revokeAll: boolean; now?: number },
): Promise<
  { resolved: ResolvedCredential } | { error: "invalid" | "revoked-bearer" }
> {
  const resolved = await validateCredential(credential, {
    verifier: opts.verifier,
    now: opts.now,
  });
  if (!resolved) return { error: "invalid" };
  if (opts.revokeAll) return { error: "revoked-bearer" };
  return { resolved };
}

function messageFor(error: "invalid" | "revoked-bearer"): string {
  switch (error) {
    case "revoked-bearer":
      return "Session bearer not trusted (revoke-all active) — re-authenticate at infra.";
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
 * The ONLY trusted origin: an in-process request carrying the matching internal key (SSR /
 * BackendClient), which never crosses the network. A network request cannot know the key.
 */
export function isTrustedOrigin(c: Context, internalKey: string): boolean {
  const stamped = c.req.header(INTERNAL_REQUEST_HEADER);
  return stamped !== undefined && safeEqual(stamped, internalKey);
}

/**
 * A path is public when it equals a prefix or sits under it (`/docs` ⇒ `/docs`, `/docs/x`).
 * Empty / whitespace-only entries are dropped so an `""` prefix can't open the whole app.
 */
function isPublicPath(path: string, prefixes: string[]): boolean {
  return prefixes.some((raw) => {
    if (raw.trim().length === 0) return false;
    const stripped = raw.endsWith("/") ? raw.slice(0, -1) : raw;
    const p = stripped.length > 0 ? stripped : raw;
    return path === p || path.startsWith(`${p}/`);
  });
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
