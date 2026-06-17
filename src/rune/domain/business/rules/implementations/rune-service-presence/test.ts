import { assert, assertEquals } from "#std/assert";
import { check } from "./mod.ts";
import type { PipelineContext } from "@core/dto/types.ts";

function makeCtx(text: string): PipelineContext {
  return {
    targetDir: "/fake",
    files: [],
    dirs: [],
    getFileContent: async () => text,
    getImports: async () => [],
    lsp: null,
  };
}

const WITH_UNDECLARED = `[MOD] checkout
[REQ] order.create(InDto): OutDto
    firebase:order.save(InDto): void
    [RET] OutDto
[DTO] InDto: id
    x
[DTO] OutDto: id
    y
[TYP] id: string
    z`;

Deno.test("rune-service-presence — flags an undeclared service", async () => {
  const result = await check(
    "src/checkout/checkout.rune",
    "rune",
    makeCtx(WITH_UNDECLARED),
  );
  assert(result !== null);
  assertEquals(result!.length, 1);
  assert(result![0].includes('Undeclared service "firebase"'));
});

Deno.test("rune-service-presence — passes once the [SRV] is declared", async () => {
  const declared = WITH_UNDECLARED +
    "\n[SRV] sk:firebase: FIREBASE_API_KEY\n    Firebase callable";
  const result = await check(
    "src/checkout/checkout.rune",
    "rune",
    makeCtx(declared),
  );
  assertEquals(result, null);
});

Deno.test("rune-service-presence — skips non-rune targets", async () => {
  const result = await check(
    "src/checkout/checkout.rune",
    "ts",
    makeCtx(WITH_UNDECLARED),
  );
  assertEquals(result, null);
});
