import { assertEquals, assertRejects } from "#assert";
import { signToken, TokenError, type TokenPayload, verifyToken } from "./mod.ts";

const KEY = "super-secret-signing-key";
const future = 4_102_444_800; // 2100-01-01
const payload: TokenPayload = { source: "ci-runner", expiry: future, appName: "billing" };

Deno.test("signToken → verifyToken round-trips the payload", async () => {
  const token = await signToken(payload, KEY);
  assertEquals(await verifyToken(token, KEY), payload);
});

Deno.test("signToken → verifyToken round-trips roles", async () => {
  const withRoles = { ...payload, roles: ["admin", "editor"] };
  const token = await signToken(withRoles, KEY);
  assertEquals(await verifyToken(token, KEY), withRoles);
});

Deno.test("a token with no expiry never expires", async () => {
  const token = await signToken({ source: "ci-runner", appName: "billing" }, KEY);
  // Verify far in the future — still valid because there's no `exp` claim.
  const verified = await verifyToken(token, KEY, 10_000_000_000);
  assertEquals(verified, { source: "ci-runner", appName: "billing" });
  assertEquals(verified.expiry, undefined);
});

Deno.test("verifyToken rejects a token signed with a different key", async () => {
  const token = await signToken(payload, KEY);
  await assertRejects(() => verifyToken(token, "other-key"), TokenError, "Invalid signature");
});

Deno.test("verifyToken rejects a tampered payload", async () => {
  const token = await signToken(payload, KEY);
  const [header, , sig] = token.split(".");
  const forged = `${header}.${btoa('{"source":"evil","appName":"billing","exp":4102444800}')}.${sig}`;
  await assertRejects(() => verifyToken(forged, KEY), TokenError);
});

Deno.test("verifyToken rejects an expired token", async () => {
  const expired = { ...payload, expiry: 1_000 }; // 1970
  const token = await signToken(expired, KEY);
  await assertRejects(() => verifyToken(token, KEY), TokenError, "expired");
});

Deno.test("verifyToken honours the injected `now`", async () => {
  const token = await signToken({ ...payload, expiry: 2_000 }, KEY);
  assertEquals((await verifyToken(token, KEY, 1_999)).source, "ci-runner");
  await assertRejects(() => verifyToken(token, KEY, 2_000), TokenError, "expired");
});

Deno.test("verifyToken rejects a malformed token", async () => {
  await assertRejects(() => verifyToken("not.a.jwt.token", KEY), TokenError);
  await assertRejects(() => verifyToken("onlyonesegment", KEY), TokenError);
});

Deno.test("signToken requires source, appName, and an integer expiry", async () => {
  await assertRejects(() => signToken({ ...payload, source: "" }, KEY), TokenError, "source");
  await assertRejects(() => signToken({ ...payload, appName: "" }, KEY), TokenError, "appName");
  await assertRejects(() => signToken({ ...payload, expiry: 1.5 }, KEY), TokenError, "expiry");
});

Deno.test("signToken requires a key", async () => {
  await assertRejects(() => signToken(payload, ""), TokenError, "signing key");
});
