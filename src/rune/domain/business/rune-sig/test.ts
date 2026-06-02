import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { parse } from "@rune/domain/business/rune-parse/mod.ts";
import { collectNounMethods, renderImpl, renderSig } from "./mod.ts";

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

Deno.test("renderSig emits abstract base + statics interface", () => {
  const sig = renderSig("id", [
    { verb: "create", params: ["providerName"], isStatic: true },
    { verb: "toDto", params: [], isStatic: false },
  ]);
  assertStringIncludes(sig, "export abstract class IdBase {");
  assertStringIncludes(sig, "abstract toDto(): unknown;");
  assertStringIncludes(sig, "export interface IdStatics {");
  assertStringIncludes(sig, "create(providerName: unknown): unknown;");
});

Deno.test("renderImpl extends base, marks override, satisfies statics", () => {
  const impl = renderImpl("id", [
    { verb: "create", params: ["providerName"], isStatic: true },
    { verb: "toDto", params: [], isStatic: false },
  ]);
  assertStringIncludes(impl, 'import { IdBase, type IdStatics } from "./sig.ts";');
  assertStringIncludes(impl, "export class Id extends IdBase {");
  assertStringIncludes(impl, "static create(providerName: unknown): unknown {");
  assertStringIncludes(impl, "override toDto(): unknown {");
  assertStringIncludes(impl, "Id satisfies IdStatics;");
});
