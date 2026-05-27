import "#reflect-metadata";
import { assertEquals, assertExists } from "#assert";
import { bootstrapServer } from "./mod.ts";
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
