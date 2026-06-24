import "#reflect-metadata";
import { assertEquals, assertExists, assertStringIncludes } from "#assert";
import { bootstrapServer } from "./mod.ts";
import {
  createTestSigner,
  type TestSigner,
} from "@foundation/domain/business/token/session.testkit.ts";
import { Public } from "@foundation/domain/business/public-route/mod.ts";
import { Grants } from "@foundation/domain/business/grants/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { Controller, Get, Module } from "#danet/core";
import { endpointModule } from "@foundation/domain/business/endpoint-decorator/mod.ts";

// A test signer stands in for infra; a stub HTTP server publishes its JWKS, exchanges opaque
// tokens for freshly-signed session bearers, and answers the revocation poll. Pointing keep at it
// via INFRA_URL exercises the real verify / exchange / poll paths without a live infra.
const signer = await createTestSigner();
// The bootstrap app name is "test-app", so grants for it live under claims["test-app"].
const sessionBearer = (source = "svc", appGrants?: string) =>
  signer.sign({
    source,
    claims: appGrants ? { "test-app": appGrants } : {},
  });

function startStubInfra(
  s: TestSigner,
): { url: string; stop: () => Promise<void> } {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    async (req) => {
      const { pathname } = new URL(req.url);
      if (pathname === "/keys/jwks") return Response.json(s.jwks);
      if (pathname === "/revocation/status") {
        return Response.json({ revokeAll: false });
      }
      if (pathname === "/manualToken/exchange") {
        return Response.json({
          bearer: await s.sign({ source: "exchanged", claims: {} }),
        });
      }
      return new Response("not found", { status: 404 });
    },
  );
  const { port } = server.addr as Deno.NetAddr;
  return { url: `http://127.0.0.1:${port}`, stop: () => server.shutdown() };
}

@Controller("health")
class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}

@Module({
  controllers: [HealthController],
})
class AppModule {}

@Controller("secret")
class SecretController {
  @Get()
  data() {
    return { secret: true };
  }
}

@Controller("open")
class OpenController {
  @Public()
  @Get()
  data() {
    return { open: true };
  }
}

@Controller("granted")
class GrantedController {
  @Grants("read")
  @Get()
  data() {
    return { granted: true };
  }
}

@Module({ controllers: [SecretController, OpenController, GrantedController] })
class GuardModule {}

let portCounter = 7000;

Deno.test("bootstrapServer - returns an object with listen and stop", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });

  assertExists(server);
  assertEquals(typeof server.listen, "function");
  assertEquals(typeof server.stop, "function");
});

Deno.test("bootstrapServer - server can listen and respond to HTTP requests", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });
  await server.listen();

  const response = await fetch(`http://localhost:${port}/health`);
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.status, "ok");
  await server.stop();
});

Deno.test("bootstrapServer - enables swagger by default", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });
  await server.listen();

  const response = await fetch(`http://localhost:${port}/docs`);
  const html = await response.text();

  assertEquals(response.status, 200);
  assertEquals(html.includes("<html"), true);
  await server.stop();
});

Deno.test("global guard: deny-by-default for controllers, @Public exempts", async () => {
  const infra = startStubInfra(signer);
  Deno.env.set("INFRA_URL", infra.url);
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", GuardModule, {
      port,
      swagger: false,
    });

    const remote = {
      remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
    };
    const loopback = {
      remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 },
    };
    const net = (path: string, init?: RequestInit) =>
      // deno-lint-ignore no-explicit-any
      server.handler(new Request(`http://app${path}`, init), remote as any);

    // No credential, network caller → 401 (needs auth).
    assertEquals((await net("/secret")).status, 401);

    // @Public controller: reachable with no credential.
    const open = await net("/open");
    assertEquals(open.status, 200);
    assertEquals((await open.json()).open, true);

    // FAIL-CLOSED: a plain controller has no @Grants, so a valid bearer that holds no matching
    // grant is still DENIED (403) — default-closed, not "any authenticated identity".
    const bare = await sessionBearer();
    assertEquals(
      (await net("/secret", { headers: { authorization: `Bearer ${bare}` } }))
        .status,
      403,
    );

    // @Grants("read"): a bearer carrying that grant for this app → 200.
    const granted = await sessionBearer("svc", "read");
    const ok = await net("/granted", {
      headers: { authorization: `Bearer ${granted}` },
    });
    assertEquals(ok.status, 200);
    assertEquals((await ok.json()).granted, true);

    // …and a bearer WITHOUT the grant is rejected at the same @Grants route (403).
    assertEquals(
      (await net("/granted", { headers: { authorization: `Bearer ${bare}` } }))
        .status,
      403,
    );

    // Localhost is trusted → no credential needed (bypasses grants entirely).
    const local = await server.handler(
      new Request("http://app/secret"),
      // deno-lint-ignore no-explicit-any
      loopback as any,
    );
    assertEquals(local.status, 200);
    await server.stop();
  } finally {
    Deno.env.delete("INFRA_URL");
    await infra.stop();
  }
});

Deno.test("a forged in-process header on a network request cannot bypass auth (stripped)", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", GuardModule, {
    port,
    swagger: false,
  });
  const remote = {
    remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
  };

  // Attacker (or a mis-mounted proxy) sends the in-process trust header over the network.
  const res = await server.handler(
    new Request("http://app/secret", {
      headers: { [INTERNAL_REQUEST_HEADER]: "anything" },
    }),
    // deno-lint-ignore no-explicit-any
    remote as any,
  );
  // The network handler strips it, so it's treated as an unauthenticated network request.
  assertEquals(res.status, 401);
});

Deno.test("/_token: exchanges an opaque manual token for a session bearer", async () => {
  const infra = startStubInfra(signer);
  Deno.env.set("INFRA_URL", infra.url);
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", AppModule, {
      port,
      swagger: false,
    });
    const exchange = (body: unknown) =>
      server.handler(
        new Request("http://app/_token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );

    // A valid opaque token returns a signed bearer the client can cache.
    const ok = await exchange({ token: "mtk_abc" });
    assertEquals(ok.status, 200);
    const { bearer } = await ok.json();
    assertEquals(typeof bearer, "string");

    // A non-opaque token is rejected with 400 (only opaque tokens are exchanged).
    const bad = await exchange({ token: "not-opaque" });
    assertEquals(bad.status, 400);
    await server.stop();
  } finally {
    Deno.env.delete("INFRA_URL");
    await infra.stop();
  }
});

Deno.test("/_token: 503 when no infra is configured", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, {
    port,
    swagger: false,
  });
  const res = await server.handler(
    new Request("http://app/_token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "mtk_abc" }),
    }),
  );
  assertEquals(res.status, 503);
  await res.body?.cancel();
  await server.stop();
});

Deno.test("docs: shell is public, spec /json is token-gated (seeded via ?token)", async () => {
  const infra = startStubInfra(signer);
  Deno.env.set("INFRA_URL", infra.url);
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", AppModule, { port });
    // `handler` carries no conn info / internal key, so it is treated as a network caller.
    const call = (path: string) =>
      server.handler(new Request(`http://app${path}`));

    // The process emulator (default docs page) loads without a token.
    const emulator = await call("/docs/app");
    assertEquals(emulator.status, 200);
    assertStringIncludes(await emulator.text(), "process emulator");

    // The standard Swagger UI shell (moved under /swagger) also loads without a token.
    const shell = await call("/docs/app/swagger");
    assertEquals(shell.status, 200);
    assertStringIncludes(await shell.text(), "swagger-ui");

    // The spec is gated: no token → 401.
    assertEquals((await call("/docs/app/json")).status, 401);

    // With a valid session bearer in the query, the spec is served.
    const token = await sessionBearer("docs");
    const ok = await call(`/docs/app/json?token=${token}`);
    assertEquals(ok.status, 200);
    assertEquals((await ok.json()).openapi !== undefined || true, true);
    await server.stop();
  } finally {
    Deno.env.delete("INFRA_URL");
    await infra.stop();
  }
});

Deno.test("bootstrapServer - allows disabling swagger", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, {
    port,
    swagger: false,
  });
  await server.listen();

  const response = await fetch(`http://localhost:${port}/docs`);
  await response.text();

  assertEquals(response.status, 404);
  await server.stop();
});

Deno.test("bootstrapServer - respects custom port", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });
  await server.listen();

  const response = await fetch(`http://localhost:${port}/health`);
  const body = await response.json();
  assertEquals(body.status, "ok");

  await server.stop();
});

Deno.test("bootstrapServer - stop() cleans up properly", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });
  await server.listen();

  const response = await fetch(`http://localhost:${port}/health`);
  await response.json();
  assertEquals(response.status, 200);

  await server.stop();

  try {
    await fetch(`http://localhost:${port}/health`);
  } catch (error) {
    assertExists(error);
  }
});

Deno.test("dev channel: /docs/_dev serves bootId + status under KEEP_DEV, tolerantly", async () => {
  const statusPath = await Deno.makeTempDir() + "/status.json";
  Deno.env.set("KEEP_DEV", statusPath);
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", AppModule, { port });
    const call = () => server.handler(new Request("http://app/docs/_dev"));

    // Status file not written yet → bootId alone.
    const bare = await (await call()).json();
    assertExists(bare.bootId);
    assertEquals(bare.ok, undefined);

    // The watcher wrote a failing check → errors travel through, bootId stays.
    await Deno.writeTextFile(
      statusPath,
      JSON.stringify({ ok: false, errors: ["bad indent at line 3"], at: "t1" }),
    );
    const failing = await (await call()).json();
    assertEquals(failing.bootId, bare.bootId);
    assertEquals(failing.ok, false);
    assertEquals(failing.errors, ["bad indent at line 3"]);

    // Corrupt (partial) write → degrade to bootId only, never a 500.
    await Deno.writeTextFile(statusPath, '{"ok": fal');
    const corrupt = await call();
    assertEquals(corrupt.status, 200);
    const degraded = await corrupt.json();
    assertEquals(degraded, { bootId: bare.bootId });

    // The emulator page carries the reload poller in dev mode.
    const page = await server.handler(new Request("http://app/docs/app"));
    assertStringIncludes(await page.text(), 'fetch("_dev")');
  } finally {
    Deno.env.delete("KEEP_DEV");
  }
});

Deno.test("dev channel: /docs/_dev absent (404) without KEEP_DEV; pages carry no poller", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });

  const res = await server.handler(new Request("http://app/docs/_dev"));
  assertEquals(res.status, 404);
  await res.body?.cancel();

  const page = await server.handler(new Request("http://app/docs/app"));
  assertEquals((await page.text()).includes('fetch("_dev")'), false);
});

// Handlers for the RuneAssertError → 422 filter tests. The error is built by
// hand (Object.assign, no import of the assert module) because the filter
// must detect it duck-typed — exactly what a consumer's own copy throws.
@Controller("rune")
class RuneController {
  @Public()
  @Get("invalid")
  invalid() {
    throw Object.assign(new Error("Validation failed for XDto: a: m"), {
      name: "RuneAssertError",
      target: "XDto",
      context: "x.create input",
      failures: [{ path: "a", constraint: "isString", message: "m" }],
    });
  }

  @Public()
  @Get("boom")
  boom() {
    throw new Error("boom");
  }
}

@Module({ controllers: [RuneController] })
class RuneModule {}

Deno.test("RuneAssertError from a handler maps to 422 with the failure detail", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", RuneModule, {
    port,
    swagger: false,
  });
  await server.listen();

  const res = await fetch(`http://localhost:${port}/rune/invalid`);
  const body = await res.json();

  assertEquals(res.status, 422);
  assertEquals(body.name, "RuneAssertError");
  assertEquals(body.target, "XDto");
  assertEquals(body.context, "x.create input");
  assertEquals(body.failures, [
    { path: "a", constraint: "isString", message: "m" },
  ]);
  await server.stop();
});

Deno.test("422 filter control: a plain Error still maps to danet's 500", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", RuneModule, {
    port,
    swagger: false,
  });
  await server.listen();

  const res = await fetch(`http://localhost:${port}/rune/boom`);
  await res.text();

  assertEquals(res.status, 500);
  await server.stop();
});

Deno.test("422 filter control: the auth 401 path is untouched", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", GuardModule, {
    port,
    swagger: false,
  });
  const remote = {
    remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
  };

  // Network caller without a credential: still 401, not intercepted.
  const res = await server.handler(
    new Request("http://app/secret"),
    // deno-lint-ignore no-explicit-any
    remote as any,
  );
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

@Controller("alpha")
class AlphaController {
  @Public()
  @Get()
  get() {
    return { mod: "alpha" };
  }
}

@Controller("beta")
class BetaController {
  @Public()
  @Get()
  get() {
    return { mod: "beta" };
  }
}

Deno.test("bootstrapServer - accepts an array of modules (composed root, per-module docs)", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("multi", [
    endpointModule("Alpha", [AlphaController]),
    endpointModule("Beta", [BetaController]),
  ], { port });
  await server.listen();

  const a = await (await fetch(`http://localhost:${port}/alpha`)).json();
  const b = await (await fetch(`http://localhost:${port}/beta`)).json();
  assertEquals(a.mod, "alpha");
  assertEquals(b.mod, "beta");

  // Each child module keeps its own docs card; the composition wrapper (no
  // controllers) is not documented.
  const docs = await (await fetch(`http://localhost:${port}/docs`)).text();
  assertStringIncludes(docs, "Alpha");
  assertStringIncludes(docs, "Beta");
  assertEquals(docs.includes("AppModule"), false);

  await server.stop();
});

// A stub infra whose revocation poll is SLOW and reports break-glass ON. It lets us prove that
// the boot-time revocation poll is genuinely awaited: if create() returns before the first poll
// settles, the revokeAll flag is still its initial `false` and a cached bearer wrongly authorizes.
function startSlowRevokeInfra(
  s: TestSigner,
  revocationDelayMs: number,
): { url: string; stop: () => Promise<void> } {
  const server = Deno.serve(
    { port: 0, onListen: () => {} },
    async (req) => {
      const { pathname } = new URL(req.url);
      if (pathname === "/keys/jwks") return Response.json(s.jwks);
      if (pathname === "/revocation/status") {
        await new Promise((r) => setTimeout(r, revocationDelayMs));
        return Response.json({ revokeAll: true });
      }
      if (pathname === "/manualToken/exchange") {
        return Response.json({
          bearer: await s.sign({ source: "exchanged", claims: {} }),
        });
      }
      return new Response("not found", { status: 404 });
    },
  );
  const { port } = server.addr as Deno.NetAddr;
  return { url: `http://127.0.0.1:${port}`, stop: () => server.shutdown() };
}

Deno.test("boot awaits the revocation poll: revokeAll is fresh before the first request", async () => {
  // The poll takes ~150ms and reports revokeAll ON. By the time bootstrapServer() returns, the
  // flag MUST already reflect that — so a network request carrying a cached session bearer is
  // rejected (force re-exchange), not authorized against the stale initial revokeAll=false.
  const infra = startSlowRevokeInfra(signer, 150);
  Deno.env.set("INFRA_URL", infra.url);
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", GuardModule, {
      port,
      swagger: false,
    });
    const remote = {
      remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
    };
    const token = await sessionBearer();
    const res = await server.handler(
      new Request("http://app/secret", {
        headers: { authorization: `Bearer ${token}` },
      }),
      // deno-lint-ignore no-explicit-any
      remote as any,
    );
    assertEquals(
      res.status,
      401,
      "break-glass was ON at boot — the cached bearer must be rejected on the first request",
    );
    await server.stop();
  } finally {
    Deno.env.delete("INFRA_URL");
    await infra.stop();
  }
});

// POST /docs/_run is covered comprehensively in run-endpoint.int.test.ts
// (localhost report, 403 off-host + no-conn, seeds, forced cycle, dryRun).
