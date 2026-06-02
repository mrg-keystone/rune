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
  assertEquals(await check("src/foo/mod.ts", "ts", ctx), null);
});

Deno.test("check — passes when adapter exists", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void`;
  const ctx = ctxWith(rune, [
    "src/recording/domain/data/metadata/mod.ts",
    "src/recording/domain/data/metadata/smk.test.ts",
  ]);
  assertEquals(await check("specs/recording.rune", "rune", ctx), null);
});

Deno.test("check — flags missing adapter mod.ts", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void`;
  const ctx = ctxWith(rune, [
    "src/recording/domain/data/metadata/smk.test.ts",
  ]);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.length, 1);
  assertEquals(result?.[0].includes("/data/metadata/mod.ts"), true);
  assertEquals(result?.[0].includes("db:metadata"), true);
});

Deno.test("check — collects boundaries across all tags", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
    os:storage.save(id, data): void
    ex:provider.search(id): SearchDto`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  // 3 services × 2 expected files each = 6 violations
  assertEquals(result?.length, 6);
});

Deno.test("check — collects boundaries inside [PLY] cases", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(id): data
        [CSE] genie
        ex:provider.search(id): SearchDto`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.length, 2);
  assertEquals(result?.some((v) => v.includes("ex:provider")), true);
});

Deno.test("check — same noun under different tags is collapsed", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
    db:metadata.get(id): MetaDto`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  // 1 service (metadata, first occurrence wins) × 2 expected files
  assertEquals(result?.length, 2);
});
