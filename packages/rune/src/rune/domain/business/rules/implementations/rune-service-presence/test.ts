import { assert, assertEquals } from "#std/assert";
import { check } from "./mod.ts";
import type { PipelineContext } from "@core/dto/types.ts";

// Multi-file ctx: services are shared, so the rule resolves a module spec's
// boundary services against src/core/core.rune, not the spec itself.
function makeCtx(files: Record<string, string>): PipelineContext {
  return {
    targetDir: "/fake",
    files: Object.keys(files),
    dirs: [],
    getFileContent: (rel: string) => Promise.resolve(files[rel] ?? ""),
    getImports: () => Promise.resolve([]),
    lsp: null,
  };
}

const MODULE_SPEC = `[MOD] checkout
[REQ] order.create(InDto): OutDto
    firebase:order.save(InDto): void
    [RET] OutDto
[DTO] InDto: id
    x
[DTO] OutDto: id
    y
[TYP] id: string
    z`;

const CORE_SPEC = `[MOD] core
[SRV] (SDK)firebase: FIREBASE_API_KEY
    Firebase callable
    @docs https://firebase.google.com/docs/functions`;

Deno.test("rune-service-presence — flags a service no core.rune declares", async () => {
  const result = await check(
    "src/checkout/checkout.rune",
    "rune",
    makeCtx({ "src/checkout/checkout.rune": MODULE_SPEC }),
  );
  assert(result !== null);
  assertEquals(result!.length, 1);
  assert(result![0].includes('Undeclared service "firebase"'));
  assert(result![0].includes("src/core/core.rune"));
});

Deno.test("rune-service-presence — resolves a service declared in core.rune", async () => {
  const result = await check(
    "src/checkout/checkout.rune",
    "rune",
    makeCtx({
      "src/checkout/checkout.rune": MODULE_SPEC,
      "src/core/core.rune": CORE_SPEC,
    }),
  );
  assertEquals(result, null);
});

Deno.test("rune-service-presence — core.rune resolves against its own [SRV]", async () => {
  // The core spec is its own source of truth; a boundary it calls resolves
  // against the [SRV] it declares (no separate core to read).
  const coreWithBoundary = CORE_SPEC +
    `\n[REQ] order.create(InDto): OutDto
    firebase:order.save(InDto): void
    [RET] OutDto
[DTO] InDto: id
    x
[DTO] OutDto: id
    y
[TYP] id: string
    z`;
  const result = await check(
    "src/core/core.rune",
    "rune",
    makeCtx({ "src/core/core.rune": coreWithBoundary }),
  );
  assertEquals(result, null);
});

Deno.test("rune-service-presence — skips non-rune targets", async () => {
  const result = await check(
    "src/checkout/checkout.rune",
    "ts",
    makeCtx({ "src/checkout/checkout.rune": MODULE_SPEC }),
  );
  assertEquals(result, null);
});
