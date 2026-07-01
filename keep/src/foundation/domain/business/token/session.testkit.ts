/**
 * Test helper: a stand-in for infra's signer. Generates an Ed25519 keypair, publishes it as an
 * `InfraJwks` (raw base64url `x`), and mints infra's canonical session-bearer envelopes keep can
 * verify offline — so tests exercise the real JWKS verification path without a live infra.
 *
 * This mirrors infra `server/src/core/data/signer/mod.ts` (canonicalize + detached Ed25519 + the
 * JWKS `x` shape) byte-for-byte, exactly like `token/roundtrip.test.ts`.
 *
 * Excluded from publish (`*.testkit.ts`).
 */

import type { InfraJwk, InfraJwks } from "./mod.ts";

export interface TestSigner {
  /** The published verification key set keep's verifier fetches. */
  jwks: InfraJwks;
  /** Mint a session bearer (infra envelope) with the given fields. */
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
  /** Override the envelope `kid` (default the signer's kid) — to test mismatches. */
  kid?: string;
}

const KID = "infra-test-2026";
const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** EXACT copy of infra's / keep's canonicalize (the wire contract). */
function canonicalize(
  p: {
    creator: string;
    source: string;
    sessionExpiry: string;
    claims: Array<{ key: string; value: string }>;
  },
): string {
  const claims = p.claims.map((c) => ({ key: c.key, value: c.value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify({
    creator: p.creator,
    source: p.source,
    sessionExpiry: p.sessionExpiry,
    claims,
  });
}

/** Builds a test signer with a fresh Ed25519 keypair. */
export async function createTestSigner(kid = KID): Promise<TestSigner> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  ) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const jwk: InfraJwk = { kid, alg: "EdDSA", publicKey: pub.x as string };
  const jwks: InfraJwks = { keys: [jwk] };

  return {
    jwks,
    unknownKid: `${kid}-rotated`,
    async sign(fields: SignFields): Promise<string> {
      const now = Math.floor(Date.now() / 1000);
      const sessionExp = fields.sessionExp ?? now + 3600;
      const payload = {
        creator: fields.creator ?? "user-1",
        source: fields.source ?? "test",
        sessionExpiry: new Date(sessionExp * 1000).toISOString(),
        claims: Object.entries(fields.claims ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
      };
      const sig = await crypto.subtle.sign(
        "Ed25519",
        pair.privateKey,
        encoder.encode(canonicalize(payload)),
      );
      return JSON.stringify({
        ...payload,
        signature: base64url(new Uint8Array(sig)),
        kid: fields.kid ?? kid,
      });
    },
  };
}
