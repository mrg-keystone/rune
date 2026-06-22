import { assert } from "#std/assert";
import { buildContext } from "./mod.ts";

Deno.test("buildContext — reads current directory", async () => {
  const ctx = await buildContext(Deno.cwd(), new Set());
  assert(ctx.files.length > 0, "should find files");
  assert(ctx.dirs.length > 0, "should find directories");
  assert(ctx.targetDir === Deno.cwd());
});
