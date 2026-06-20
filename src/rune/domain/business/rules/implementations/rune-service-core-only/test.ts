import { assert, assertEquals } from "#std/assert";
import { check } from "./mod.ts";
import type { PipelineContext } from "@core/dto/types.ts";

function makeCtx(text: string): PipelineContext {
  return {
    targetDir: "/fake",
    files: [],
    dirs: [],
    getFileContent: () => Promise.resolve(text),
    getImports: () => Promise.resolve([]),
    lsp: null,
  };
}

const SRV_LINE = `[SRV] sc:db: DB_URL
    the datastore
    @docs https://docs.example.com/db`;

Deno.test("rune-service-core-only — flags [SRV] in a module spec", async () => {
  const spec = `[MOD] tasks\n${SRV_LINE}`;
  const result = await check("src/tasks/tasks.rune", "rune", makeCtx(spec));
  assert(result !== null);
  assertEquals(result!.length, 1);
  assert(result![0].includes("src/core/core.rune"));
  assert(result![0].includes("sc:db"));
});

Deno.test("rune-service-core-only — allows [SRV] in core.rune", async () => {
  const spec = `[MOD] core\n${SRV_LINE}`;
  const result = await check("src/core/core.rune", "rune", makeCtx(spec));
  assertEquals(result, null);
});

Deno.test("rune-service-core-only — no [SRV] in a module spec is fine", async () => {
  const spec = `[MOD] tasks
[REQ] task.create(InDto): OutDto
    db:task.save(InDto): void
    [RET] OutDto
[DTO] InDto: id
    x
[DTO] OutDto: id
    y
[TYP] id: string
    z`;
  const result = await check("src/tasks/tasks.rune", "rune", makeCtx(spec));
  assertEquals(result, null);
});

Deno.test("rune-service-core-only — skips non-project specs", async () => {
  const spec = `[MOD] doc\n${SRV_LINE}`;
  const result = await check("lang/docs/example.rune", "rune", makeCtx(spec));
  assertEquals(result, null);
});

Deno.test("rune-service-core-only — skips non-rune targets", async () => {
  const spec = `[MOD] tasks\n${SRV_LINE}`;
  const result = await check("src/tasks/tasks.rune", "ts", makeCtx(spec));
  assertEquals(result, null);
});
