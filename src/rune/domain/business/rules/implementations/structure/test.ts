import { assertEquals } from "#std/assert";
import { resolveNode, getRequiredFiles, getExpectedAt, check } from "./mod.ts";
import type { PipelineContext } from "@/core/dto/types.ts";

function makeCtx(files: string[], dirs: string[]): PipelineContext {
  return {
    targetDir: "/fake",
    files,
    dirs,
    getFileContent: async () => "",
    getImports: async () => [],
    lsp: null,
  };
}

Deno.test("resolveNode — valid path", () => {
  const node = resolveNode(["bootstrap"]);
  assertEquals(node !== null, true);
});

Deno.test("resolveNode — invalid path", () => {
  const node = resolveNode(["nonexistent"]);
  assertEquals(node, null);
});

Deno.test("getRequiredFiles — bootstrap has mod and config", () => {
  const node = resolveNode(["bootstrap"]);
  const required = getRequiredFiles(node!);
  assertEquals(required.includes("mod"), true);
  assertEquals(required.includes("config"), true);
});

Deno.test("getRequiredFiles — excludes optional files", () => {
  const node = resolveNode(["bootstrap"]);
  const required = getRequiredFiles(node!);
  // bootstrap has no optional files, so length should be 2
  assertEquals(required.length, 2);
});

Deno.test("getExpectedAt — returns structure info", () => {
  const node = resolveNode(["bootstrap"]);
  const expected = getExpectedAt(node!);
  assertEquals(typeof expected.desc, "string");
});

Deno.test("check — bootstrap folder with required files passes", async () => {
  const ctx = makeCtx(
    ["bootstrap/mod.ts", "bootstrap/config.ts"],
    ["bootstrap"],
  );
  const result = await check("bootstrap", "folder", ctx);
  assertEquals(result, null);
});

Deno.test("check — file with correct extension passes", async () => {
  const ctx = makeCtx(
    ["bootstrap/mod.ts", "bootstrap/config.ts"],
    ["bootstrap"],
  );
  const result = await check("bootstrap/mod.ts", "ts", ctx);
  assertEquals(result, null);
});

Deno.test("check — file with wrong extension is flagged", async () => {
  const ctx = makeCtx(
    ["bootstrap/mod.js", "bootstrap/config.ts"],
    ["bootstrap"],
  );
  const result = await check("bootstrap/mod.js", "js", ctx);
  assertEquals(result !== null, true);
  assertEquals(result![0].includes("Wrong extension"), true);
});

Deno.test("check — fixture .json file is allowed", async () => {
  const ctx = makeCtx(
    ["fixtures/seeds/users.json"],
    ["fixtures", "fixtures/seeds"],
  );
  const result = await check("fixtures/seeds/users.json", "json", ctx);
  assertEquals(result, null);
});

Deno.test("check — fixture allows any file (ignore)", async () => {
  const ctx = makeCtx(
    ["fixtures/seeds/users.ts"],
    ["fixtures", "fixtures/seeds"],
  );
  const result = await check("fixtures/seeds/users.ts", "ts", ctx);
  assertEquals(result, null);
});

Deno.test("check — dto .ts file is allowed", async () => {
  const ctx = makeCtx(
    ["src/core/dto/types.ts"],
    ["src", "src/core", "src/core/dto"],
  );
  const result = await check("src/core/dto/types.ts", "ts", ctx);
  assertEquals(result, null);
});

Deno.test("check — assets file with any extension passes", async () => {
  const ctx = makeCtx(
    ["assets/images/logo.png"],
    ["assets", "assets/images"],
  );
  const result = await check("assets/images/logo.png", "png", ctx);
  assertEquals(result, null);
});

Deno.test("check — optional file present passes", async () => {
  const ctx = makeCtx(
    ["src/mymod/entrypoints/home/mod.ts", "src/mymod/entrypoints/home/template.html"],
    ["src", "src/mymod", "src/mymod/entrypoints", "src/mymod/entrypoints/home"],
  );
  const result = await check("src/mymod/entrypoints/home/template.html", "html", ctx);
  assertEquals(result, null);
});

Deno.test("check — optional file with wrong extension is flagged", async () => {
  const ctx = makeCtx(
    ["src/mymod/entrypoints/home/mod.ts", "src/mymod/entrypoints/home/template.ts"],
    ["src", "src/mymod", "src/mymod/entrypoints", "src/mymod/entrypoints/home"],
  );
  const result = await check("src/mymod/entrypoints/home/template.ts", "ts", ctx);
  assertEquals(result !== null, true);
  assertEquals(result![0].includes("Wrong extension"), true);
});

Deno.test("check — feature folder with only mod.ts (no test.ts) should be flagged", async () => {
  const ctx = makeCtx(
    ["src/mymod/domain/business/myfeat/mod.ts"],
    [
      "src",
      "src/mymod",
      "src/mymod/domain",
      "src/mymod/domain/business",
      "src/mymod/domain/business/myfeat",
    ],
  );
  const result = await check("src/mymod/domain/business/myfeat", "folder", ctx);
  assertEquals(result !== null, true, "feature folder with only mod.ts should be flagged");
});
