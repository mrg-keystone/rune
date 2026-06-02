import { assertEquals } from "#std/assert";
import { quickQuery } from "./mod.ts";

Deno.test({
  name: "quickQuery — smoke test",
  ignore: Deno.env.get("CI") === "true",
  async fn() {
    const result = await quickQuery("Reply with exactly: OK", {
      systemPrompt: "You are a test bot. Reply with exactly what is asked.",
      model: "claude-haiku-4-5-20251001",
    });
    assertEquals(typeof result, "string");
  },
});
