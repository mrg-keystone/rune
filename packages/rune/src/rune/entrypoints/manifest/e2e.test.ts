import { assertEquals } from "#std/assert";
import { runManifest } from "./mod.ts";

Deno.test("runManifest — usage error when no rune path given", async () => {
  const code = await runManifest([]);
  assertEquals(code, 2);
});
