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

    exchange(token: string): Promise<string> {
      return bearerFrom(fetchImpl, exchangeUrl, { token });
    },

    login(idToken: string, email?: string): Promise<string> {
      return bearerFrom(fetchImpl, loginUrl, { idToken, email: email ?? "" });
    },
  };
}

/** POST a credential body to infra and read the `{ token: <bearer> }` it signs back. */
async function bearerFrom(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, string>,
): Promise<string> {
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
  return bearer;
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
