import { assertEquals } from "#assert";
import { Hono } from "#hono";
import { createTokenAuthMiddleware } from "./mod.ts";
import { signToken } from "@foundation/domain/business/token/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

const KEY = "test-signing-key";
const INTERNAL = "internal-process-key";
const future = 4_102_444_800;

// A stub Firebase verifier: "good-fb" is valid, anything else throws.
const stubFirebase = {
  verify: (idToken: string) =>
    idToken === "good-fb"
      ? Promise.resolve({ uid: "uid-9", email: "user@example.com" })
      : Promise.reject(new Error("bad firebase token")),
};

function appWith(
  signingKey = KEY,
  firebaseVerifier?: { verify: (t: string) => Promise<{ uid: string; email?: string }> },
  publicPaths?: string[],
  trustLocalhost?: boolean,
) {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const sources: (string | undefined)[] = [];
  const app = new Hono();
  app.use(
    createTokenAuthMiddleware({
      signingKey,
      logger,
      internalKey: INTERNAL,
      firebaseVerifier,
      publicPaths,
      trustLocalhost,
    }),
  );
  app.get("/protected", (c) => {
    sources.push(logger.currentRequest()?.source);
    return c.text("ok");
  });
  app.get("/docs", (c) => c.text("docs"));
  app.get("/docs/users", (c) => c.text("docs/users"));
  app.get("/docsignore", (c) => c.text("not docs"));

  // `env` mirrors what Deno.serve passes; a network request has a non-loopback peer.
  const fromNetwork = (req: Request) =>
    logger.runInRequest("r", () => app.fetch(req, { remoteAddr: { hostname: "203.0.113.9" } }));
  const fromLocalhost = (req: Request) =>
    logger.runInRequest("r", () => app.fetch(req, { remoteAddr: { hostname: "127.0.0.1" } }));
  return { fromNetwork, fromLocalhost, sources };
}

const bearer = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });
const internal = (key: string) => ({ headers: { [INTERNAL_REQUEST_HEADER]: key } });
const req = (init?: RequestInit) => new Request("http://app/protected", init);

Deno.test("in-process request (matching internal key) is trusted, no token needed", async () => {
  const res = await appWith().fromNetwork(req(internal(INTERNAL)));
  assertEquals(res.status, 200);
});

Deno.test("a forged/wrong internal key is NOT trusted and still needs a token", async () => {
  const res = await appWith().fromNetwork(req(internal("guessed-wrong")));
  assertEquals(res.status, 401);
});

Deno.test("network request with a valid token passes and attributes source", async () => {
  const { fromNetwork, sources } = appWith();
  const token = await signToken({ source: "ci", appName: "test", expiry: future }, KEY);

  const res = await fromNetwork(req(bearer(token)));

  assertEquals(res.status, 200);
  assertEquals(sources[0], "ci");
});

Deno.test("network request with no token is rejected with 401", async () => {
  const res = await appWith().fromNetwork(req());
  assertEquals(res.status, 401);
  assertEquals((await res.json()).message, "Missing credentials.");
});

Deno.test("network request with an expired token is rejected with 401", async () => {
  const token = await signToken({ source: "ci", appName: "test", expiry: 1_000 }, KEY);
  const res = await appWith().fromNetwork(req(bearer(token)));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).message, "Token expired.");
});

Deno.test("network request with a mis-signed token is rejected with 401", async () => {
  const token = await signToken({ source: "ci", appName: "test", expiry: future }, "wrong");
  const res = await appWith().fromNetwork(req(bearer(token)));
  assertEquals(res.status, 401);
});

Deno.test("localhost callers are trusted and need no token", async () => {
  assertEquals((await appWith().fromLocalhost(req())).status, 200);
});

Deno.test("trustLocalhost:false requires a token from localhost (internal key still trusted)", async () => {
  const app = appWith(KEY, undefined, undefined, false);
  // localhost now needs a token
  assertEquals((await app.fromLocalhost(req())).status, 401);
  const token = await signToken({ source: "svc", appName: "test", expiry: future }, KEY);
  assertEquals((await app.fromLocalhost(req(bearer(token)))).status, 200);
  // in-process internal key is still trusted regardless
  assertEquals(
    (await app.fromLocalhost(req({ headers: { [INTERNAL_REQUEST_HEADER]: INTERNAL } }))).status,
    200,
  );
});

Deno.test("public paths bypass auth (docs exempt, prefix and sub-paths)", async () => {
  const app = appWith(KEY, undefined, ["/docs"]);
  assertEquals((await app.fromNetwork(new Request("http://app/docs"))).status, 200);
  assertEquals((await app.fromNetwork(new Request("http://app/docs/users"))).status, 200);
});

Deno.test("a public prefix does not leak to lookalike paths", async () => {
  const app = appWith(KEY, undefined, ["/docs"]);
  // /docsignore is NOT under /docs — still requires a credential
  assertEquals((await app.fromNetwork(new Request("http://app/docsignore"))).status, 401);
  // protected routes are unaffected
  assertEquals((await app.fromNetwork(req())).status, 401);
});

Deno.test("a valid Firebase token authorizes (no signed token needed)", async () => {
  const { fromNetwork, sources } = appWith(KEY, stubFirebase);
  const res = await fromNetwork(req(bearer("good-fb")));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "user@example.com");
});

Deno.test("an invalid credential is rejected even with Firebase configured", async () => {
  const res = await appWith(KEY, stubFirebase).fromNetwork(req(bearer("garbage")));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).message, "Invalid or expired credentials.");
});

Deno.test("a valid signed token still works when Firebase is also configured", async () => {
  const { fromNetwork, sources } = appWith(KEY, stubFirebase);
  const token = await signToken({ source: "svc", appName: "test", expiry: future }, KEY);
  const res = await fromNetwork(req(bearer(token)));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "svc");
});

Deno.test("Firebase works even when no signing key is set (token-only disabled)", async () => {
  const { fromNetwork } = appWith("", stubFirebase);
  assertEquals((await fromNetwork(req(bearer("good-fb")))).status, 200);
  assertEquals((await fromNetwork(req(bearer("nope")))).status, 401);
});

Deno.test("no signing key ⇒ network requests fail closed, internal key still trusted", async () => {
  const { fromNetwork } = appWith("");
  const token = await signToken({ source: "ci", appName: "test", expiry: future }, "any");

  assertEquals((await fromNetwork(req(bearer(token)))).status, 401); // can't verify
  assertEquals((await fromNetwork(req())).status, 401); // missing token
  assertEquals((await fromNetwork(req(internal(INTERNAL)))).status, 200); // in-process
});
