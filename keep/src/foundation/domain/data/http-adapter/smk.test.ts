import { assertExists } from "#assert";
import { DanetHttpAdapter, HttpAdapter } from "./mod.ts";

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
