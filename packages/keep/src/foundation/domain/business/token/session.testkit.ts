/**
 * Test helper: a stand-in for infra's signer. Generates an RS256 keypair, publishes it as an
 * `InfraJwks` (SPKI PEM), and mints compact-JWT session bearers keep can verify offline — so tests
 * exercise the real JWKS verification path without a live infra.
 *
 * Excluded from publish (`*.testkit.ts`).
 */

import { exportSPKI, generateKeyPair, type KeyLike, SignJWT } from "#jose";
import type { InfraJwk, InfraJwks } from "./mod.ts";

export interface TestSigner {
  /** The published verification key set keep's verifier fetches. */
  jwks: InfraJwks;
  /** Mint a session bearer (compact JWT) with the given fields. */
  sign(fields: SignFields): Promise<string>;
  /** A second key id NOT in `jwks` — for testing unknown-kid rejection. */
  unknownKid: string;
}

export interface SignFields {
  creator?: string;
  source?: string;
  claims?: Record<string, string>;
  /** Unix seconds; default ~1h out. */
  sessionExp?: number;
  /** Unix seconds; original mint time (for the `*` 24h cap). */
  mintedAt?: number;
  iss?: string;
  /** Override the header `kid` (default the signer's kid) — to test mismatches. */
  kid?: string;
}

const KID = "infra-test-2026";

/** Builds a test signer with a fresh RS256 keypair. */
export async function createTestSigner(kid = KID): Promise<TestSigner> {
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: true,
  });
  const pem = await exportSPKI(publicKey as KeyLike);
  const jwk: InfraJwk = { kid, alg: "RS256", publicKey: pem };
  const jwks: InfraJwks = { keys: [jwk] };

  return {
    jwks,
    unknownKid: `${kid}-rotated`,
    async sign(fields: SignFields): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const sessionExp = fields.sessionExp ?? now + 3600;
      const payload: Record<string, unknown> = {
        iss: fields.iss ?? "infra",
        creator: fields.creator ?? "user-1",
        source: fields.source ?? "test",
        claims: fields.claims ?? {},
        sessionExp,
      };
      if (fields.mintedAt !== undefined) payload.mintedAt = fields.mintedAt;
      return await new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: fields.kid ?? kid })
        .setIssuer(payload.iss as string)
        .setExpirationTime(sessionExp)
        .sign(privateKey as KeyLike);
    },
  };
}
