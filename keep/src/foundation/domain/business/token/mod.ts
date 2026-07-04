/**
 * Session-bearer verification.
 *
 * keep never MINTS or SIGNS — infra does. infra holds the Ed25519 private key and, at each
 * `authz.exchange` (opaque token → bearer) or `session.login` (Firebase user → bearer), emits a
 * short-lived (~1h) **signed session bearer**. That bearer is NOT a JWT — it is infra's canonical
 * envelope: a JSON object
 *
 *   { creator, source, sessionExpiry, claims: [{ key, value }], signature, kid }
 *
 * where `signature` is a DETACHED Ed25519 signature over `canonicalize({creator, source,
 * sessionExpiry, claims})` (claims sorted by key). keep verifies it **offline** against infra's
 * published public keys (JWKS) — no shared secret, no minting, nothing to leak. `kid` selects the
 * key; infra can rotate with zero downtime because retired public keys stay published until their
 * bearers expire.
 *
 * The canonicalization here MUST match infra's signer byte-for-byte (see infra
 * `server/src/core/data/signer/mod.ts` `canonicalize`). Any change is a wire-format break.
 */

/** The decoded, verified session bearer — the ~1h credential keep authorizes requests from. */
export interface SessionBearerPayload {
  /** Always `"infra"` — the issuer keep trusts. */
  iss: string;
  /** The identity the bearer authenticates as — a Firebase email, or a token's creator. */
  creator: string;
  /** Attribution label recorded in this app's logs (e.g. `infra-login`, `my-app`). */
  source: string;
  /** The verified per-app grant map: `{ appName: "grant1,grant2" }` (comma-separated values). */
  claims: Record<string, string>;
  /** Unix epoch SECONDS after which this offline-valid bearer lapses (~1h out). */
  sessionExp: number;
}

/** infra's signed session-bearer envelope, as it arrives on the wire (before verification). */
interface BearerEnvelope {
  creator: string;
  source: string;
  sessionExpiry: string; // ISO-8601
  claims: Array<{ key: string; value: string }>;
  signature: string; // base64url detached Ed25519 signature
  kid: string; // key-selection hint (NOT signed)
}

/** Thrown when a session bearer is malformed, mis-signed, expired, or fails its claim checks. */
export class TokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenError";
  }
}

/** One public verification key as published by infra's `authz.jwks` (`JwkKeyDto`). */
export interface InfraJwk {
  /** Identifier of the signing key — the bearer's `kid` selects it. */
  kid: string;
  /** Signing algorithm the key material is for — `"EdDSA"`. */
  alg: string;
  /** Public key material — the raw Ed25519 public key (the JWK `x`), base64url. */
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
  /** Test/extension seam: import a JWK's public key into a `CryptoKey`. */
  importKey?: (jwk: InfraJwk) => Promise<CryptoKey>;
  /** Test seam for the wall clock (ms). Defaults to `Date.now`. */
  now?: () => number;
}

const DEFAULT_JWKS_TTL_SECONDS = 600;
const encoder = new TextEncoder();

/**
 * Builds a JWKS-backed session-bearer verifier. The fetched key set is cached for
 * `cacheTtlSeconds`; an unknown `kid` triggers a single forced refresh (keys may have rotated).
 */
export function createJwksVerifier(opts: JwksVerifierOptions): SessionVerifier {
  const ttlMs = (opts.cacheTtlSeconds ?? DEFAULT_JWKS_TTL_SECONDS) * 1000;
  const nowMs = opts.now ?? (() => Date.now());
  const importKey = opts.importKey ?? defaultImportKey;

  let cache: { keys: Map<string, InfraJwk>; expiresAt: number } | undefined;
  // The single in-flight fetch, shared by every concurrent caller so a cold start (or an unknown
  // kid that forces a refresh) fires exactly one fetchJwks instead of a thundering herd.
  let inflight: Promise<Map<string, InfraJwk>> | undefined;

  async function load(force: boolean): Promise<Map<string, InfraJwk>> {
    if (!force && cache && cache.expiresAt > nowMs()) return cache.keys;
    if (inflight) return inflight;
    inflight = (async () => {
      let jwks: InfraJwks;
      try {
        jwks = await opts.fetchJwks();
      } catch (err) {
        throw new TokenError(
          `Could not fetch infra JWKS: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      const keys = new Map<string, InfraJwk>();
      for (const k of jwks?.keys ?? []) {
        if (k && typeof k.kid === "string") keys.set(k.kid, k);
      }
      cache = { keys, expiresAt: nowMs() + ttlMs };
      return keys;
    })();
    try {
      return await inflight;
    } finally {
      inflight = undefined;
    }
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
      const env = parseEnvelope(bearer);
      const key = await keyFor(env.kid);

      let ok: boolean;
      try {
        ok = await crypto.subtle.verify(
          "Ed25519",
          key,
          fromBase64url(env.signature),
          encoder.encode(canonicalize(env)),
        );
      } catch (err) {
        throw new TokenError(
          err instanceof Error ? err.message : "Invalid session bearer signature.",
        );
      }
      if (!ok) throw new TokenError("Session bearer signature does not verify.");

      const sessionExp = isoToEpochSeconds(env.sessionExpiry);
      if (sessionExp === undefined) {
        throw new TokenError("Session bearer has an invalid `sessionExpiry`.");
      }
      if (sessionExp <= now) throw new TokenError("Session bearer expired.");

      return {
        iss: "infra",
        creator: env.creator,
        source: env.source,
        claims: claimsToMap(env.claims),
        sessionExp,
      };
    },
  };
}

/**
 * Verifies a session bearer with a {@link SessionVerifier} (offline, against infra's JWKS).
 * There is no shared secret in keep — infra signs, keep only verifies.
 */
export function verifyToken(
  bearer: string,
  verifier: SessionVerifier,
  now?: number,
): Promise<SessionBearerPayload> {
  return verifier.verify(bearer, now);
}

/**
 * Parse the wire bearer into infra's envelope. Accepts either the raw JSON envelope or a
 * base64url(JSON) encoding of it (header-safe transport), then validates every field is present
 * and well-typed — a bearer missing a field is rejected before any crypto runs.
 */
function parseEnvelope(bearer: string): BearerEnvelope {
  const trimmed = (bearer ?? "").trim();
  if (!trimmed) throw new TokenError("Empty session bearer.");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    try {
      raw = JSON.parse(new TextDecoder().decode(fromBase64url(trimmed)));
    } catch {
      throw new TokenError("Session bearer is not a valid infra envelope.");
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TokenError("Session bearer is not an object.");
  }
  const o = raw as Record<string, unknown>;
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== "string" || v === "") {
      throw new TokenError(`Session bearer missing \`${k}\`.`);
    }
    return v;
  };
  const claims = o.claims;
  if (!Array.isArray(claims)) {
    throw new TokenError("Session bearer `claims` must be an array.");
  }
  const parsedClaims = claims.map((c, i) => {
    if (!c || typeof c !== "object") {
      throw new TokenError(`Session bearer claim[${i}] is malformed.`);
    }
    const cc = c as Record<string, unknown>;
    if (typeof cc.key !== "string") {
      throw new TokenError(`Session bearer claim[${i}] has no \`key\`.`);
    }
    return { key: cc.key, value: typeof cc.value === "string" ? cc.value : String(cc.value ?? "") };
  });
  return {
    creator: str("creator"),
    source: str("source"),
    sessionExpiry: str("sessionExpiry"),
    claims: parsedClaims,
    signature: str("signature"),
    kid: str("kid"),
  };
}

/**
 * Reconstruct the EXACT bytes infra signed: a stable JSON serialization of
 * `{ creator, source, sessionExpiry, claims }` with claims sorted by key. This MUST match infra's
 * signer `canonicalize` byte-for-byte — top-level key order and the claim sort are load-bearing.
 */
function canonicalize(env: BearerEnvelope): string {
  const claims = env.claims
    .map((c) => ({ key: c.key, value: c.value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify({
    creator: env.creator,
    source: env.source,
    sessionExpiry: env.sessionExpiry,
    claims,
  });
}

/** Project the verified claim array into a per-app map: `[{key,value}]` → `{ key: value }`. */
function claimsToMap(claims: Array<{ key: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of claims) out[c.key] = c.value;
  return out;
}

/** Parse an ISO-8601 (or epoch-seconds string) into Unix seconds, or undefined. */
function isoToEpochSeconds(value: string): number | undefined {
  if (/^-?\d+$/.test(value)) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.floor(n) : undefined;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Import infra's published public key (raw base64url Ed25519 `x`) as a verify-only CryptoKey. */
function defaultImportKey(jwk: InfraJwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "jwk",
    { kty: "OKP", crv: "Ed25519", x: jwk.publicKey?.trim() ?? "" },
    { name: "Ed25519" },
    false,
    ["verify"],
  ) as Promise<CryptoKey>;
}

function fromBase64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
