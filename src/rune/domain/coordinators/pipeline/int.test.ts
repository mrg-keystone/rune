import { assertEquals } from "#std/assert";
import { runPipeline } from "./mod.ts";
import type { RuleDefinition } from "@core/dto/types.ts";

Deno.test("runPipeline — no violations on empty rule set", async () => {
  const rules: RuleDefinition[] = [];
  const results = await runPipeline(Deno.cwd(), rules);
  assertEquals(results.length, 0);
});
