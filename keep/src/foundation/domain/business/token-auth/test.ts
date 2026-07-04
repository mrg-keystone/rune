import { assertEquals, assertRejects } from "#assert";
import { type Context, Hono } from "#hono";
import { ForbiddenException, UnauthorizedException } from "#danet/core";
import {
  createCredentialGuard,
  createTokenAuthMiddleware,
  getIdentity,
  readCookie,
} from "./mod.ts";
import { createJwksVerifier } from "@foundation/domain/business/token/mod.ts";
import { createTestSigner } from "@foundation/domain/business/token/session.testkit.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { PUBLIC_METADATA_KEY } from "@foundation/domain/business/public-route/mod.ts";
import {
  GRANTS_METADATA_KEY,
  LOGGEDIN_METADATA_KEY,
} from "@foundation/domain/business/grants/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

const INTERNAL = "internal-process-key";

const signer = await createTestSigner();
const verifier = createJwksVerifier({
  fetchJwks: () => Promise.resolve(signer.jwks),
});

/** Mint an infra-signed session bearer (the ONLY network credential keep trusts). */
const bearerFor = (fields: Parameters<typeof signer.sign>[0]) =>
  signer.sign(fields);

function appWith(opts: {
  withVerifier?: boolean;
  revokeAll?: () => boolean;
  publicPaths?: string[];
  cookieSession?: (id: string) => Promise<string | null>;
} = {}) {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const sources: (string | undefined)[] = [];
  const app = new Hono();
  app.use(
    createTokenAuthMiddleware({
      verifier: opts.withVerifier === false ? undefined : verifier,
      logger,
      internalKey: INTERNAL,
      revokeAll: opts.revokeAll,
      publicPaths: opts.publicPaths,
      cookieSession: opts.cookieSession,
    }),
  );
  app.get("/protected", (c) => {
    sources.push(logger.currentRequest()?.source);
    return c.text("ok");
  });
  app.get("/docs", (c) => c.text("docs"));
  app.get("/docsignore", (c) => c.text("not docs"));

  const fromNetwork = (req: Request) =>
    logger.runInRequest(
      "r",
      () => app.fetch(req, { remoteAddr: { hostname: "203.0.113.9" } }),
    );
  return { fromNetwork, sources };
}

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});
const internal = (key: string) => ({
  headers: { [INTERNAL_REQUEST_HEADER]: key },
});
const cookie = (raw: string) => ({ headers: { cookie: raw } });
const req = (init?: RequestInit) => new Request("http://app/protected", init);

// ---- readCookie ----

Deno.test("readCookie: finds a value among many, URL-decodes, ignores lookalikes", () => {
  assertEquals(
    readCookie("a=1; sprig_session=abc%20def; b=2", "sprig_session"),
    "abc def",
  );
  assertEquals(readCookie("sprig_session=xyz", "sprig_session"), "xyz");
  assertEquals(readCookie("other=1", "sprig_session"), undefined);
  assertEquals(readCookie(undefined, "sprig_session"), undefined);
  // a name that is a prefix of another cookie must not match
  assertEquals(readCookie("sprig_session_x=1", "sprig_session"), undefined);
});

// ---- middleware: trust + credential kinds ----

Deno.test("in-process request (matching internal key) is trusted, no token needed", async () => {
  const res = await appWith().fromNetwork(req(internal(INTERNAL)));
  assertEquals(res.status, 200);
});

Deno.test("a forged/wrong internal key still needs a token", async () => {
  const res = await appWith().fromNetwork(req(internal("guessed-wrong")));
  assertEquals(res.status, 401);
});

Deno.test("network request with a valid session bearer passes and attributes source", async () => {
  const { fromNetwork, sources } = appWith();
  const token = await bearerFor({ source: "ci" });
  const res = await fromNetwork(req(bearer(token)));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "ci");
});

Deno.test("network request with no token is rejected with 401", async () => {
  const res = await appWith().fromNetwork(req());
  assertEquals(res.status, 401);
  assertEquals((await res.json()).message, "Missing credentials.");
});

Deno.test("sprig_session cookie resolves to a bearer and authorizes (3rd source)", async () => {
  const token = await bearerFor({ source: "kiosk" });
  const seen: string[] = [];
  const { fromNetwork, sources } = appWith({
    cookieSession: (id) => {
      seen.push(id);
      return Promise.resolve(id === "sess-1" ? token : null);
    },
  });
  const res = await fromNetwork(req(cookie("sprig_session=sess-1")));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "kiosk");
  assertEquals(seen, ["sess-1"]); // the opaque session id, never the bearer, rode in the cookie
});

Deno.test("cookie is only tried when no header/query credential is present", async () => {
  let calls = 0;
  const { fromNetwork } = appWith({
    cookieSession: () => {
      calls++;
      return Promise.resolve(null);
    },
  });
  const token = await bearerFor({ source: "hdr" });
  const res = await fromNetwork(
    new Request("http://app/protected", {
      headers: {
        authorization: `Bearer ${token}`,
        cookie: "sprig_session=sess-1",
      },
    }),
  );
  assertEquals(res.status, 200);
  assertEquals(calls, 0); // header won; the session store was never consulted
});

Deno.test("an unknown/expired session cookie (resolver → null) is rejected 401", async () => {
  const { fromNetwork } = appWith({
    cookieSession: () => Promise.resolve(null),
  });
  const res = await fromNetwork(req(cookie("sprig_session=gone")));
  assertEquals(res.status, 401);
});

Deno.test("cookie auth is off when no resolver is configured", async () => {
  const { fromNetwork } = appWith();
  const res = await fromNetwork(req(cookie("sprig_session=whatever")));
  assertEquals(res.status, 401);
});

Deno.test("a resolved cookie bearer is still verified — a bogus one is rejected", async () => {
  const { fromNetwork } = appWith({
    cookieSession: () => Promise.resolve("not-a-real-bearer"),
  });
  const res = await fromNetwork(req(cookie("sprig_session=sess-1")));
  assertEquals(res.status, 401);
});

Deno.test("an expired session bearer is rejected with 401", async () => {
  const token = await bearerFor({ sessionExp: 1_000 });
  const res = await appWith().fromNetwork(req(bearer(token)));
  assertEquals(res.status, 401);
});

Deno.test("a garbage bearer with no verifier configured → 401", async () => {
  const res = await appWith({ withVerifier: false }).fromNetwork(
    req(bearer("garbage")),
  );
  assertEquals(res.status, 401);
});

Deno.test("public paths bypass auth (docs exempt)", async () => {
  const app = appWith({ publicPaths: ["/docs"] });
  assertEquals(
    (await app.fromNetwork(new Request("http://app/docs"))).status,
    200,
  );
});

Deno.test("a public prefix does not leak to lookalike paths", async () => {
  const app = appWith({ publicPaths: ["/docs"] });
  assertEquals(
    (await app.fromNetwork(new Request("http://app/docsignore"))).status,
    401,
  );
});

Deno.test("an empty-string public prefix never opens the app (fail-closed)", async () => {
  // An accidental "" entry (e.g. env.split(",") with a trailing comma) must NOT make every
  // route public. A protected path with no credential must still 401.
  const app = appWith({ publicPaths: [""] });
  assertEquals((await app.fromNetwork(req())).status, 401);
  // Even a whitespace-only entry is inert.
  const ws = appWith({ publicPaths: ["   "] });
  assertEquals((await ws.fromNetwork(req())).status, 401);
});

Deno.test("a trailing-slash public prefix matches like the documented prefix", async () => {
  // "/docs/" should behave like the documented "/docs" — make /docs public.
  const app = appWith({ publicPaths: ["/docs/"] });
  assertEquals(
    (await app.fromNetwork(new Request("http://app/docs"))).status,
    200,
  );
  // Still segment-scoped: a lookalike path stays protected.
  assertEquals(
    (await app.fromNetwork(new Request("http://app/docsignore"))).status,
    401,
  );
});

// ---- revokeAll (break glass) ----

Deno.test("revokeAll ON: a cached session bearer is rejected (force re-auth at infra)", async () => {
  const token = await bearerFor({ source: "svc" });
  const res = await appWith({ revokeAll: () => true }).fromNetwork(
    req(bearer(token)),
  );
  assertEquals(res.status, 401);
  assertEquals(
    (await res.json()).message,
    "Session bearer not trusted (revoke-all active) — re-authenticate at infra.",
  );
});

// ---- createCredentialGuard ----

function guardCtx(opts: {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  isPublic?: boolean;
  grants?: string[];
  domains?: string[];
  websocketTopic?: string;
}) {
  function handler() {}
  if (opts.isPublic) Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, handler);
  if (opts.grants) {
    Reflect.defineMetadata(GRANTS_METADATA_KEY, opts.grants, handler);
  }
  if (opts.domains) {
    Reflect.defineMetadata(LOGGEDIN_METADATA_KEY, opts.domains, handler);
  }
  const store = new Map<string, unknown>();
  return {
    req: {
      header: (n: string) => opts.headers?.[n.toLowerCase()],
      query: (n: string) => opts.query?.[n],
      json: () => Promise.resolve(opts.body ?? {}),
    },
    getHandler: () => handler,
    getClass: () => function Ctrl() {},
    set: (k: string, v: unknown) => store.set(k, v),
    get: (k: string) => store.get(k),
    websocketTopic: opts.websocketTopic,
  };
}

function guard(
  extra: Partial<Parameters<typeof createCredentialGuard>[0]> = {},
) {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const g = createCredentialGuard({
    appName: "test",
    verifier,
    internalKey: INTERNAL,
    logger,
    ...extra,
  });
  return { g, logger };
}

Deno.test("guard: protected route from network without a credential throws 401", async () => {
  const { g } = guard();
  await assertRejects(
    () => Promise.resolve(g.canActivate(guardCtx({}) as unknown as Context)),
    UnauthorizedException,
  );
});

Deno.test("guard: @Public route is allowed with no credential", async () => {
  const { g } = guard();
  assertEquals(
    await g.canActivate(guardCtx({ isPublic: true }) as unknown as Context),
    true,
  );
});

Deno.test("guard: sprig_session cookie resolves a bearer and authorizes a held grant", async () => {
  const token = await bearerFor({ source: "kiosk", claims: { test: "go" } });
  const { g } = guard({
    cookieSession: (id) => Promise.resolve(id === "s1" ? token : null),
  });
  const ctx = guardCtx({
    grants: ["go"],
    headers: { cookie: "a=b; sprig_session=s1; c=d" },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: an unresolvable session cookie on a protected route throws 401", async () => {
  const { g } = guard({ cookieSession: () => Promise.resolve(null) });
  await assertRejects(
    () =>
      Promise.resolve(
        g.canActivate(
          guardCtx({
            grants: ["go"],
            headers: { cookie: "sprig_session=gone" },
          }) as unknown as Context,
        ),
      ),
    UnauthorizedException,
  );
});

Deno.test("guard: valid session bearer authorizes (a held grant) and sets source", async () => {
  const { g, logger } = guard();
  const token = await bearerFor({ source: "svc", claims: { test: "go" } });
  const ctx = guardCtx({
    grants: ["go"],
    headers: { authorization: `Bearer ${token}` },
  });
  const ok = await logger.runInRequest("r", async () => {
    const r = await g.canActivate(ctx as unknown as Context);
    return { r, source: logger.currentRequest()?.source };
  });
  assertEquals(ok.r, true);
  assertEquals(ok.source, "svc");
});

Deno.test("guard: the in-process caller is trusted (no localhost bypass)", async () => {
  const { g } = guard();
  assertEquals(
    await g.canActivate(
      guardCtx({
        headers: { [INTERNAL_REQUEST_HEADER]: INTERNAL },
      }) as unknown as Context,
    ),
    true,
  );
});

Deno.test("guard: WS message contexts are skipped", async () => {
  const { g } = guard();
  assertEquals(
    await g.canActivate(
      guardCtx({ websocketTopic: "chat" }) as unknown as Context,
    ),
    true,
  );
});

// ---- @Grant enforcement (fail-closed) ----

Deno.test("guard: @Grant allows a caller holding the grant", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "admin" } });
  const ctx = guardCtx({
    grants: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: @Grant accepts any-of (one of several listed)", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "deploy" } });
  const ctx = guardCtx({
    grants: ["admin", "deploy"],
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: a grant for a DIFFERENT app does not satisfy @Grant", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { other: "admin" } });
  const ctx = guardCtx({
    grants: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: @Grant rejects a caller missing the grant with 403", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "editor" } });
  const ctx = guardCtx({
    grants: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: @Grant without any credential is 401", async () => {
  const { g } = guard();
  const ctx = guardCtx({ grants: ["admin"] });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    UnauthorizedException,
  );
});

// ---- @Grant("::key") dynamic form ----

Deno.test('guard: @Grant("::key") resolves the required grant from the query', async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "admin" } });
  const ctx = guardCtx({
    grants: ["::role"],
    query: { role: "admin" }, // resolves to grant "admin", which the caller holds
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test('guard: @Grant("::key") resolves the required grant from the JSON body', async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "admin" } });
  const ctx = guardCtx({
    grants: ["::role"],
    body: { role: "admin" },
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test('guard: @Grant("::key") with the key absent denies (403)', async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "admin" } });
  const ctx = guardCtx({
    grants: ["::role"], // no `role` anywhere in the request → can't satisfy any-of
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test('guard: @Grant("::key") resolves a value the caller does NOT hold → 403', async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "editor" } });
  const ctx = guardCtx({
    grants: ["::role"],
    query: { role: "admin" }, // resolves to "admin", which the caller lacks
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

// ---- @LoggedIn (creator email-domain) ----

Deno.test("guard: @LoggedIn allows a creator under the listed domain", async () => {
  const { g } = guard();
  const token = await bearerFor({ creator: "ada@monsterrg.com" });
  const ctx = guardCtx({
    domains: ["monsterrg.com"],
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: @LoggedIn rejects a creator under a different domain (403)", async () => {
  const { g } = guard();
  const token = await bearerFor({ creator: "eve@evil.com" });
  const ctx = guardCtx({
    domains: ["monsterrg.com"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: @LoggedIn rejects a non-email (machine) creator (403)", async () => {
  const { g } = guard();
  const token = await bearerFor({ creator: "machine-token" });
  const ctx = guardCtx({
    domains: ["monsterrg.com"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

// ---- stacked @LoggedIn + @Grant = AND ----

Deno.test("guard: stacked @LoggedIn + @Grant allows only when BOTH hold", async () => {
  const { g } = guard();
  const token = await bearerFor({
    creator: "ada@monsterrg.com",
    claims: { test: "admin" },
  });
  const ctx = guardCtx({
    domains: ["monsterrg.com"],
    grants: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: stacked @LoggedIn + @Grant denies when the grant is missing (domain ok)", async () => {
  const { g } = guard();
  const token = await bearerFor({
    creator: "ada@monsterrg.com",
    claims: { test: "editor" },
  });
  const ctx = guardCtx({
    domains: ["monsterrg.com"],
    grants: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: stacked @LoggedIn + @Grant denies when the domain is wrong (grant ok)", async () => {
  const { g } = guard();
  const token = await bearerFor({
    creator: "ada@other.com",
    claims: { test: "admin" },
  });
  const ctx = guardCtx({
    domains: ["monsterrg.com"],
    grants: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

// ---- fail-closed: no @Public and no decorator is denied ----

Deno.test("guard: a route with NO @Public and NO @Grant/@LoggedIn is CLOSED (403) even when authenticated", async () => {
  // The crux of the model: default-closed. A valid identity with real grants still can't reach a
  // route that names no constraint — only `@Public`, `@Grant`, `@LoggedIn`, or `*` open one.
  const { g } = guard();
  const token = await bearerFor({ source: "svc", claims: { test: "admin" } });
  const ctx = guardCtx({
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: empty grant remainders are dropped (no spurious match)", async () => {
  // claims[appName] = ",admin," → grants ["admin"]; a mis-typed @Grant("") must NOT match.
  const { g } = guard();
  const token = await bearerFor({ claims: { test: ",admin," } });
  const ctx = guardCtx({
    grants: [""],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: attaches the resolved identity (claims + app grants)", async () => {
  const { g } = guard();
  const token = await bearerFor({
    source: "svc",
    claims: { test: "admin,deploy", other: "x", team: "core" },
  });
  const ctx = guardCtx({
    grants: ["admin"], // a route this caller can reach, so canActivate returns
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
  const id = getIdentity(ctx as unknown as Context)!;
  assertEquals(id.source, "svc");
  assertEquals(id.grants, ["admin", "deploy"]); // this app's grants
  assertEquals(id.claims.team, "core");
});

// ---- `*` universal grant (skeleton key) ----

Deno.test("guard: a `*` grant opens a @Grant route the caller doesn't hold", async () => {
  const { g } = guard(); // honorSkeleton defaults true
  const token = await bearerFor({ claims: { test: "*" } });
  const ctx = guardCtx({
    grants: ["docs"], // caller doesn't hold it, but `*` opens it
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: a `*` grant opens a route with NO decorator too (treated as public)", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { test: "*" } });
  const ctx = guardCtx({
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: honorSkeleton:false ignores `*` (infra posture)", async () => {
  const { g } = guard({ honorSkeleton: false });
  const token = await bearerFor({ claims: { test: "*" } });
  const ctx = guardCtx({
    grants: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

// ---- ?token query-param ----

Deno.test("guard: a valid session bearer in ?token authorizes a @Grant route it holds", async () => {
  const { g } = guard();
  const token = await bearerFor({ source: "link", claims: { test: "docs" } });
  const ctx = guardCtx({
    grants: ["docs"],
    query: { token },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: an invalid ?token on a protected route is rejected (401)", async () => {
  const { g } = guard();
  const ctx = guardCtx({
    query: { token: "garbage" },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    UnauthorizedException,
  );
});
