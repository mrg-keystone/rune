import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { parse } from "@rune/domain/business/rune-parse/mod.ts";
import { collectNounMethods, renderImpl } from "./mod.ts";

const SPEC = `[MOD] m
[REQ] m.run(InDto): OutDto
    id::create(providerName): id
    id.toDto(): OutDto
    [RET] OutDto
`;

Deno.test("collectNounMethods groups static + instance per noun", () => {
  const methods = collectNounMethods(parse(SPEC));
  const id = methods.get("id");
  assert(id);
  assertEquals(id.length, 2);
  assert(id.some((m) => m.verb === "create" && m.isStatic));
  assert(id.some((m) => m.verb === "toDto" && !m.isStatic));
});

Deno.test("renderImpl emits a plain concrete class (no base, no override)", () => {
  const impl = renderImpl("id", [
    { verb: "create", params: ["providerName"], isStatic: true },
    { verb: "toDto", params: [], isStatic: false },
  ]);
  assertStringIncludes(impl, "export class Id {");
  assertStringIncludes(impl, "static create(providerName: unknown): unknown {");
  assertStringIncludes(impl, "  toDto(): unknown {");
  // No abstract base, no override modifier, no sig import, no satisfies.
  assert(!impl.includes("extends"));
  assert(!impl.includes("override"));
  assert(!impl.includes("./sig.ts"));
  assert(!impl.includes("satisfies"));
});
