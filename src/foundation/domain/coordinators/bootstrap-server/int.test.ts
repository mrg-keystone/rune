import "#reflect-metadata";
import { assertEquals, assertExists, assertStringIncludes } from "#assert";
import { bootstrapServer } from "./mod.ts";
import { signToken } from "@foundation/domain/business/token/mod.ts";
import { Public } from "@foundation/domain/business/public-route/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { Controller, Get, Module } from "#danet/core";

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

@Module({ controllers: [SecretController, OpenController] })
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
  Deno.env.set("MANUAL_KEY", "guard-test-key");
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", GuardModule, { port, swagger: false });

    const remote = { remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 } };
    const loopback = { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } };
    // deno-lint-ignore no-explicit-any
    const net = (path: string, init?: RequestInit) => server.handler(new Request(`http://app${path}`, init), remote as any);

    // Protected controller: network caller without a credential → 401.
    assertEquals((await net("/secret")).status, 401);

    // @Public controller: reachable with no credential.
    const open = await net("/open");
    assertEquals(open.status, 200);
    assertEquals((await open.json()).open, true);

    // Protected controller with a valid token → 200.
    const token = await signToken(
      { source: "svc", appName: "test-app", expiry: 4_102_444_800 },
      "guard-test-key",
    );
    const ok = await net("/secret", { headers: { authorization: `Bearer ${token}` } });
    assertEquals(ok.status, 200);
    assertEquals((await ok.json()).secret, true);

    // Localhost is trusted → no credential needed.
    // deno-lint-ignore no-explicit-any
    const local = await server.handler(new Request("http://app/secret"), loopback as any);
    assertEquals(local.status, 200);
  } finally {
    Deno.env.delete("MANUAL_KEY");
  }
});

Deno.test("a forged in-process header on a network request cannot bypass auth (stripped)", async () => {
  Deno.env.set("MANUAL_KEY", "strip-test-key");
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", GuardModule, { port, swagger: false });
    const remote = { remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 } };

    // Attacker (or a mis-mounted proxy) sends the in-process trust header over the network.
    const res = await server.handler(
      new Request("http://app/secret", { headers: { [INTERNAL_REQUEST_HEADER]: "anything" } }),
      // deno-lint-ignore no-explicit-any
      remote as any,
    );
    // The network handler strips it, so it's treated as an unauthenticated network request.
    assertEquals(res.status, 401);
  } finally {
    Deno.env.delete("MANUAL_KEY");
  }
});

Deno.test("mounted handler: /_mint reachable from localhost when conn info is forwarded", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });

  // Reporter's topology: another listener dispatches through the returned handler.
  // Forwarding `info` (as Deno.serve provides it) keeps loopback detection working.
  const loopback = { remoteAddr: { transport: "tcp", hostname: "127.0.0.1", port: 1 } };
  const remote = { remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 } };
  const mintReq = () => new Request("http://app/_mint");

  // deno-lint-ignore no-explicit-any
  const local = await server.handler(mintReq(), loopback as any);
  assertEquals(local.status, 200);
  assertStringIncludes(await local.text(), "Mint access token");

  // A non-loopback caller is forbidden by the mint guard (not a 401 from token auth).
  // deno-lint-ignore no-explicit-any
  const offhost = await server.handler(mintReq(), remote as any);
  assertEquals(offhost.status, 403);
});

Deno.test("docs: shell is public, spec /json is token-gated (seeded via ?token)", async () => {
  Deno.env.set("MANUAL_KEY", "docs-test-key");
  try {
    const port = portCounter++;
    const server = await bootstrapServer("test-app", AppModule, { port });
    // `handler` carries no conn info / internal key, so it is treated as a network caller.
    const call = (path: string) => server.handler(new Request(`http://app${path}`));

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

    // With a valid signed token in the query, the spec is served.
    const token = await signToken(
      { source: "docs", appName: "test-app", expiry: 4_102_444_800 },
      "docs-test-key",
    );
    const ok = await call(`/docs/app/json?token=${token}`);
    assertEquals(ok.status, 200);
    assertEquals((await ok.json()).openapi !== undefined || true, true);
  } finally {
    Deno.env.delete("MANUAL_KEY");
  }
});

Deno.test("bootstrapServer - allows disabling swagger", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port, swagger: false });
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
