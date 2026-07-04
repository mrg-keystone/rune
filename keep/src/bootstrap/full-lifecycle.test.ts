import "#reflect-metadata";
import { assertEquals, assertExists, assertStringIncludes } from "#assert";
import {
  bootstrapServer,
  DanetDocumentBuilder,
  DanetHttpAdapter,
  HttpAdapter,
  Server,
  setupWithSwagger,
  SwaggerDescription,
  InjectValue,
  InjectFactory,
  InjectClass,
  log,
  Public,
} from "./mod.ts";
import { Body, Controller, Get, Module, Post } from "#danet/core";

function captureConsole() {
  const lines: { level: string; args: unknown[] }[] = [];
  const orig = {
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.info = (...a: unknown[]) => void lines.push({ level: "info", args: a });
  console.warn = (...a: unknown[]) => void lines.push({ level: "warn", args: a });
  console.error = (...a: unknown[]) => void lines.push({ level: "error", args: a });
  console.debug = (...a: unknown[]) => void lines.push({ level: "debug", args: a });
  return {
    messages: () => lines.map((l) => String(l.args[0])),
    restore: () => Object.assign(console, orig),
  };
}

// -- Verify all public exports exist --

Deno.test("e2e: all public exports are defined", () => {
  assertExists(bootstrapServer);
  assertExists(DanetDocumentBuilder);
  assertExists(DanetHttpAdapter);
  assertExists(HttpAdapter);
  assertExists(Server);
  assertExists(setupWithSwagger);
  assertExists(SwaggerDescription);
  assertExists(InjectValue);
  assertExists(InjectFactory);
  assertExists(InjectClass);
});

// -- Full lifecycle: bootstrap, serve, swagger, teardown --

@SwaggerDescription("Health API - system health checks")
@Public() // health/echo/log are exercised over the network; no auth in the lifecycle tests
@Controller("health")
class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }

  @Post("echo")
  echo(@Body() body: { msg: string }) {
    return { echoed: body.msg };
  }

  @Get("log")
  emitLog() {
    log.info("custom event", { detail: 42 });
    return { logged: true };
  }
}

@Module({
  controllers: [HealthController],
})
class TestAppModule {}

// Base port for the over-the-wire lifecycle tests. Kept off the common 9100/3000 dev ports so a
// stray local `deno serve` can't squat it and make these fetches hit the wrong server.
let port = 9410;

Deno.test("e2e: bootstrap server with swagger, hit endpoints, teardown", async () => {
  const p = port++;
  const server = await bootstrapServer("e2e-app", TestAppModule, { port: p });
  await server.listen();

  // Health endpoint works
  const healthRes = await fetch(`http://localhost:${p}/health`);
  const healthBody = await healthRes.json();
  assertEquals(healthRes.status, 200);
  assertEquals(healthBody.status, "ok");

  // Swagger index page is served
  const docsRes = await fetch(`http://localhost:${p}/docs`);
  const docsHtml = await docsRes.text();
  assertEquals(docsRes.status, 200);
  assertStringIncludes(docsHtml, "<html");

  await server.stop();
});

Deno.test("e2e: bootstrap server without swagger", async () => {
  const p = port++;
  const server = await bootstrapServer("e2e-app", TestAppModule, { port: p, swagger: false });
  await server.listen();

  const healthRes = await fetch(`http://localhost:${p}/health`);
  const healthBody = await healthRes.json();
  assertEquals(healthRes.status, 200);
  assertEquals(healthBody.status, "ok");

  const docsRes = await fetch(`http://localhost:${p}/docs`);
  await docsRes.text();
  assertEquals(docsRes.status, 404);

  await server.stop();
});

Deno.test("e2e: Server + DanetDocumentBuilder + setupWithSwagger integration", async () => {
  const server = Server.create();
  server.registerModule(TestAppModule);

  assertEquals(server.modules.length, 1);
  assertEquals(server.moduleNames, ["TestAppModule"]);

  // Build swagger docs through the coordinator
  const adapter = await setupWithSwagger(server);
  assertExists(adapter);

  const routes = adapter.app.router.routes;
  const getPaths = routes
    .filter((r: { method: string }) => r.method === "GET")
    .map((r: { path: string }) => r.path);

  assertEquals(getPaths.includes("/docs"), true);
});

Deno.test("e2e: backend client hits the real pipeline in-process, without listen()", async () => {
  // Never call listen() — no port is bound. The backend dispatches via Hono's fetch.
  const server = await bootstrapServer("e2e-app", TestAppModule, { swagger: false });

  const health = await server.backend.fetch("/health");
  assertEquals(health.status, 200);
  assertEquals((await health.json()).status, "ok");

  // POST body is routed through @Body() and round-tripped back.
  const echo = await server.backend.fetch("/health/echo", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ msg: "hi" }),
  });
  assertEquals(echo.status, 200);
  assertEquals((await echo.json()).echoed, "hi");

  // Unknown routes still flow through the real 404 handling.
  const missing = await server.backend.fetch("/nope");
  assertEquals(missing.status, 404);

  await server.stop();
});

Deno.test("e2e: backend.fetch is a drop-in for global fetch (raw Response)", async () => {
  const server = await bootstrapServer("e2e-app", TestAppModule, { swagger: false });

  // Same call shape as global fetch — relative path, RequestInit, returns a Response.
  const res = await server.backend.fetch("/health");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { status: "ok" });

  // Accepts a Request object too, exactly like global fetch.
  const viaRequest = await server.backend.fetch(
    new Request("http://localhost/health/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "yo" }),
    }),
  );
  assertEquals(await viaRequest.json(), { echoed: "yo" });

  await server.stop();
});

Deno.test("e2e: bootstrapServer does not block — code after it (and after listen) runs", async () => {
  const p = port++;
  let reached = false;
  const server = await bootstrapServer("e2e-app", TestAppModule, { port: p, swagger: false });
  reached = true; // bootstrap returned (init only, no port bound)
  assertEquals(reached, true);

  await server.listen();
  reached = false;
  reached = true; // proves await listen() resolved and did not block until shutdown
  assertEquals(reached, true);

  await server.stop();
});

Deno.test("e2e: backend and the real network agree on the same response", async () => {
  const p = port++;
  const server = await bootstrapServer("e2e-app", TestAppModule, { port: p, swagger: false });
  await server.listen();

  const overWire = await (await fetch(`http://localhost:${p}/health`)).json();
  const inProcess = await (await server.backend.fetch("/health")).json();
  assertEquals(inProcess, overWire);

  await server.stop();
});

Deno.test("e2e: ingress/egress + in-handler log all share one request id", async () => {
  const cap = captureConsole();
  let result: { logged: boolean } | undefined;
  let reqId: string | null = null;
  try {
    const server = await bootstrapServer("log-app", TestAppModule, { swagger: false });
    const res = await server.backend.fetch("/health/log");
    reqId = res.headers.get("x-request-id");
    result = await res.json();
    await server.stop();
  } finally {
    cap.restore();
  }

  assertEquals(result?.logged, true);
  assertExists(reqId);

  const messages = cap.messages();
  // Generated id flows through ingress, the handler's own log.info, and egress.
  assertStringIncludes(
    messages.find((m) => m.startsWith("[ingress log-app")) ?? "",
    `[ingress log-app ${reqId}] GET /health/log`,
  );
  assertEquals(
    messages.includes(`[log-app ${reqId}] custom event`),
    true,
  );
  assertStringIncludes(
    messages.find((m) => m.startsWith("[egress log-app")) ?? "",
    `[egress log-app ${reqId}] GET /health/log`,
  );
});

Deno.test("e2e: a malicious x-request-id is sanitized (no log forging)", async () => {
  const server = await bootstrapServer("log-app", TestAppModule, { swagger: false });
  // Brackets/spaces are valid in a header value but would let an attacker forge log lines.
  const res = await server.backend.fetch("/health", {
    headers: { "x-request-id": "abc] [ingress log-app forged] GET /evil" },
  });
  const reqId = res.headers.get("x-request-id");
  await server.stop();

  assertExists(reqId);
  assertEquals(/^[A-Za-z0-9._-]+$/.test(reqId!), true); // only safe chars survive
  assertEquals(reqId!.includes("]"), false);
  assertEquals(reqId!.includes(" "), false);
});

Deno.test("e2e: incoming x-request-id is used as the correlation id", async () => {
  const cap = captureConsole();
  let reqId: string | null = null;
  try {
    const server = await bootstrapServer("log-app", TestAppModule, { swagger: false });
    const res = await server.backend.fetch("/health", {
      headers: { "x-request-id": "trace-abc" },
    });
    reqId = res.headers.get("x-request-id");
    await server.stop();
  } finally {
    cap.restore();
  }

  assertEquals(reqId, "trace-abc");
  assertEquals(
    cap.messages().some((m) => m.includes("[ingress log-app trace-abc] GET /health")),
    true,
  );
});

Deno.test("e2e: InjectValue, InjectFactory, InjectClass constructors", () => {
  const val = new InjectValue("TOKEN_A", 42);
  assertEquals(val.provide, "TOKEN_A");
  assertEquals(val.useValue, 42);

  const factory = new InjectFactory("TOKEN_B", () => "built");
  assertEquals(factory.provide, "TOKEN_B");
  assertEquals((factory.useFactory as () => string)(), "built");

  const cls = new InjectClass("TOKEN_C", HealthController);
  assertEquals(cls.provide, "TOKEN_C");
  assertEquals(cls.useClass, HealthController);
});
