import { assertEquals } from "#std/assert";
import { check } from "./mod.ts";
import type { PipelineContext } from "@core/dto/types.ts";

function ctxWith(rune: string, files: string[]): PipelineContext {
  return {
    targetDir: "/tmp",
    files,
    dirs: [],
    getFileContent: async () => rune,
    getImports: async () => [],
    lsp: null,
  };
}

Deno.test("check — skips non-rune files", async () => {
  const ctx = ctxWith("", []);
  const result = await check("src/foo/mod.ts", "ts", ctx);
  assertEquals(result, null);
});

Deno.test("check — passes when coordinator files exist", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id`;
  const ctx = ctxWith(rune, [
    "src/recording/domain/coordinators/recording-set/mod.ts",
    "src/recording/domain/coordinators/recording-set/int.test.ts",
  ]);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result, null);
});

Deno.test("check — flags missing mod.ts", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id`;
  const ctx = ctxWith(rune, [
    "src/recording/domain/coordinators/recording-set/int.test.ts",
  ]);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.length, 1);
  assertEquals(result?.[0].includes("mod.ts"), true);
  assertEquals(result?.[0].includes("recording-set"), true);
});

Deno.test("check — flags missing int.test.ts", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id`;
  const ctx = ctxWith(rune, [
    "src/recording/domain/coordinators/recording-set/mod.ts",
  ]);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.length, 1);
  assertEquals(result?.[0].includes("int.test.ts"), true);
});

Deno.test("check — multiple REQs flag separately", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id


[REQ] recording.get(InDto): OutDto
    id::create(name): id`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  // 2 REQs * 2 expected files = 4 violations
  assertEquals(result?.length, 4);
});

Deno.test("check — derives module name from filename when [MOD] missing", async () => {
  const rune = `[REQ] foo.bar(InDto): OutDto
    a::b(c): d`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  // Module derived from filename → "recording"
  assertEquals(result?.[0].includes("src/recording/"), true);
});

Deno.test("check — handles spec.rune (module from parent dir)", async () => {
  const rune = `[REQ] foo.bar(InDto): OutDto
    a::b(c): d`;
  const ctx = ctxWith(rune, []);
  const result = await check("src/orders/spec.rune", "rune", ctx);
  // spec.rune → use parent dir name → "orders"
  assertEquals(result?.[0].includes("src/orders/"), true);
});

Deno.test("check — skips rune files outside spec conventions (docs, examples, vendored)", async () => {
  const rune = `[REQ] foo.bar(InDto): OutDto
    a::b(c): d`;
  const ctx = ctxWith(rune, []);
  // Documentation rune file — should be skipped
  assertEquals(await check("rune/docs/example.rune", "rune", ctx), null);
  // Vendored rune file — should be skipped
  assertEquals(await check("vendor/lib/sample.rune", "rune", ctx), null);
  // Random rune file — should be skipped
  assertEquals(await check("readme.rune", "rune", ctx), null);
});

Deno.test("check — accepts specs/<name>.rune pattern", async () => {
  const rune = `[MOD] foo
[REQ] foo.bar(InDto): OutDto
    a::b(c): d`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/foo.rune", "rune", ctx);
  assertEquals(result !== null, true);
});

Deno.test("check — accepts src/<module>/spec.rune pattern", async () => {
  const rune = `[REQ] foo.bar(InDto): OutDto
    a::b(c): d`;
  const ctx = ctxWith(rune, []);
  const result = await check("src/orders/spec.rune", "rune", ctx);
  assertEquals(result !== null, true);
});

Deno.test("check — handles camelCase REQ verb forms", async () => {
  // [REQ] registerRecording(...) → noun=recording, verb=register, process=recording-register
  const rune = `[MOD] recording

[REQ] registerRecording(InDto): OutDto
    a::b(c): d`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.[0].includes("recording-register"), true);
});
