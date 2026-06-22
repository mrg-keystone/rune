import { assertEquals, assertExists } from "#assert";
import { Server } from "./mod.ts";

Deno.test("Server - creates instance and registers modules", () => {
  class TestModule {}

  const server = Server.create();
  server.registerModule(TestModule);

  assertExists(server);
  assertEquals(server.modules.length, 1);
  assertEquals(server.modules[0], TestModule);
  assertEquals(server.moduleNames, ["TestModule"]);
});
