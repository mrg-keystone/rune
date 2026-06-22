/**
 * The HTTP client keep uses to talk to **infra** — the minting + signing authority. keep calls
 * exactly three infra REQs:
 *
 *  - `manualToken.exchange({ token })` — trade an opaque manual token (`mtk_…`) for a signed ~1h
 *    session bearer. The ONLY call to infra per credential (then keep verifies offline).
 *  - `keys.jwks()` — infra's published public keys, fetched + cached by the JWKS verifier.
 *  - `revocation.status()` — the global break-glass `revokeAll` flag, polled ~every 60s.
 *
 * keep never calls `manualToken.mint` / `.revoke` / `revocation.setAll` — those are operator/admin
 * actions in the infra UI.
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
 * Thrown when an infra call fails. `status` carries the upstream HTTP status so the caller can map
 * it: a `manualToken.exchange` 404 (revoked/unknown token) or 410 (lifetime expired) becomes a 401
 * to the client.
 */
export class InfraError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "InfraError";
    this.status = status;
  }
}

export interface InfraClient {
  /** Exchange an opaque manual token for a signed session bearer (compact JWT string). */
  exchange(opaqueToken: string): Promise<string>;
  /** Fetch infra's current JWKS. */
  jwks(): Promise<InfraJwks>;
  /** Read the global revoke-all flag. */
  revocationStatus(): Promise<RevocationStatus>;
}

export interface InfraClientConfig {
  /** Base URL of the infra service, e.g. `https://infra.internal`. Trailing slash trimmed. */
  baseUrl: string;
  /** Explicit JWKS URL; defaults to `${baseUrl}/keys/jwks`. */
  jwksUrl?: string;
  /** Override the exchange path (default `/manualToken/exchange`). */
  exchangePath?: string;
  /** Override the revocation-status path (default `/revocation/status`). */
  revocationPath?: string;
  /** Test seam for the network (defaults to global `fetch`). */
  fetchImpl?: typeof fetch;
}

/** Builds the infra HTTP client. */
export function createInfraClient(config: InfraClientConfig): InfraClient {
  const base = config.baseUrl.replace(/\/+$/, "");
  const fetchImpl = config.fetchImpl ?? fetch;
  const jwksUrl = config.jwksUrl ?? `${base}/keys/jwks`;
  const exchangeUrl = `${base}${
    config.exchangePath ?? "/manualToken/exchange"
  }`;
  const revocationUrl = `${base}${
    config.revocationPath ?? "/revocation/status"
  }`;

  return {
    async exchange(opaqueToken: string): Promise<string> {
      let res: Response;
      try {
        res = await fetchImpl(exchangeUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: opaqueToken }),
        });
      } catch (err) {
        throw new InfraError(
          `infra exchange unreachable: ${
            err instanceof Error ? err.message : String(err)
          }`,
          503,
        );
      }
      if (!res.ok) {
        // 404 = revoked/unknown token; 410 = token lifetime expired. Either ⇒ caller maps to 401.
        const detail = await safeText(res);
        throw new InfraError(
          `infra exchange failed (${res.status})${detail ? `: ${detail}` : ""}`,
          res.status,
        );
      }
      return await readBearer(res);
    },

    async jwks(): Promise<InfraJwks> {
      const res = await getJson(fetchImpl, jwksUrl);
      const keys = Array.isArray(res.keys) ? (res.keys as InfraJwk[]) : [];
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

/**
 * Extracts the compact-JWT session bearer from an exchange response. infra returns the signed
 * bearer either as a JSON object (a `bearer`/`sessionBearer`/`token`/`jwt` string field) or as the
 * raw JWT text body.
 */
async function readBearer(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await res.json() as Record<string, unknown>;
    for (const field of ["bearer", "sessionBearer", "token", "jwt"]) {
      const v = body[field];
      if (typeof v === "string" && v.length > 0) return v;
    }
    throw new InfraError(
      "infra exchange returned no session bearer field.",
      502,
    );
  }
  const text = (await res.text()).trim();
  if (!text) {
    throw new InfraError("infra exchange returned an empty bearer.", 502);
  }
  return text;
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

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return "";
  }
}
