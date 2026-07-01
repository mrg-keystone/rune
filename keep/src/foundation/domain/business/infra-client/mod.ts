/**
 * The HTTP client keep uses to talk to **infra** — the signing authority. keep is a pure verifier,
 * so it calls exactly two PUBLIC infra endpoints, both cached/polled (never per-request):
 *
 *  - `GET /authz/jwks` — infra's published Ed25519 public keys, fetched + cached by the verifier.
 *  - `GET /authz/status` — the global break-glass `revokeAll` flag, polled ~every 60s.
 *
 * keep never mints, exchanges, or reads grants — clients get their bearer from infra directly
 * (`authz.exchange` for tokens, `session.login` for Firebase users) and present it to keep.
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
}

export interface InfraClientConfig {
  /** Base URL of the infra service, e.g. `https://infra.internal`. Trailing slash trimmed. */
  baseUrl: string;
  /** Explicit JWKS URL; defaults to `${baseUrl}/authz/jwks`. */
  jwksUrl?: string;
  /** Override the revocation-status path (default `/authz/status`). */
  revocationPath?: string;
  /** Test seam for the network (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
}

/** Builds the infra HTTP client. */
export function createInfraClient(config: InfraClientConfig): InfraClient {
  const base = config.baseUrl.replace(/\/+$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const jwksUrl = config.jwksUrl ?? `${base}/authz/jwks`;
  const revocationUrl = `${base}${config.revocationPath ?? "/authz/status"}`;

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
  };
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
      `infra ${url} unreachable: ${err instanceof Error ? err.message : String(err)}`,
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
      `infra ${url} returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
}
