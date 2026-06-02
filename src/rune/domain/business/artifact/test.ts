import { assert, assertEquals } from "#std/assert";
import { validateArtifact } from "./validate.ts";
import type { Artifact } from "./schema.ts";

const base = (): Artifact => ({
  name: "Test",
  schemaVersion: "1.0.0",
  tags: [
    { id: "dto", tag: "[DTO]", label: "DTO", indent: 0, follows: "dtodef" },
    { id: "ply", tag: "[PLY]", label: "Poly", indent: 4, follows: "poly" },
    { id: "cse", tag: "[CSE]", label: "Case", indent: 8, follows: "case" },
  ],
  modifiers: [{ id: "core", token: ":core", appliesTo: ["dto"] }],
  boundaries: { prefixes: ["db:"] },
  builtins: ["string"],
  tokens: {},
  lint: [
    { id: "r1", type: "name-suffix", target: "spec", severity: "error", enabled: true, params: { tag: "dto" }, message: "x" },
  ],
});

Deno.test("accepts a structurally + semantically valid artifact", () => {
  const r = validateArtifact(base());
  assert(r.ok, r.errors.map((e) => e.message).join("; "));
});

Deno.test("rejects a duplicate tag id", () => {
  const a = base();
  a.tags.push({ id: "dto", tag: "[DTX]", label: "Dup", indent: 0, follows: "dtodef" });
  const r = validateArtifact(a);
  assert(!r.ok);
  assert(r.errors.some((e) => e.message.includes("duplicate tag id")));
});

Deno.test("rejects an unknown modifier target", () => {
  const a = base();
  a.modifiers![0].appliesTo = ["ghost"];
  const r = validateArtifact(a);
  assert(!r.ok);
  assert(r.errors.some((e) => e.message.includes("applies to unknown tag id")));
});

Deno.test("rejects contradictory indent (case not deeper than poly)", () => {
  const a = base();
  a.tags[2].indent = 2;
  const r = validateArtifact(a);
  assert(!r.ok);
  assert(r.errors.some((e) => e.message.includes("contradictory indent")));
});

Deno.test("rejects a bad schemaVersion structurally", () => {
  // deno-lint-ignore no-explicit-any
  const a = { ...base(), schemaVersion: "v1" } as any;
  const r = validateArtifact(a);
  assert(!r.ok);
  assertEquals(r.errors.some((e) => e.path.includes("schemaVersion")), true);
});

Deno.test("flags a profile gap (inconsistent var keys)", () => {
  const a = base();
  a.profiles = [
    { id: "deno", vars: { runtime: "deno", ext: "ts" } },
    { id: "node", vars: { runtime: "node" } },
  ];
  const r = validateArtifact(a);
  assert(!r.ok);
  assert(r.errors.some((e) => e.message.includes("gap")));
});
