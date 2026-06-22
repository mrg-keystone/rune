import { assertEquals, assertRejects, assertThrows } from "#assert";
import { generateKeyPair, SignJWT } from "#jose";
import { createFirebaseVerifier, FirebaseAuthError } from "./mod.ts";

const PROJECT = "my-firebase-project";
const ISSUER = `https://securetoken.google.com/${PROJECT}`;

// Generate one RSA keypair to act as Google's signing key for the tests.
const { publicKey, privateKey } = await generateKeyPair("RS256");

function verifier(resolveKey = () => Promise.resolve(publicKey as CryptoKey)) {
  return createFirebaseVerifier({ projectId: PROJECT, resolveKey });
}

function token(opts: {
  sub?: string;
  email?: string;
  aud?: string;
  iss?: string;
  expired?: boolean;
  // deno-lint-ignore no-explicit-any
  claims?: Record<string, any>;
} = {}) {
  let jwt = new SignJWT({
    ...(opts.email ? { email: opts.email } : {}),
    ...(opts.claims ?? {}),
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? PROJECT)
    .setSubject(opts.sub ?? "uid-123")
    .setIssuedAt();
  jwt = opts.expired
    ? jwt.setExpirationTime("-1h")
    : jwt.setExpirationTime("1h");
  return jwt.sign(privateKey);
}

Deno.test("verifies a valid token and returns uid + email", async () => {
  const claims = await verifier().verify(
    await token({ email: "user@example.com" }),
  );
  assertEquals(claims, {
    uid: "uid-123",
    email: "user@example.com",
    roles: [],
  });
});

Deno.test("verifies a token without an email", async () => {
  const claims = await verifier().verify(await token());
  assertEquals(claims, { uid: "uid-123", email: undefined, roles: [] });
});

Deno.test("extracts roles from the `roles` array and singular `role` custom claims", async () => {
  const arr = await verifier().verify(
    await token({ claims: { roles: ["admin", "editor"] } }),
  );
  assertEquals(arr.roles, ["admin", "editor"]);

  const single = await verifier().verify(
    await token({ claims: { role: "billing" } }),
  );
  assertEquals(single.roles, ["billing"]);
});

Deno.test("rejects a token for a different project (audience)", async () => {
  const jwt = await token({ aud: "other-project" });
  await assertRejects(() => verifier().verify(jwt), FirebaseAuthError);
});

Deno.test("rejects a token with the wrong issuer", async () => {
  const jwt = await token({ iss: "https://evil.example.com" });
  await assertRejects(() => verifier().verify(jwt), FirebaseAuthError);
});

Deno.test("rejects an expired token", async () => {
  const jwt = await token({ expired: true });
  await assertRejects(() => verifier().verify(jwt), FirebaseAuthError);
});

Deno.test("rejects a token signed by a different key", async () => {
  const other = await generateKeyPair("RS256");
  const forged = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
    .setIssuer(ISSUER)
    .setAudience(PROJECT)
    .setSubject("uid-123")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(other.privateKey);

  await assertRejects(() => verifier().verify(forged), FirebaseAuthError);
});

Deno.test("rejects a malformed token", async () => {
  await assertRejects(() => verifier().verify("not.a.jwt"), FirebaseAuthError);
});

Deno.test("createFirebaseVerifier requires a project id", () => {
  assertThrows(
    () => createFirebaseVerifier({ projectId: "" }),
    FirebaseAuthError,
    "project ID",
  );
});
