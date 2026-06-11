import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { parse } from "@rune/domain/business/rune-parse/mod.ts";
import { bindings } from "@rune/domain/business/rune-bindings/mod.ts";
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

Deno.test("collectNounMethods carries each step's declared output", () => {
  const methods = collectNounMethods(parse(SPEC));
  const id = methods.get("id");
  assert(id);
  assertEquals(id.find((m) => m.verb === "create")?.output, "id");
  assertEquals(id.find((m) => m.verb === "toDto")?.output, "OutDto");
});

Deno.test("renderImpl emits a plain concrete class (no base, no override)", () => {
  const impl = renderImpl("id", [
    { verb: "create", params: ["providerName"], output: "", isStatic: true },
    { verb: "toDto", params: [], output: "", isStatic: false },
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

// ---- typed stubs: params/returns resolve through the spec's [DTO]/[TYP] ----

const TYPED_SPEC = `[MOD] tasks
[REQ] task.create(CreateTaskDto): TaskDto
    db:task.load(id): TaskDto
    db:task.save(TaskDto): void
    db:task.count(): total
    task.normalize(): task
    task.mystery(ghost): spirit

[DTO] CreateTaskDto: title
    input
[DTO] TaskDto: id, title
    the task
[DTO:core] AuditDto: id
    shared audit record

[TYP] id: string
    an id
[TYP] title: string
    a title
[TYP] total: number
    how many
`;

function typedOpts(spec: string) {
  const ast = parse(spec);
  return {
    typMap: new Map(ast.typs.map((t) => [t.name, t])),
    dtoByName: new Map(ast.dtos.map((d) => [d.name, d])),
    module: "tasks",
    nameBinding: bindings["<name>"],
  };
}

Deno.test("renderImpl — adapter signatures: typed params, Promise returns", () => {
  const ast = parse(TYPED_SPEC);
  const methods = collectNounMethods(ast).get("task")!;
  const impl = renderImpl("task", methods, { async: true, ...typedOpts(TYPED_SPEC) });
  // db:task.save(TaskDto): void → save(taskDto: TaskDto): Promise<void>
  assertStringIncludes(impl, "save(taskDto: TaskDto): Promise<void> {");
  // db:task.load(id): TaskDto → load(id: string): Promise<TaskDto>
  assertStringIncludes(impl, "load(id: string): Promise<TaskDto> {");
  // [TYP] total: number → Promise<number>
  assertStringIncludes(impl, "count(): Promise<number> {");
  // output equals the noun → the class's own name
  assertStringIncludes(impl, "normalize(): Promise<Task> {");
  // unresolvable param/output stay unknown
  assertStringIncludes(impl, "mystery(ghost: unknown): Promise<unknown> {");
  // the referenced DTO class is imported (module path — not :core)
  assertStringIncludes(impl, 'import { TaskDto } from "@/src/tasks/dto/task.ts";');
  // bodies still throw
  assertStringIncludes(impl, 'throw new Error("not implemented");');
});

Deno.test("renderImpl — business classes stay sync (no Promise)", () => {
  const impl = renderImpl("task", [
    { verb: "load", params: ["id"], output: "TaskDto", isStatic: false },
  ], typedOpts(TYPED_SPEC));
  assertStringIncludes(impl, "load(id: string): TaskDto {");
  assert(!impl.includes("Promise<"));
});

Deno.test("renderImpl — :core DTO imports from src/core/dto", () => {
  const impl = renderImpl("audit", [
    { verb: "record", params: ["AuditDto"], output: "void", isStatic: false },
  ], { async: true, ...typedOpts(TYPED_SPEC) });
  assertStringIncludes(impl, "record(auditDto: AuditDto): Promise<void> {");
  assertStringIncludes(impl, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
});

Deno.test("renderImpl — empty output stays unknown; no opts stays legacy", () => {
  const typed = renderImpl("id", [
    { verb: "mint", params: [], output: "", isStatic: true },
  ], typedOpts(TYPED_SPEC));
  assertStringIncludes(typed, "static mint(): unknown {");
  // Without options nothing resolves and no import is emitted.
  const legacy = renderImpl("task", [
    { verb: "load", params: ["id"], output: "TaskDto", isStatic: false },
  ]);
  assertStringIncludes(legacy, "load(id: unknown): unknown {");
  assert(!legacy.includes("import"));
});
