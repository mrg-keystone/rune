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

Deno.test("check — no [ENT] means no violations", async () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void`;
  const ctx = ctxWith(rune, []);
  assertEquals(await check("specs/recording.rune", "rune", ctx), null);
});

Deno.test("check — passes when entrypoint files exist", async () => {
  const rune = `[MOD] recording

[ENT] http.postRecording(InDto): IdDto`;
  const ctx = ctxWith(rune, [
    "src/recording/entrypoints/http/mod.ts",
    "src/recording/entrypoints/http/e2e.test.ts",
  ]);
  assertEquals(await check("specs/recording.rune", "rune", ctx), null);
});

Deno.test("check — flags missing entrypoint files", async () => {
  const rune = `[MOD] recording

[ENT] http.postRecording(InDto): IdDto`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.length, 2);
  assertEquals(result?.[0].includes("/entrypoints/http/mod.ts"), true);
  assertEquals(result?.[1].includes("/entrypoints/http/e2e.test.ts"), true);
});

Deno.test("check — multiple [ENT] surfaces", async () => {
  const rune = `[MOD] recording

[ENT] http.postRecording(InDto): IdDto
[ENT] cli.uploadRecording(InDto): IdDto`;
  const ctx = ctxWith(rune, []);
  const result = await check("specs/recording.rune", "rune", ctx);
  assertEquals(result?.length, 4);
});
