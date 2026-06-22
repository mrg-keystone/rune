import { assertEquals } from "#std/assert";
import { check } from "./mod.ts";
import type { PipelineContext } from "@core/dto/types.ts";

function makeCtx(content: string): PipelineContext {
  return {
    targetDir: "/tmp",
    files: [],
    dirs: [],
    getFileContent: async () => content,
    getImports: async () => [],
    lsp: null,
  };
}

const COORD = "src/orders/domain/coordinators/place/mod.ts";

Deno.test("flags an `as XxxDto` cast in a coordinator", async () => {
  const ctx = makeCtx(
    "const order = await orderData.load(input.id) as OrderDto;\n",
  );
  const result = await check(COORD, "ts", ctx);
  assertEquals(result !== null, true);
  assertEquals(
    result![0],
    'coordinator casts to "OrderDto" — validate the seam with assert(OrderDto, ...) instead of a blind cast',
  );
});

Deno.test("flags every cast, one violation per occurrence", async () => {
  const ctx = makeCtx(
    "const a = x as OrderDto;\nconst b = y as LineItemDto;\n",
  );
  const result = await check(COORD, "ts", ctx);
  assertEquals(result?.length, 2);
});

Deno.test("ignores files outside the coordinators layer", async () => {
  const ctx = makeCtx("const a = x as OrderDto;\n");
  const result = await check(
    "src/orders/domain/business/cart/mod.ts",
    "ts",
    ctx,
  );
  assertEquals(result, null);
});

Deno.test("ignores coordinator test files", async () => {
  const ctx = makeCtx("const a = x as OrderDto;\n");
  const result = await check(
    "src/orders/domain/coordinators/place/int.test.ts",
    "ts",
    ctx,
  );
  assertEquals(result, null);
});

Deno.test("ignores non-Dto casts and `undefined as never` placeholders", async () => {
  const ctx = makeCtx(
    "const a = x as string;\nconst b = y as OrderRecord;\n" +
      "await save(undefined as never);\n",
  );
  const result = await check(COORD, "ts", ctx);
  assertEquals(result, null);
});
