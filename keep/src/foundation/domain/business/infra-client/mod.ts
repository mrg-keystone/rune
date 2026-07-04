/**
 * The HTTP client keep uses to talk to **infra** — the signing authority. keep is a verifier that
 * also brokers the credential→bearer exchange on behalf of the server-side session store:
 *
 *  - `GET /authz/jwks` — infra's published Ed25519 public keys, fetched + cached by the verifier.
 *  - `GET /authz/status` — the global break-glass `revokeAll` flag, polled ~every 60s.
 *  - `POST /api/authz/exchange` — swap an opaque infra token for a signed session bearer.
 *  - `POST /api/session/login` — swap a Firebase idToken for a signed session bearer.
 *
 * keep never MINTS or SIGNS (infra holds the key). The two exchange calls exist so keep's session
 * store can hold the ORIGINAL credential and re-exchange it transparently for a fresh bearer when
 * the ~1h one lapses (silent refresh), instead of forcing a re-login. keep still never reads grants
 * beyond what the verified bearer carries. Both exchange paths mirror the same-origin `/auth/*`
 * gateway `serveSprig` proxies today (`{ token }` / `{ idToken, email }` → `{ token: <bearer> }`).
 */

import type {
  InfraJwk,
  InfraJwks,
} from "@foundation/domain/business/token/mod.ts";

/** The global revoke-all status infra exposes (`RevocationStatusDto`). */
export interface RevocationStatus {
  revokeAll: boolean;
  polledAt?: string;
}

/**
 * infra's exchange/login envelope: the signed session bearer, plus the real user profile infra now
 * returns alongside it. `name`/`email` are the user's actual identity (not the bearer's machine
 * `creator`) — an older infra that doesn't return them leaves the fields `undefined`, and the caller
 * falls back to the bearer's `creator`.
 */
export interface AuthExchange {
  /** The signed session bearer. */
  token: string;
  /** The user's real display name, when infra returns one. */
  name?: string;
  /** The user's real email, when infra returns one. */
  email?: string;
}

/** Thrown when an infra call fails. `status` carries the upstream HTTP status. */
export class InfraError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "InfraError";
    this.status = status;
  }
}

export interface InfraClient {
  /** Fetch infra's current JWKS (`GET /authz/jwks`). */
  jwks(): Promise<InfraJwks>;
  /** Read the global revoke-all flag (`GET /authz/status`). */
  revocationStatus(): Promise<RevocationStatus>;
  /**
   * Swap an opaque infra token for a signed session bearer
   * (`POST /api/authz/exchange {token}` → `{ token: <bearer> }`). Throws {@link InfraError} on a
   * non-2xx or a response without a `token`. Used at intake AND for silent refresh (the opaque
   * handle is long-lived, so it can be re-exchanged after the ~1h bearer lapses).
   */
  exchange(token: string): Promise<string>;
  /**
   * Swap a Firebase idToken for a signed session bearer
   * (`POST /api/session/login {idToken,email}` → `{ token: <bearer> }`). Throws {@link InfraError}
   * on a non-2xx or a response without a `token`. Note: a Firebase idToken is itself ~1h-lived, so
   * this cannot silently refresh once the idToken expires — the opaque-token path is the one that
   * survives unattended (kiosk/wallboard) sessions.
   */
  login(idToken: string, email?: string): Promise<string>;
  /**
   * Like {@link exchange}, but also surfaces the real `{ name, email }` infra attaches to the
   * exchange response, so a session can cache a usable profile for a `/auth/me`-style read. Falls
   * back to the bearer alone (name/email `undefined`) on an older infra that returns no profile.
   * Used at intake; silent refresh keeps using {@link exchange} (the bearer alone suffices there).
   */
  exchangeProfile(token: string): Promise<AuthExchange>;
  /** Like {@link login}, returning infra's `{ name, email }` profile alongside the bearer. */
  loginProfile(idToken: string, email?: string): Promise<AuthExchange>;
}

export interface InfraClientConfig {
  /** Base URL of the infra service, e.g. `https://infra.internal`. Trailing slash trimmed. */
  baseUrl: string;
  /** Explicit JWKS URL; defaults to `${baseUrl}/authz/jwks`. */
  jwksUrl?: string;
  /** Override the revocation-status path (default `/authz/status`). */
  revocationPath?: string;
  /** Override the opaque-token exchange path (default `/api/authz/exchange`). */
  exchangePath?: string;
  /** Override the Firebase login path (default `/api/session/login`). */
  loginPath?: string;
  /** Test seam for the network (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
}

/** infra's exchange/login response envelope: `{ token: <signed session bearer> }`. */
const DEFAULT_EXCHANGE_PATH = "/api/authz/exchange";
const DEFAULT_LOGIN_PATH = "/api/session/login";

/** Builds the infra HTTP client. */
export function createInfraClient(config: InfraClientConfig): InfraClient {
  const base = config.baseUrl.replace(/\/+$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const jwksUrl = config.jwksUrl ?? `${base}/authz/jwks`;
  const revocationUrl = `${base}${config.revocationPath ?? "/authz/status"}`;
  const exchangeUrl = `${base}${config.exchangePath ?? DEFAULT_EXCHANGE_PATH}`;
  const loginUrl = `${base}${config.loginPath ?? DEFAULT_LOGIN_PATH}`;

  return {
    async jwks(): Promise<InfraJwks> {
      const res = await getJson(fetchImpl, jwksUrl);
      // infra's JwksDto is `{ JwkKeyDtos: [{ kid, alg, publicKey }] }`.
      const raw = Array.isArray(res.JwkKeyDtos)
        ? res.JwkKeyDtos
        : Array.isArray(res.keys)
        ? res.keys
        : [];
      const keys: InfraJwk[] = [];
      for (const k of raw as Array<Record<string, unknown>>) {
        if (
          k && typeof k.kid === "string" && typeof k.alg === "string" &&
          typeof k.publicKey === "string"
        ) {
          keys.push({ kid: k.kid, alg: k.alg, publicKey: k.publicKey });
        }
      }
      return { keys };
    },

    async revocationStatus(): Promise<RevocationStatus> {
      const res = await getJson(fetchImpl, revocationUrl);
      return {
        revokeAll: res.revokeAll === true,
        polledAt: typeof res.polledAt === "string" ? res.polledAt : undefined,
      };
    },

    async exchange(token: string): Promise<string> {
      return (await envelopeFrom(fetchImpl, exchangeUrl, { token })).token;
    },

    async login(idToken: string, email?: string): Promise<string> {
      return (await envelopeFrom(fetchImpl, loginUrl, {
        idToken,
        email: email ?? "",
      })).token;
    },

    exchangeProfile(token: string): Promise<AuthExchange> {
      return envelopeFrom(fetchImpl, exchangeUrl, { token });
    },

    loginProfile(idToken: string, email?: string): Promise<AuthExchange> {
      return envelopeFrom(fetchImpl, loginUrl, { idToken, email: email ?? "" });
    },
  };
}

/**
 * Read the real `{ name, email }` infra may attach to an exchange/login response. Tolerates a flat
 * envelope (`{ token, name, email }`) or the profile nested under a `user` object; empty strings and
 * non-strings collapse to `undefined` so the caller cleanly falls back to the bearer's `creator`.
 */
function profileFrom(
  parsed: Record<string, unknown>,
): { name?: string; email?: string } {
  const src = parsed.user && typeof parsed.user === "object"
    ? parsed.user as Record<string, unknown>
    : parsed;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  return { name: str(src.name), email: str(src.email) };
}

/**
 * POST a credential body to infra and read the `{ token: <bearer> }` it signs back, plus any real
 * `{ name, email }` profile infra attaches ({@link profileFrom}).
 */
async function envelopeFrom(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
): Promise<AuthExchange> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new InfraError(
      `infra ${url} unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`,
      503,
    );
  }
  if (!res.ok) {
    throw new InfraError(`infra ${url} failed (${res.status}).`, res.status);
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = await res.json() as Record<string, unknown>;
  } catch (err) {
    throw new InfraError(
      `infra ${url} returned invalid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    );
  }
  const bearer = parsed.token;
  if (typeof bearer !== "string" || bearer.length === 0) {
    throw new InfraError(`infra ${url} returned no session bearer.`, 502);
  }
  return { token: bearer, ...profileFrom(parsed) };
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (err) {
    throw new InfraError(
      `infra ${url} unreachable: ${
        err instanceof Error ? err.message : String(err)
      }`,
      503,
    );
  }
  if (!res.ok) {
    throw new InfraError(`infra ${url} failed (${res.status}).`, res.status);
  }
  try {
    return await res.json() as Record<string, unknown>;
  } catch (err) {
    throw new InfraError(
      `infra ${url} returned invalid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
      502,
    );
  }
}
