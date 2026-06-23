import "#reflect-metadata";
import { assertEquals, assertExists } from "#assert";
import { Module } from "#danet/core";
import { DanetHttpAdapter, HttpAdapter } from "./mod.ts";

@Module({})
class EmptyModule {}

Deno.test("DanetHttpAdapter - can be instantiated", () => {
  const adapter = new DanetHttpAdapter(3000);
  assertExists(adapter);
  assertExists(adapter.app);
});

Deno.test("DanetHttpAdapter - extends HttpAdapter", () => {
  const adapter = new DanetHttpAdapter(4000);
  assertExists(adapter instanceof HttpAdapter);
});

Deno.test("DanetHttpAdapter - defaultPort is set", () => {
  const adapter = new DanetHttpAdapter(5000);
  assertExists(adapter.defaultPort);
});

Deno.test("DanetHttpAdapter - walks to the next port when the requested one is busy", async () => {
  const startPort = 38_500;
  // Occupy startPort so listen() must fall through to the next free port.
  const blocker = Deno.serve(
    { port: startPort, onListen: () => {} },
    () => new Response("busy"),
  );
  const adapter = new DanetHttpAdapter(startPort);
  try {
    const { port } = await adapter.listen(EmptyModule);
    assertEquals(port, startPort + 1, "should bind the next port, not error");
    assertEquals(adapter.boundPort, startPort + 1);
  } finally {
    await adapter.stop();
    await blocker.shutdown();
  }
});
