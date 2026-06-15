/**
 * Session-bearer verification.
 *
 * keep no longer MINTS tokens — infra does. infra holds the private key, mints opaque manual
 * tokens (`mtk_…`), and at each exchange signs a short-lived (~1h) **session bearer**: a compact
 * JWT carrying `{ iss:"infra", creator, source, claims, sessionExp }`, with the signing key's
 * `kid` in the header. keep only ever VERIFIES that bearer, **offline**, against infra's published
 * public keys (JWKS) — no shared secret, no minting, nothing to leak.
 *
 * The verification is JWKS-/`alg`-driven: the algorithm is taken from the matched JWK, so keep
 * works whether infra signs with RS256 or EdDSA (Ed25519). Selecting the key by `kid` means infra
 * can rotate its active key with zero downtime — bearers signed by a still-published previous key
 * keep verifying.
 */

import { importJWK, importSPKI, type JWTPayload, jwtVerify } from "#jose";

/** The decoded, verified session bearer — the 1h credential keep authorizes requests from. */
export interface SessionBearerPayload {
  /** Always `"infra"` — the issuer keep trusts. */
  iss: string;
  /** The userId the token authenticates as (replaces the old identity-by-`source`). */
  creator: string;
  /** Attribution label recorded in this app's logs. */
  source: string;
  /** The verified claim map. The `role` claim is a comma-separated list of `appName:role`. */
  claims: Record<string, string>;
  /** Unix epoch SECONDS after which this offline-valid session bearer lapses (~1h out). */
  sessionExp: number;
  /** Unix epoch SECONDS when the original opaque token was minted — gates the `*` 24h skeleton cap. */
  mintedAt?: number;
}

/** Thrown when a session bearer is malformed, mis-signed, expired, or fails its claim checks. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/** One public verification key as published by infra's `keys.jwks` (`JwkKeyDto`). */
export interface InfraJwk {
  /** Identifier of the signing key — the bearer's header `kid` selects it. */
  kid: string;
  /** Signing algorithm the key material is for (e.g. `RS256`, `EdDSA`). */
  alg: string;
  /** Public key material — SPKI PEM, or a JSON-encoded JWK. */
  publicKey: string;
}

/** infra's published key set (`JwksDto`). */
export interface InfraJwks {
  keys: InfraJwk[];
}

/** Verifies a session bearer offline against infra's JWKS. */
export interface SessionVerifier {
  verify(bearer: string, now?: number): Promise<SessionBearerPayload>;
}

export interface JwksVerifierOptions {
  /** Fetches infra's current JWKS. Typically `infraClient.jwks`. */
  fetchJwks: () => Promise<InfraJwks>;
  /** How long a fetched JWKS is trusted before refetching. Default 600s (10m). */
  cacheTtlSeconds?: number;
  /** The expected `iss` claim. Default `"infra"`. */
  issuer?: string;
  /** Test/extension seam: import a JWK's public key into a `CryptoKey`. */
  importKey?: (jwk: InfraJwk) => Promise<CryptoKey>;
  /** Test seam for the wall clock (ms). Defaults to `Date.now`. */
  now?: () => number;
}

const DEFAULT_JWKS_TTL_SECONDS = 600;

/**
 * Builds a JWKS-backed session-bearer verifier. The fetched key set is cached for
 * `cacheTtlSeconds`; an unknown `kid` triggers a single forced refresh (keys may have rotated).
 */
export function createJwksVerifier(opts: JwksVerifierOptions): SessionVerifier {
  const issuer = opts.issuer ?? "infra";
  const ttlMs = (opts.cacheTtlSeconds ?? DEFAULT_JWKS_TTL_SECONDS) * 1000;
  const nowMs = opts.now ?? (() => Date.now());
  const importKey = opts.importKey ?? defaultImportKey;

  let cache: { keys: Map<string, InfraJwk>; expiresAt: number } | undefined;

  async function load(force: boolean): Promise<Map<string, InfraJwk>> {
    if (!force && cache && cache.expiresAt > nowMs()) return cache.keys;
    let jwks: InfraJwks;
    try {
      jwks = await opts.fetchJwks();
    } catch (err) {
      throw new TokenError(
        `Could not fetch infra JWKS: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const keys = new Map<string, InfraJwk>();
    for (const k of jwks?.keys ?? []) {
      if (k && typeof k.kid === "string") keys.set(k.kid, k);
    }
    cache = { keys, expiresAt: nowMs() + ttlMs };
    return keys;
  }

  async function keyFor(kid: string): Promise<CryptoKey> {
    let keys = await load(false);
    let jwk = keys.get(kid);
    if (!jwk) {
      // Unknown kid may mean the keys rotated since we cached them — refresh once.
      keys = await load(true);
      jwk = keys.get(kid);
    }
    if (!jwk) throw new TokenError("No matching infra signing key for token.");
    return importKey(jwk);
  }

  return {
    async verify(
      bearer: string,
      now: number = Math.floor(nowMs() / 1000),
    ): Promise<SessionBearerPayload> {
      let payload: JWTPayload;
      try {
        const verified = await jwtVerify(
          bearer,
          (header) => {
            if (!header.kid) throw new TokenError("Token has no key id.");
            return keyFor(header.kid);
          },
          { issuer },
        );
        payload = verified.payload;
      } catch (err) {
        if (err instanceof TokenError) throw err;
        throw new TokenError(
          err instanceof Error ? err.message : "Invalid session bearer.",
        );
      }
      return toSessionPayload(payload, now);
    },
  };
}

/**
 * Verifies a session bearer with a {@link SessionVerifier} (offline, against infra's JWKS).
 * Re-keyed from the old HS256 `verifyToken(token, key)`: there is no shared secret in keep now.
 */
export function verifyToken(
  bearer: string,
  verifier: SessionVerifier,
  now?: number,
): Promise<SessionBearerPayload> {
  return verifier.verify(bearer, now);
}

/** Validates and narrows a verified JWT payload into a {@link SessionBearerPayload}. */
function toSessionPayload(
  payload: JWTPayload,
  now: number,
): SessionBearerPayload {
  const creator = payload.creator;
  const source = payload.source;
  if (typeof creator !== "string" || creator === "") {
    throw new TokenError("Session bearer missing `creator`.");
  }
  if (typeof source !== "string" || source === "") {
    throw new TokenError("Session bearer missing `source`.");
  }
  // `sessionExp` is keep's own lifetime field (Unix seconds); `exp` (which jose already enforced)
  // may mirror it. Accept either, prefer the explicit `sessionExp`.
  const rawExp = typeof payload.sessionExp === "number"
    ? payload.sessionExp
    : payload.exp;
  if (typeof rawExp !== "number") {
    throw new TokenError("Session bearer missing `sessionExp`.");
  }
  if (rawExp <= now) throw new TokenError("Session bearer expired.");

  const claims = normalizeClaims(payload.claims);
  const mintedAt = typeof payload.mintedAt === "number"
    ? payload.mintedAt
    : isoToEpochSeconds(claims.mintedAt ?? claims.createdAt);

  return {
    iss: typeof payload.iss === "string" ? payload.iss : "infra",
    creator,
    source,
    claims,
    sessionExp: rawExp,
    ...(mintedAt !== undefined ? { mintedAt } : {}),
  };
}

/** Coerces the bearer's `claims` to a string→string map (claim values are string-encoded). */
function normalizeClaims(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

/** Parses an ISO-8601 (or epoch-seconds string) into Unix seconds, or undefined. */
function isoToEpochSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  if (!Number.isNaN(ms)) return Math.floor(ms / 1000);
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : undefined;
}

/** Imports a JWK's `publicKey` — SPKI PEM first, then a JSON-encoded JWK — for its `alg`. */
async function defaultImportKey(jwk: InfraJwk): Promise<CryptoKey> {
  const material = jwk.publicKey?.trim() ?? "";
  if (material.startsWith("-----BEGIN")) {
    return await importSPKI(material, jwk.alg) as CryptoKey;
  }
  try {
    const parsed = JSON.parse(material);
    return await importJWK(parsed, jwk.alg) as CryptoKey;
  } catch {
    // Not JSON — fall back to treating it as bare SPKI material.
    return await importSPKI(material, jwk.alg) as CryptoKey;
  }
}
