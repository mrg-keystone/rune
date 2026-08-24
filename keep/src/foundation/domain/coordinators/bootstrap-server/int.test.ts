import "#reflect-metadata";
import { assertEquals, assertExists, assertStringIncludes } from "#assert";
import { bootstrapServer } from "./mod.ts";
import { Controller, Get, Module } from "#danet/core";
import { endpointModule } from "@foundation/domain/business/endpoint-decorator/mod.ts";

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
  @Get()
  data() {
    return { open: true };
  }
}

@Controller("granted")
class GrantedController {
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

Deno.test("zero built-in auth: controller routes are open to network callers and the in-process client", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", GuardModule, {
    port,
    swagger: false,
  });
  const remote = {
    remoteAddr: { transport: "tcp", hostname: "203.0.113.5", port: 1 },
  };
  const net = (path: string, init?: RequestInit) =>
    // deno-lint-ignore no-explicit-any
    server.handler(new Request(`http://app${path}`, init), remote as any);

  // keep ships ZERO built-in auth: every controller route answers a bare
  // network caller. Auth, if an app wants it, is the app's own guard.
  const secret = await net("/secret");
  assertEquals(secret.status, 200);
  assertEquals((await secret.json()).secret, true);
  assertEquals((await net("/open")).status, 200);
  assertEquals((await net("/granted")).status, 200);

  // The in-process client reaches the same routes identically (dispatch, not trust).
  const inproc = await server.backend.fetch("/secret");
  assertEquals(inproc.status, 200);
  await inproc.body?.cancel();
  await server.stop();
});

Deno.test("docs: shell, swagger UI, and the /json spec are all served openly", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });
  const call = (path: string) =>
    server.handler(new Request(`http://app${path}`));

  const emulator = await call("/docs/app");
  assertEquals(emulator.status, 200);
  assertStringIncludes(await emulator.text(), "process emulator");

  const shell = await call("/docs/app/swagger");
  assertEquals(shell.status, 200);
  assertStringIncludes(await shell.text(), "swagger-ui");

  // The spec is open — no token machinery exists.
  const spec = await call("/docs/app/json");
  assertEquals(spec.status, 200);
  assertExists((await spec.json()).info);
  await server.stop();
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
  @Get("invalid")
  invalid() {
    throw Object.assign(new Error("Validation failed for XDto: a: m"), {
      name: "RuneAssertError",
      target: "XDto",
      context: "x.create input",
      failures: [{ path: "a", constraint: "isString", message: "m" }],
    });
  }

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

@Controller("alpha")
class AlphaController {
  @Get()
  get() {
    return { mod: "alpha" };
  }
}

@Controller("beta")
class BetaController {
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

// POST /docs/_run is covered comprehensively in run-endpoint.int.test.ts
// (report shape, seeds, forced cycle, dryRun — the door is open like every route).

Deno.test("lifecycle: onStart fires once on listen() with backend + bound port; disposer + onStop run on stop()", async () => {
  const port = portCounter++;
  let starts = 0;
  let stops = 0;
  let disposed = 0;
  let startedPort = -1;
  let hadBackend = false;
  const server = await bootstrapServer("test-app", AppModule, {
    port,
    onStart: (ctx) => {
      starts++;
      startedPort = ctx.port;
      hadBackend = typeof ctx.backend?.fetch === "function";
      return () => {
        disposed++;
      };
    },
    onStop: () => {
      stops++;
    },
  });

  const { port: bound } = await server.listen();
  assertEquals(starts, 1, "onStart fires exactly once on listen()");
  assertEquals(startedPort, bound, "onStart receives the actually-bound port");
  assertEquals(hadBackend, true, "onStart receives the in-process backend client");

  await server.stop();
  assertEquals(disposed, 1, "the onStart disposer runs on stop()");
  assertEquals(stops, 1, "onStop runs on stop()");
});

Deno.test("lifecycle: the handler path (deno serve) fires onStart once on the first request", async () => {
  const port = portCounter++;
  let starts = 0;
  const ports: number[] = [];
  const server = await bootstrapServer("test-app", AppModule, {
    port,
    onStart: (ctx) => {
      starts++;
      ports.push(ctx.port);
    },
  });

  // No listen() — drive the standalone handler as `deno serve` would.
  await server.handler(new Request("http://app/health"));
  await server.handler(new Request("http://app/health"));
  // The start hook is fire-and-forget; let its microtask settle.
  await new Promise((r) => setTimeout(r, 0));

  assertEquals(starts, 1, "onStart fires once across repeated handler calls");
  assertEquals(ports, [0], "port is 0 under the handler path (no socket bound by keep)");
});

Deno.test("lifecycle: a first request then listen() starts only one loop (once-guard)", async () => {
  const port = portCounter++;
  let starts = 0;
  const server = await bootstrapServer("test-app", AppModule, {
    port,
    onStart: () => {
      starts++;
    },
  });

  // A request lands on the handler first (deno serve path), THEN listen() runs — the guard must
  // still fire onStart exactly once across both entry points.
  await server.handler(new Request("http://app/health"));
  await new Promise((r) => setTimeout(r, 0));
  await server.listen();
  assertEquals(starts, 1, "onStart fires once across handler + listen entry points");
  await server.stop();
});

Deno.test("lifecycle: no callbacks means the handler is the un-wrapped adapter handler", async () => {
  const port = portCounter++;
  const server = await bootstrapServer("test-app", AppModule, { port });
  // Without onStart, handler must behave exactly as before (no wrapping, still serves).
  const res = await server.handler(new Request("http://app/health"));
  assertEquals(res.status, 200);
  await server.stop();
});
