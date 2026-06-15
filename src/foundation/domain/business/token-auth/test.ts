import { assertEquals, assertRejects } from "#assert";
import { type Context, Hono } from "#hono";
import { ForbiddenException, UnauthorizedException } from "#danet/core";
import {
  createCredentialGuard,
  createTokenAuthMiddleware,
  getIdentity,
  SESSION_BEARER_HEADER,
} from "./mod.ts";
import { createJwksVerifier } from "@foundation/domain/business/token/mod.ts";
import { createTestSigner } from "@foundation/domain/business/token/session.testkit.ts";
import {
  type InfraClient,
  InfraError,
} from "@foundation/domain/business/infra-client/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { PUBLIC_METADATA_KEY } from "@foundation/domain/business/public-route/mod.ts";
import { ROLES_METADATA_KEY } from "@foundation/domain/business/roles/mod.ts";
import { CLAIMS_METADATA_KEY } from "@foundation/domain/business/claims/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

const INTERNAL = "internal-process-key";

const signer = await createTestSigner();
const verifier = createJwksVerifier({
  fetchJwks: () => Promise.resolve(signer.jwks),
});

/** Mint a session bearer (infra-signed compact JWT). */
const bearerFor = (fields: Parameters<typeof signer.sign>[0]) =>
  signer.sign(fields);

/** A stub infra client: opaque-token exchange + (unused) jwks/revocation. */
function stubInfra(
  exchange: (opaque: string) => Promise<string>,
): InfraClient {
  return {
    exchange,
    jwks: () => Promise.resolve(signer.jwks),
    revocationStatus: () => Promise.resolve({ revokeAll: false }),
  };
}

// A stub Firebase verifier: "good-fb" is valid, anything else throws.
const stubFirebase = {
  verify: (idToken: string) =>
    idToken === "good-fb"
      ? Promise.resolve({ uid: "uid-9", email: "user@example.com", roles: [] })
      : Promise.reject(new Error("bad firebase token")),
};

function appWith(opts: {
  withVerifier?: boolean;
  firebaseVerifier?: {
    verify: (
      t: string,
    ) => Promise<{ uid: string; email?: string; roles: string[] }>;
  };
  infraClient?: InfraClient;
  revokeAll?: () => boolean;
  publicPaths?: string[];
  trustLocalhost?: boolean;
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
      firebaseVerifier: opts.firebaseVerifier,
      infraClient: opts.infraClient,
      revokeAll: opts.revokeAll,
      publicPaths: opts.publicPaths,
      trustLocalhost: opts.trustLocalhost,
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
  const fromLocalhost = (req: Request) =>
    logger.runInRequest(
      "r",
      () => app.fetch(req, { remoteAddr: { hostname: "127.0.0.1" } }),
    );
  return { fromNetwork, fromLocalhost, sources };
}

const bearer = (token: string) => ({
  headers: { authorization: `Bearer ${token}` },
});
const internal = (key: string) => ({
  headers: { [INTERNAL_REQUEST_HEADER]: key },
});
const req = (init?: RequestInit) => new Request("http://app/protected", init);

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

Deno.test("an expired session bearer is rejected with 401", async () => {
  const token = await bearerFor({ sessionExp: 1_000 });
  const res = await appWith().fromNetwork(req(bearer(token)));
  assertEquals(res.status, 401);
});

Deno.test("localhost callers are trusted and need no token", async () => {
  assertEquals((await appWith().fromLocalhost(req())).status, 200);
});

Deno.test("trustLocalhost:false requires a token from localhost (internal key still trusted)", async () => {
  const app = appWith({ trustLocalhost: false });
  assertEquals((await app.fromLocalhost(req())).status, 401);
  const token = await bearerFor({ source: "svc" });
  assertEquals((await app.fromLocalhost(req(bearer(token)))).status, 200);
  assertEquals(
    (await app.fromLocalhost(
      req({ headers: { [INTERNAL_REQUEST_HEADER]: INTERNAL } }),
    )).status,
    200,
  );
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

// ---- opaque-token exchange ----

Deno.test("an opaque token is exchanged at infra and the fresh bearer is handed back", async () => {
  const infraClient = stubInfra((opaque) => {
    assertEquals(opaque, "mtk_abc");
    return bearerFor({ source: "exchanged" });
  });
  const { fromNetwork, sources } = appWith({ infraClient });
  const res = await fromNetwork(req(bearer("mtk_abc")));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "exchanged");
  // The freshly-exchanged session bearer is returned for the client to cache.
  const handed = res.headers.get(SESSION_BEARER_HEADER);
  assertEquals(typeof handed, "string");
});

Deno.test("a failed exchange (revoked/unknown) → 401", async () => {
  const infraClient = stubInfra(() =>
    Promise.reject(new InfraError("revoked", 404))
  );
  const res = await appWith({ infraClient }).fromNetwork(
    req(bearer("mtk_gone")),
  );
  assertEquals(res.status, 401);
});

Deno.test("an opaque token with no infra client configured → 401", async () => {
  const res = await appWith().fromNetwork(req(bearer("mtk_abc")));
  assertEquals(res.status, 401);
});

// ---- revokeAll (break glass) ----

Deno.test("revokeAll ON: a cached session bearer is rejected (force re-exchange)", async () => {
  const token = await bearerFor({ source: "svc" });
  const res = await appWith({ revokeAll: () => true }).fromNetwork(
    req(bearer(token)),
  );
  assertEquals(res.status, 401);
  assertEquals(
    (await res.json()).message,
    "Session bearer not trusted (revoke-all active) — re-exchange your token.",
  );
});

Deno.test("revokeAll ON: an opaque token is still exchanged live and authorizes", async () => {
  const infraClient = stubInfra(() => bearerFor({ source: "live" }));
  const { fromNetwork, sources } = appWith({
    infraClient,
    revokeAll: () => true,
  });
  const res = await fromNetwork(req(bearer("mtk_live")));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "live");
});

// ---- Firebase ----

Deno.test("a valid Firebase token authorizes (no session bearer needed)", async () => {
  const { fromNetwork, sources } = appWith({ firebaseVerifier: stubFirebase });
  const res = await fromNetwork(req(bearer("good-fb")));
  assertEquals(res.status, 200);
  assertEquals(sources[0], "user@example.com");
});

Deno.test("revokeAll ON: Firebase tokens stay trusted (separate source)", async () => {
  const { fromNetwork } = appWith({
    firebaseVerifier: stubFirebase,
    revokeAll: () => true,
  });
  assertEquals((await fromNetwork(req(bearer("good-fb")))).status, 200);
});

Deno.test("an invalid credential is rejected even with Firebase configured", async () => {
  const res = await appWith({ firebaseVerifier: stubFirebase }).fromNetwork(
    req(bearer("garbage")),
  );
  assertEquals(res.status, 401);
});

// ---- createCredentialGuard ----

function guardCtx(opts: {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  hostname?: string;
  isPublic?: boolean;
  roles?: string[];
  claims?: string[];
  websocketTopic?: string;
}) {
  function handler() {}
  if (opts.isPublic) Reflect.defineMetadata(PUBLIC_METADATA_KEY, true, handler);
  if (opts.roles) {
    Reflect.defineMetadata(ROLES_METADATA_KEY, opts.roles, handler);
  }
  if (opts.claims) {
    Reflect.defineMetadata(CLAIMS_METADATA_KEY, opts.claims, handler);
  }
  const store = new Map<string, unknown>();
  const responseHeaders = new Map<string, string>();
  return {
    req: {
      header: (n: string) => opts.headers?.[n.toLowerCase()],
      query: (n: string) => opts.query?.[n],
    },
    env: opts.hostname
      ? { remoteAddr: { hostname: opts.hostname } }
      : undefined,
    getHandler: () => handler,
    getClass: () => function Ctrl() {},
    set: (k: string, v: unknown) => store.set(k, v),
    get: (k: string) => store.get(k),
    header: (k: string, v: string) => responseHeaders.set(k, v),
    responseHeaders,
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
    () =>
      Promise.resolve(
        g.canActivate(guardCtx({ hostname: "203.0.113.1" }) as unknown as Context),
      ),
    UnauthorizedException,
  );
});

Deno.test("guard: @Public route is allowed with no credential", async () => {
  const { g } = guard();
  assertEquals(
    await g.canActivate(
      guardCtx({ hostname: "203.0.113.1", isPublic: true }) as unknown as Context,
    ),
    true,
  );
});

Deno.test("guard: valid session bearer authorizes and sets source", async () => {
  const { g, logger } = guard();
  const token = await bearerFor({ source: "svc" });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    headers: { authorization: `Bearer ${token}` },
  });
  const ok = await logger.runInRequest("r", async () => {
    const r = await g.canActivate(ctx as unknown as Context);
    return { r, source: logger.currentRequest()?.source };
  });
  assertEquals(ok.r, true);
  assertEquals(ok.source, "svc");
});

Deno.test("guard: localhost and in-process callers are trusted", async () => {
  const { g } = guard();
  assertEquals(
    await g.canActivate(guardCtx({ hostname: "127.0.0.1" }) as unknown as Context),
    true,
  );
  assertEquals(
    await g.canActivate(
      guardCtx({
        hostname: "203.0.113.1",
        headers: { [INTERNAL_REQUEST_HEADER]: INTERNAL },
      }) as unknown as Context,
    ),
    true,
  );
});

Deno.test("guard: WS message contexts are skipped", async () => {
  const { g } = guard();
  assertEquals(
    await g.canActivate(guardCtx({ websocketTopic: "chat" }) as unknown as Context),
    true,
  );
});

// ---- @Roles / @claims enforcement ----

Deno.test("guard: @Roles allows a caller holding the (scoped) role", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { role: "test:admin" } });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    roles: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: a role for a different app does not satisfy @Roles", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { role: "other:admin" } });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    roles: ["admin"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: @claims authorizes against the scoped role claims", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { role: "test:docs" } });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    claims: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: @claims rejects a caller missing the claim with 403", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { role: "test:editor" } });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    claims: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: @Roles without any credential is 401", async () => {
  const { g } = guard();
  const ctx = guardCtx({ hostname: "203.0.113.1", roles: ["admin"] });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    UnauthorizedException,
  );
});

Deno.test("guard: attaches the resolved identity (claims + scoped roles)", async () => {
  const { g } = guard();
  const token = await bearerFor({
    source: "svc",
    claims: { role: "test:admin,other:x", team: "core" },
  });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    headers: { authorization: `Bearer ${token}` },
  });
  await g.canActivate(ctx as unknown as Context);
  const id = getIdentity(ctx as unknown as Context)!;
  assertEquals(id.source, "svc");
  assertEquals(id.roles, ["admin"]); // scoped to "test"
  assertEquals(id.claims.team, "core");
});

// ---- skeleton `*` ----

const recent = () => Math.floor(Date.now() / 1000) - 60;

Deno.test("guard: a fresh `*` skeleton bypasses required claims", async () => {
  const { g } = guard(); // honorSkeleton defaults true
  const token = await bearerFor({ claims: { role: "*" }, mintedAt: recent() });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    claims: ["docs"], // caller doesn't hold it, but `*` opens it
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: honorSkeleton:false ignores `*` (infra posture)", async () => {
  const { g } = guard({ honorSkeleton: false });
  const token = await bearerFor({ claims: { role: "*" }, mintedAt: recent() });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    claims: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: a `*` older than the 24h cap is not honored as skeleton", async () => {
  const { g } = guard();
  const stale = Math.floor(Date.now() / 1000) - 25 * 60 * 60;
  const token = await bearerFor({ claims: { role: "*" }, mintedAt: stale });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    claims: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: a `*` with no mintedAt fails closed (not honored)", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { role: "*" } }); // no mintedAt
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    claims: ["docs"],
    headers: { authorization: `Bearer ${token}` },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    ForbiddenException,
  );
});

Deno.test("guard: a `*` caller still authorizes a no-required-claims route (authenticated)", async () => {
  const { g } = guard();
  const token = await bearerFor({ claims: { role: "*" } });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    headers: { authorization: `Bearer ${token}` },
  });
  // No required claims ⇒ any authenticated identity passes regardless of skeleton.
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

// ---- ?token query-param + opaque exchange via the guard ----

Deno.test("guard: a valid session bearer in ?token authorizes", async () => {
  const { g } = guard();
  const token = await bearerFor({ source: "link" });
  const ctx = guardCtx({ hostname: "203.0.113.1", query: { token } });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
});

Deno.test("guard: an invalid ?token on a protected route is rejected (401)", async () => {
  const { g } = guard();
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    query: { token: "garbage" },
  });
  await assertRejects(
    () => Promise.resolve(g.canActivate(ctx as unknown as Context)),
    UnauthorizedException,
  );
});

Deno.test("guard: exchanges an opaque token and hands the bearer back via response header", async () => {
  const infraClient = stubInfra(() =>
    bearerFor({ source: "exch", claims: { role: "test:admin" } })
  );
  const { g } = guard({ infraClient });
  const ctx = guardCtx({
    hostname: "203.0.113.1",
    roles: ["admin"],
    headers: { authorization: "Bearer mtk_xyz" },
  });
  assertEquals(await g.canActivate(ctx as unknown as Context), true);
  assertEquals(typeof ctx.responseHeaders.get(SESSION_BEARER_HEADER), "string");
});
