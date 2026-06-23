import { assertEquals, assertRejects } from "#assert";
import { createJwksVerifier, TokenError, verifyToken } from "./mod.ts";
import { createTestSigner } from "./session.testkit.ts";

const signer = await createTestSigner();

/** A verifier over the test signer's JWKS, with a fetch counter to assert caching. */
function makeVerifier(opts?: { cacheTtlSeconds?: number }) {
  let fetches = 0;
  const verifier = createJwksVerifier({
    fetchJwks: () => {
      fetches++;
      return Promise.resolve(signer.jwks);
    },
    cacheTtlSeconds: opts?.cacheTtlSeconds,
  });
  return { verifier, fetches: () => fetches };
}

Deno.test("verifies a well-formed session bearer and returns the payload", async () => {
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({
    creator: "user-7",
    source: "ci",
    claims: { role: "billing:admin", team: "core" },
  });
  const payload = await verifyToken(bearer, verifier);
  assertEquals(payload.iss, "infra");
  assertEquals(payload.creator, "user-7");
  assertEquals(payload.source, "ci");
  assertEquals(payload.claims, { role: "billing:admin", team: "core" });
});

Deno.test("rejects an expired session bearer", async () => {
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({ sessionExp: 1_000 }); // 1970
  await assertRejects(() => verifyToken(bearer, verifier), TokenError);
});

Deno.test("rejects a bearer whose kid is not in the JWKS", async () => {
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({ kid: signer.unknownKid });
  await assertRejects(
    () => verifyToken(bearer, verifier),
    TokenError,
    "No matching infra signing key",
  );
});

Deno.test("rejects a bearer with the wrong issuer", async () => {
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({ iss: "evil" });
  await assertRejects(() => verifyToken(bearer, verifier), TokenError);
});

Deno.test("rejects a bearer signed by a different key", async () => {
  const other = await createTestSigner("infra-test-2026"); // same kid, different key
  const { verifier } = makeVerifier();
  const bearer = await other.sign({});
  await assertRejects(() => verifyToken(bearer, verifier), TokenError);
});

Deno.test("rejects a malformed bearer", async () => {
  const { verifier } = makeVerifier();
  await assertRejects(() => verifyToken("not.a.jwt", verifier), TokenError);
  await assertRejects(() => verifyToken("garbage", verifier), TokenError);
});

Deno.test("surfaces a missing-creator bearer as a TokenError", async () => {
  const { verifier } = makeVerifier();
  // Sign with creator explicitly blanked.
  const bearer = await signer.sign({ creator: "" });
  await assertRejects(
    () => verifyToken(bearer, verifier),
    TokenError,
    "creator",
  );
});

Deno.test("carries mintedAt when present (for the * 24h cap)", async () => {
  const { verifier } = makeVerifier();
  const mintedAt = Math.floor(Date.now() / 1000) - 100;
  const bearer = await signer.sign({ mintedAt });
  const payload = await verifyToken(bearer, verifier);
  assertEquals(payload.mintedAt, mintedAt);
});

Deno.test("derives mintedAt from a short all-digit epoch-seconds claim (not a calendar year)", async () => {
  // When the bearer carries no numeric `mintedAt`, toSessionPayload derives it from the
  // string `claims.mintedAt` via isoToEpochSeconds, documented to accept an "epoch-seconds string".
  // A short all-digit string must be read as epoch seconds, NOT misparsed by Date.parse as a year.
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({ claims: { mintedAt: "3600" } });
  const payload = await verifyToken(bearer, verifier);
  assertEquals(payload.mintedAt, 3600, "epoch-seconds string read literally");
});

Deno.test("derives mintedAt from a 10-digit epoch-seconds claim", async () => {
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({ claims: { mintedAt: "315532800" } });
  const payload = await verifyToken(bearer, verifier);
  assertEquals(payload.mintedAt, 315532800);
});

Deno.test("derives mintedAt from a real ISO-8601 claim (preserved behavior)", async () => {
  const { verifier } = makeVerifier();
  const bearer = await signer.sign({
    claims: { mintedAt: "2025-01-01T00:00:00Z" },
  });
  const payload = await verifyToken(bearer, verifier);
  assertEquals(payload.mintedAt, Math.floor(Date.parse("2025-01-01T00:00:00Z") / 1000));
});

Deno.test("caches the JWKS across verifications within the TTL", async () => {
  const { verifier, fetches } = makeVerifier({ cacheTtlSeconds: 600 });
  await verifyToken(await signer.sign({}), verifier);
  await verifyToken(await signer.sign({}), verifier);
  assertEquals(fetches(), 1); // one fetch, then served from cache
});

Deno.test("an unknown kid forces a single JWKS refresh", async () => {
  // First call caches; a bearer with an unknown kid triggers exactly one forced refresh.
  const { verifier, fetches } = makeVerifier({ cacheTtlSeconds: 600 });
  await verifyToken(await signer.sign({}), verifier); // fetch #1
  const bad = await signer.sign({ kid: signer.unknownKid });
  await assertRejects(() => verifyToken(bad, verifier), TokenError); // fetch #2 (refresh)
  assertEquals(fetches(), 2);
});

/** A verifier whose fetchJwks awaits, so concurrent loads overlap and de-dup can be observed. */
function makeSlowVerifier(opts?: { cacheTtlSeconds?: number }) {
  let fetches = 0;
  const verifier = createJwksVerifier({
    fetchJwks: async () => {
      fetches++;
      await new Promise((r) => setTimeout(r, 20));
      return signer.jwks;
    },
    cacheTtlSeconds: opts?.cacheTtlSeconds,
  });
  return { verifier, fetches: () => fetches };
}

Deno.test("concurrent cold-start verifications share a single in-flight JWKS fetch", async () => {
  const { verifier, fetches } = makeSlowVerifier({ cacheTtlSeconds: 600 });
  const bearers = await Promise.all(
    Array.from({ length: 10 }, () => signer.sign({})),
  );
  await Promise.all(bearers.map((b) => verifyToken(b, verifier)));
  assertEquals(fetches(), 1, "10 concurrent cold verifies share one fetch");
});

Deno.test("concurrent unknown-kid verifications share a single forced refresh", async () => {
  const { verifier, fetches } = makeSlowVerifier({ cacheTtlSeconds: 600 });
  await verifyToken(await signer.sign({}), verifier); // warm: fetch #1
  const bad = await Promise.all(
    Array.from({ length: 10 }, () => signer.sign({ kid: signer.unknownKid })),
  );
  await Promise.all(
    bad.map((b) =>
      verifyToken(b, verifier).catch((e) => {
        if (!(e instanceof TokenError)) throw e;
      })
    ),
  );
  assertEquals(fetches(), 2, "warm fetch + one shared forced refresh");
});
