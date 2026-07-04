// Round-trip proof: keep's verifier MUST accept exactly what infra's signer emits.
// This test reproduces infra `server/src/core/data/signer/mod.ts` byte-for-byte
// (canonicalize + detached Ed25519 + the JWKS `x` shape) and verifies with keep.
import { assertEquals, assertRejects } from "#std/assert";
import { createJwksVerifier, type InfraJwks, TokenError } from "./mod.ts";

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// EXACT copy of infra's canonicalize (the wire contract).
function canonicalize(p: { creator: string; source: string; sessionExpiry: string; claims: Array<{ key: string; value: string }> }): string {
  const claims = p.claims.map((c) => ({ key: c.key, value: c.value }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return JSON.stringify({ creator: p.creator, source: p.source, sessionExpiry: p.sessionExpiry, claims });
}

// Build a signer + JWKS like infra: sign the canonical payload, publish the raw `x`.
async function infraSigner() {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const kid = "test-kid-1";
  const jwks: InfraJwks = { keys: [{ kid, alg: "EdDSA", publicKey: pub.x as string }] };
  // Bearer carries UNSORTED claims on purpose — keep must re-sort to verify.
  async function mint(opts: { creator: string; source: string; sessionExpiry: string; claims: Array<{ key: string; value: string }> }): Promise<string> {
    const sig = await crypto.subtle.sign("Ed25519", pair.privateKey, encoder.encode(canonicalize(opts)));
    return JSON.stringify({ ...opts, signature: base64url(new Uint8Array(sig)), kid });
  }
  return { jwks, mint };
}

const future = () => new Date(Date.now() + 3600_000).toISOString();

Deno.test("verifier — accepts an infra-signed envelope, re-sorts unsorted claims, maps grants", async () => {
  const { jwks, mint } = await infraSigner();
  const verifier = createJwksVerifier({ fetchJwks: () => Promise.resolve(jwks) });
  const bearer = await mint({
    creator: "ada@monsterrg.com",
    source: "infra-login",
    sessionExpiry: future(),
    claims: [{ key: "z-app", value: "read" }, { key: "mrg-keystone/rune", value: "admin,deploy" }], // unsorted
  });
  const payload = await verifier.verify(bearer);
  assertEquals(payload.creator, "ada@monsterrg.com");
  assertEquals(payload.source, "infra-login");
  assertEquals(payload.claims["mrg-keystone/rune"], "admin,deploy");
  assertEquals(payload.claims["z-app"], "read");
});

Deno.test("verifier — accepts a base64url-encoded envelope too (header-safe transport)", async () => {
  const { jwks, mint } = await infraSigner();
  const verifier = createJwksVerifier({ fetchJwks: () => Promise.resolve(jwks) });
  const raw = await mint({ creator: "u@x.com", source: "infra-login", sessionExpiry: future(), claims: [] });
  const encoded = base64url(encoder.encode(raw));
  const payload = await verifier.verify(encoded);
  assertEquals(payload.creator, "u@x.com");
});

Deno.test("verifier — rejects a tampered signature", async () => {
  const { jwks, mint } = await infraSigner();
  const verifier = createJwksVerifier({ fetchJwks: () => Promise.resolve(jwks) });
  const bearer = await mint({ creator: "u@x.com", source: "s", sessionExpiry: future(), claims: [{ key: "app", value: "admin" }] });
  const env = JSON.parse(bearer);
  env.claims[0].value = "superadmin"; // tamper the grant, keep the old signature
  await assertRejects(() => verifier.verify(JSON.stringify(env)), TokenError, "does not verify");
});

Deno.test("verifier — rejects an expired bearer", async () => {
  const { jwks, mint } = await infraSigner();
  const verifier = createJwksVerifier({ fetchJwks: () => Promise.resolve(jwks) });
  const bearer = await mint({ creator: "u@x.com", source: "s", sessionExpiry: new Date(Date.now() - 1000).toISOString(), claims: [] });
  await assertRejects(() => verifier.verify(bearer), TokenError, "expired");
});

Deno.test("verifier — rejects an unknown kid", async () => {
  const { jwks, mint } = await infraSigner();
  const verifier = createJwksVerifier({ fetchJwks: () => Promise.resolve({ keys: [{ ...jwks.keys[0], kid: "other" }] }) });
  const bearer = await mint({ creator: "u@x.com", source: "s", sessionExpiry: future(), claims: [] });
  await assertRejects(() => verifier.verify(bearer), TokenError, "No matching infra signing key");
});

Deno.test("verifier — rejects a malformed / non-envelope bearer", async () => {
  const { jwks } = await infraSigner();
  const verifier = createJwksVerifier({ fetchJwks: () => Promise.resolve(jwks) });
  await assertRejects(() => verifier.verify("not-a-bearer"), TokenError);
  await assertRejects(() => verifier.verify(JSON.stringify({ creator: "u", source: "s" })), TokenError, "claims");
});
