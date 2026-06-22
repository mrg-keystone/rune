import { importX509, jwtVerify } from "#jose";

/**
 * Verifies Firebase Authentication ID tokens. A Firebase ID token is an RS256 JWT signed by
 * Google; verifying it requires only the project ID (the signature is checked against Google's
 * **public** X.509 certs — no service-account secret is involved). The `aud` claim must equal
 * the project ID and `iss` must be `https://securetoken.google.com/<projectId>`; `exp`/`iat`
 * are enforced by `jose`.
 */

const CERT_URL =
  "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const DEFAULT_CERT_TTL_SECONDS = 3600;

/** The identity carried by a verified Firebase ID token. */
export interface FirebaseClaims {
  /** The Firebase user id (`sub`). */
  uid: string;
  /** The user's email, when present on the token. */
  email?: string;
  /** Roles from custom claims — `roles: string[]` and/or `role: string`, normalized. */
  roles: string[];
}

/** Normalizes role custom claims: accepts a `roles` string array and/or a singular `role`. */
function extractRoles(claims: Record<string, unknown>): string[] {
  const roles: string[] = [];
  if (Array.isArray(claims.roles)) {
    for (const r of claims.roles) if (typeof r === "string") roles.push(r);
  }
  if (typeof claims.role === "string") roles.push(claims.role);
  return roles;
}

/** Thrown when a Firebase ID token is missing, malformed, mis-signed, or expired. */
export class FirebaseAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FirebaseAuthError";
  }
}

export interface FirebaseVerifierOptions {
  /** The Firebase project id; the token's `aud` must match it. */
  projectId: string;
  /**
   * Test/extension seam: resolve the public signing key for a token's `kid`. Defaults to
   * fetching and caching Google's X.509 certs.
   */
  resolveKey?: (kid: string) => Promise<CryptoKey>;
  /** Test seam for the cert fetch (defaults to fetching Google's cert endpoint). */
  fetchCerts?: () => Promise<Response>;
}

export interface FirebaseVerifier {
  verify(idToken: string): Promise<FirebaseClaims>;
}

/** Builds a Firebase ID token verifier for `projectId`. Caches signing keys across calls. */
export function createFirebaseVerifier(
  opts: FirebaseVerifierOptions,
): FirebaseVerifier {
  if (!opts.projectId) {
    throw new FirebaseAuthError("A Firebase project ID is required.");
  }
  const issuer = `https://securetoken.google.com/${opts.projectId}`;
  const resolveKey = opts.resolveKey ??
    defaultResolveKey(opts.fetchCerts ?? (() => fetch(CERT_URL)));

  return {
    async verify(idToken: string): Promise<FirebaseClaims> {
      let claims: Record<string, unknown>;
      try {
        const { payload } = await jwtVerify(
          idToken,
          (header) => {
            if (header.alg !== "RS256") {
              throw new FirebaseAuthError("Unexpected token algorithm.");
            }
            if (!header.kid) {
              throw new FirebaseAuthError("Token has no key id.");
            }
            return resolveKey(header.kid);
          },
          { issuer, audience: opts.projectId },
        );
        claims = payload;
      } catch (err) {
        if (err instanceof FirebaseAuthError) throw err;
        throw new FirebaseAuthError(
          err instanceof Error ? err.message : "Invalid Firebase token.",
        );
      }

      const uid = typeof claims.sub === "string" ? claims.sub : "";
      if (!uid) throw new FirebaseAuthError("Token has no subject (uid).");
      const email = typeof claims.email === "string" ? claims.email : undefined;
      return { uid, email, roles: extractRoles(claims) };
    },
  };
}

/** Fetches and caches Google's X.509 certs, importing the cert matching a token's `kid`. */
function defaultResolveKey(
  fetchCerts: () => Promise<Response>,
): (kid: string) => Promise<CryptoKey> {
  let cache: { keys: Record<string, string>; expiresAt: number } | undefined;

  async function loadCerts(
    now: number,
    force: boolean,
  ): Promise<Record<string, string>> {
    if (!force && cache && cache.expiresAt > now) return cache.keys;
    const res = await fetchCerts();
    if (!res.ok) {
      throw new FirebaseAuthError(
        `Failed to fetch Firebase certificates (${res.status}).`,
      );
    }
    const keys = await res.json() as Record<string, string>;
    const ttl = parseMaxAge(res.headers.get("cache-control")) ??
      DEFAULT_CERT_TTL_SECONDS;
    cache = { keys, expiresAt: now + ttl * 1000 };
    return keys;
  }

  return async (kid) => {
    const now = Date.now();
    let keys = await loadCerts(now, false);
    // An unknown kid may mean the certs rotated since we cached them — refresh once.
    if (!keys[kid]) keys = await loadCerts(now, true);
    const pem = keys[kid];
    if (!pem) throw new FirebaseAuthError("No matching Firebase signing key.");
    return await importX509(pem, "RS256") as CryptoKey;
  };
}

function parseMaxAge(cacheControl: string | null): number | undefined {
  if (!cacheControl) return undefined;
  const match = /max-age=(\d+)/.exec(cacheControl);
  return match ? Number(match[1]) : undefined;
}
