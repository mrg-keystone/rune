## Pipeline

### 1. Parse

`rune-parse/mod.ts` (`parse()`): a line-based, indentation-sensitive parser —
the **parser of record** (ADR 0003; the Rust LSP mirrors it, tree-sitter is
editor-only). Text → `RuneAst` covering every tag (`[MOD] [REQ] [ENT] [DTO]
[TYP] [NON] [PLY] [CSE] [NEW]/[CTR] [RET] [SRV]`), boundary steps
(`service:noun.verb`), faults, `[ENT]` route clauses and `[ENT:ws]` sockets,
`[TYP]` bracket modifiers, and `[SRV]` blocks with their required `@docs`
lines. Tag literals are artifact-overridable (`parse(text, {tags})`) so a
Studio edit to `keywords.json` can drive recognition without an engine change.

### 2. Validate

Parse-time errors: malformed signatures, unknown modifiers, `[PLY]` with no
`[CSE]`. A DTO property with no `[TYP]`/`[DTO]` is **not** a parse error — it
reaches generation and is typed `unknown` under `@Allow()` with a `// TODO:
tighten` marker (see the "Validation & Swagger details worth knowing" section).
Planner-time errors: undeclared boundary services, `[SRV]` outside
`core.rune`, ambiguous `[ENT]`→`[REQ]` matches, a surface declared both HTTP
and WS. Undeclared-boundary-service checking runs under `strictServices`,
strict wherever a user meets it and off only for raw codegen callers:

| Caller | `strictServices` |
| --- | --- |
| `rune check` | strict |
| `rune sync` | strict |
| `rune manifest` | strict |
| `rune dev`'s pre-sync check | strict |
| Rust LSP (resolves shared `[SRV]`s from the project's `core.rune`) | strict |
| Studio preview | off |
| Golden capture | off |

For this check, `rune check`, `rune sync`, `rune dev`, and the LSP all
surface the same diagnostic — one source of truth for
undeclared-boundary-service errors specifically, not a general claim that the
LSP and the TS engine agree on everything (they don't — see
[02-language.md § Validation summary](../02-language/06-validation-summary.md)).

### 3. Generate

Per-element emission into `<root>/src/<module>/` (canonical composed layout:
`<git-root>/server/src/<module>/`):

| Spec element | Emitted files |
| --- | --- |
| `[REQ] noun.verb` | `domain/coordinators/<noun>-<verb>/mod.ts` + `int.test.ts` |
| untagged step noun | `domain/business/<noun>/mod.ts` + `test.ts` — a plain concrete class with stubbed bodies (no abstract base, no separate signature file) |
| boundary `service:noun.verb` | `domain/data/<noun>/mod.ts` + `smk.test.ts` |
| `[PLY]` / `[CSE]` | under `domain/business/<noun>/`: `base/{mod,test}.ts`, `implementations/<case>/{mod,test}.ts`, `poly-mod.ts` barrel |
| `[DTO]` | `dto/<name>.ts` — class-validator class (`@ApiProperty`, `@ValidateNested`/`@Type` for nesting, `__keepOpen` for `[DTO:open]`) |
| `[TYP]` (non-`Class`) | `dto/<name>.ts` — type alias; when the `[TYP]`'s kebab-cased name collides with a same-dir `[DTO]`'s `Dto`-suffix-stripped, kebab-cased name, the `[DTO]` keeps `<name>.ts` and the `[TYP]` takes `dto/<name>-type.ts` instead, so neither clobbers the other ([05-linter.md § Rule families](../05-linter/01-rule-families.md) `rune-typ-shape`) |
| `[TYP] name: Class` | no file of its own — the same "no file of its own" treatment `[NON]` gets, since the domain class already generates from the matching noun's untagged steps at `domain/business/<noun>/mod.ts` and a `dto/<name>.ts` alias would be redundant ([02-language.md § Types, DTOs, and constraint modifiers](../02-language/04-types-dtos-and-constraint-modifiers.md)) |
| `[ENT]` (HTTP surface) | `entrypoints/<surface>/mod.ts` — `@EndpointController` with one `@Endpoint` per action, computed `order`/`dependsOn`/`bind`/`flows` — + `e2e.test.ts` |
| `[ENT:ws]` | `entrypoints/<surface>/mod.ts` — `@WsEndpointController` with one `@WsEndpoint` per topic — + `e2e.test.ts` (required for presence parity with every entrypoint surface — [05-linter.md § Rule families](../05-linter/01-rule-families.md) `rune-entrypoint-presence`); scaffolded as a create-once stub, since WS topics never enter the `exerciseEndpoints` walk an HTTP `[ENT]` surface's `e2e.test.ts` drives |
| `[SRV]` (core.rune only) | `src/core/data/<service>/mod.ts` shared client + `smk.test.ts` |
| `[NON]` | no file of its own — its prose flows into generated docs: the noun's business/adapter class JSDoc, the poly base's doc comment, the business `test.ts` header, and `mod-root.ts`'s "Domain nouns" glossary |
| `[NEW]`/`[CTR]`, `[RET]` | no file — recipe-only: each renders as a numbered line (`[NEW] <Class>`, `[RET] <value>`) in the core's recipe comment and the `int.test.ts` copy of it |
| module | `src/<module>/mod-root.ts` (regenerated barrel) |

**A `[TYP]` bare-word union body is a string-literal enum.** `[TYP] verb: GET
| POST | DELETE` — two-plus `|`-separated members, each a plain identifier
that is neither a TS primitive/keyword nor a `*Dto` name — emits the alias
with the members quoted, and DTO fields of the type validate with `@IsIn`;
any other union passes through verbatim (typed, kept past assert's whitelist
with `@Allow()`, no validator). The union body is a lenient parse — `[TYP]`
bodies are free text — documented as the bare-word union form in
[02-language.md](../02-language/00-overview.md).

**Fault-implied tests**: every declared fault scaffolds a named
`Deno.test("<fault>", …)` TODO stub in fixed test files — a fault
double-routes to two files, never just one: first to its own step's test
file (an untagged step's fault → the noun's business `test.ts`; a boundary
step's fault → the noun's `smk.test.ts`; a fault on a `[PLY]` noun's base
step → `base/test.ts`; a fault inside a `[CSE]` → that case's
`implementations/<case>/test.ts`), and second — because it is also a fault of
the `[REQ]` that step belongs to (poly cases included) — to that `[REQ]`'s
`int.test.ts`; no other emitted test carries fault stubs. The stub body is
`throw new Error("not implemented")` — **red by design**, the same as the
core — never `ignore`d and never an empty pass; it fails until the dev
implements it, so a bare `deno test` is red for every unimplemented fault.
The `rune-fault-coverage` lint rule doesn't check pass/fail — it fails a
declared fault whose file lacks an exactly-named test at all; the stub's
presence is what satisfies it, and the stub's red body is what carries the
"generation never pretends the app works" guarantee for faults specifically
([05-linter.md](../05-linter/00-overview.md)).

**The generated `e2e.test.ts` is env-gated.** Each `[ENT]` surface's
`e2e.test.ts` is emitted with `ignore: !Deno.env.get("RUNE_E2E")`, so a bare
`deno test` **silently skips it** — it boots the surface and drives every
endpoint through `exerciseEndpoints` only when `RUNE_E2E` is set in the
environment (`RUNE_E2E=1`). It is the only env-gated generated test:
`int.test.ts` and `smk.test.ts` run ungated. A legend comment above the
exercise call says as much ("run with `RUNE_E2E=1` to drive every endpoint to
green"). An `[ENT:ws]` surface's `e2e.test.ts` is scaffolded the same
env-gated way but carries no `exerciseEndpoints` call to gate — WS topics
never enter that walk (see the `[ENT:ws]` emission row above) — so its stub
is dev-authored from the start.

**The coordinator is the hexagonal imperative shell.** Generated shape: assert
the input DTO at the seam → run read-boundaries pre-core → call a pure
`<verb>Core()` (where all business logic lives — generated as
`throw new Error("not implemented")`, **red by design**) → run mutation/write
boundaries post-core in spec order, each call site bound from one shared
name-resolution table → assert the output DTO.

Which side of the core a boundary step runs on, and how its params are
resolved, is decided by verb + dataflow, not by return type alone:

| Step form | Detection rule | Placement | Primary-param source | Other-param source |
| --- | --- | --- | --- | --- |
| Pre-core read | Verb prefix-matches the read-verb whitelist (`get list load read fetch find lookup query search download count peek check exists`, plus `is`/`has`/`can`/`assert` predicates — matched on the camelCase word boundary, so `getRecording` reads but `getaway` doesn't) **and** every DTO param it takes is the request input itself | Before `<verb>Core()`, in spec order | — (no primary/other split) | The request-input DTO's own field(s), accessed directly (`dto.<field>`) — a plain (non-`Dto`) argument names an input field, never the whole DTO object |
| Post-core `: void` write | Return clause is `: void` | After `<verb>Core()`, in spec order — awaited call, errors propagate | Core-built by default (added to the core's return contract as `out.<field>`, seam-asserted at the call site) **unless** an earlier post-core result already produced it — those are the primary param's only two sources; the table is never consulted for it (so a write whose primary param names the REQ's own input DTO still consumes a core-minted value, never the validated input). The primary param is the first DTO param, else the first param. | Resolves through the table (precedence below) |
| Post-core send | No return clause at all (a form the parser of record accepts leniently — documented with the step grammar in [02-language.md](../02-language/00-overview.md)) | After `<verb>Core()`, in spec order — awaited call, errors propagate, nothing runs detached, no value bound | — (no primary param) | Every param resolves through the table |
| Post-core value-returning mutation / read | Has a non-`void` return clause (e.g. `db:task.create(TaskDto): TaskDto`), or a read whose param is a core-built DTO rather than the request input | After `<verb>Core()`, in spec order — awaited call, binds a seam-asserted local | — (no primary/other split) | Every param resolves through the table |

So the core's guards throw before any write lands. The table resolves every
post-core param but a write's primary in this fixed precedence:

1. The request-input value.
2. A hoisted pure-producer local.
3. An earlier post-core result.
4. A pre-core read's output.

An unbindable param is never a planner error (scope rules are documented but
deliberately unenforced — see [02-language.md](../02-language/00-overview.md)):
post-core it is added to the core's return contract (`out.<field>` — the
red-by-design core must mint it); pre-core it falls back to an input-field
access, leaving the spec error visible as a type error at `deno check`.

Hoisting is the only way an untagged step appears in the coordinator: a pure
step whose scalar output any table-resolved post-core param consumes — a
write's non-primary param, a send's param, a value-returning mutation's
param, or a read's param — (transitively, through producers' own params) is
emitted as a local between the adapter constructions and the pre-core reads —
in spec order, first producer of a value wins; every other untagged step
exists only in the core's recipe. Context labels (`"task.create input"`,
`"task.load"`) flow into `RuneAssertError` so a 422 says where the check ran
(see [06-runtime.md](../06-runtime/00-overview.md)).

**Core input and the `[REQ]`'s return value resolve the same general way.**
The core's input object carries one field per value available before the core
runs — the request-input DTO itself, every pre-core read's asserted output,
and every hoisted producer local — each keyed by its own binding name (`dto`,
`task`, `slug` in the worked example below), regardless of whether that same
value is *also* consumed directly by a post-core step outside the core (as
`slug` is: both an `UpdateCoreInput` field and `task.save`'s direct
non-primary argument). A hoisted local that no table-resolved post-core param
consumes is never hoisted at all — per the hoisting rule above — so it never
reaches core input either.

The core's return contract grows one `out.<field>` at a time, one per
post-core write whose primary param resolves to "core-built" (the
write-primary rule above), keyed by that same binding name. The `[REQ]`'s own
declared output type resolves the same way a post-core param would: if it
matches a write's core-built primary, the final `return` asserts and returns
that `out.<field>` (as `task.update` does above, since its output type
`TaskDto` is also `task.save`'s primary). If no write shares the output
type — a pure-read `[REQ]` such as `task.get(IdDto): TaskDto` whose output is
a pre-core `db:task.load`, or a multi-write `[REQ]` whose output type none of
its writes produce — the return value resolves through the same precedence
used for a post-core param (request-input value, hoisted local, earlier
post-core result, pre-core read's output), asserted and returned directly,
bypassing the core for that value entirely. If nothing produces the output
type at all, it falls back like any other unbindable value: minted into the
core's return contract as `out.<field>` for hand-fill.

Process metadata for `[ENT]` chains is computed here from the DTO field graph
(mint-not-echo, earliest-producer-wins, declaration order — the rules in
[02-language.md](../02-language/00-overview.md)) and written as `@Endpoint` decorator
arguments; keep surfaces them as the `x-keep-process` OpenAPI extension.

The template engine is a tiny `{{#each}}`/`{{var}}` substituter; substitutable
bodies (`DEFAULT_TEMPLATES`) are mirrored byte-identically into
`keywords.json → codegen.templates` by `scripts/gen-codegen-templates.ts`, so
the artifact can drive generation (`--artifact`) without drift.

**Worked example.** A minimal `[REQ]` exercising a pre-core read, a post-core
`: void` write, a post-core send, and one untagged (hoisted) producer, in
module `tasks`:

```rune
[REQ] task.update(UpdateTaskDto): TaskDto
    task.slugify(title): slug
    db:task.load(id): TaskDto
      not-found
    db:task.save(TaskDto, slug): void
      timeout
    mail:task.notify(TaskDto)

[TYP] id: string
[TYP] title: string
[TYP] slug: string
[TYP] done: boolean

[DTO] UpdateTaskDto: id, title
[DTO] TaskDto: id, title, done
```

Per the emission table above, this generates:

```
src/tasks/
  mod-root.ts
  domain/
    coordinators/
      task-update/
        mod.ts            # the coordinator below
        int.test.ts
    business/
      task/
        mod.ts             # TaskBusiness — slugify() stub
        test.ts
    data/
      task/
        mod.ts             # TaskData — load()/save()/notify() stubs
        smk.test.ts
  dto/
    update-task.ts          # [DTO] UpdateTaskDto
    task.ts                 # [DTO] TaskDto
    id.ts                   # [TYP] id
    title.ts                # [TYP] title
    slug.ts                 # [TYP] slug
    done.ts                 # [TYP] done
```

`domain/coordinators/task-update/mod.ts` (create-once — "Edit the body" —
illustrative naming; only the shape below is normative):

```ts
import { assert } from "#assert";
import { TaskBusiness } from "@/src/tasks/domain/business/task/mod.ts";
import { TaskData } from "@/src/tasks/domain/data/task/mod.ts";
import { UpdateTaskDto } from "@/src/tasks/dto/update-task.ts";
import { TaskDto } from "@/src/tasks/dto/task.ts";

interface UpdateCoreInput {
  dto: UpdateTaskDto;
  task: TaskDto;
  slug: string;
}
interface UpdateCoreOutput {
  task: TaskDto;
}

async function updateCore(input: UpdateCoreInput): Promise<UpdateCoreOutput> {
  throw new Error("not implemented"); // red by design
}

export async function update(input: UpdateTaskDto): Promise<TaskDto> {
  const dto = assert(UpdateTaskDto, input, "task.update input");

  // adapter constructions
  const taskBusiness = new TaskBusiness();
  const taskData = new TaskData();

  // hoisted producer local: task.slugify(title) is untagged, and its output
  // (slug) feeds db:task.save's non-primary param — hoisted between the
  // adapter constructions and the pre-core reads
  const slug = taskBusiness.slugify(dto.title);

  // pre-core read: "load" matches the read-verb whitelist and its only param
  // (id) is a request-input field
  const task = assert(TaskDto, await taskData.load(dto.id), "task.load");

  // the core: all business logic lives here — throws until hand-filled
  const out = await updateCore({ dto, task, slug });

  // post-core `: void` write — primary param (TaskDto, first DTO param) is
  // core-built and seam-asserted at the call site; the non-primary param
  // (slug) resolves through the table to the hoisted local
  await taskData.save(assert(TaskDto, out.task, "task.save"), slug);

  // post-core send — no value to bind; its param resolves through the table
  // to the pre-core read's output (no request-input field, hoisted local, or
  // earlier post-core result is typed TaskDto)
  await taskData.notify(task);

  // output DTO assert
  return assert(TaskDto, out.task, "task.update output");
}
```

### 4. Reconcile and emit (`rune sync`)

The lifecycle policy (`DEFAULT_POLICIES`) is the load-bearing invariant, keyed
per file/slot:

| File or slot | Owner | Regenerate vs create-once | Grows on spec-add? | Prune granularity + gating |
| --- | --- | --- | --- | --- |
| `mod-root.ts` | spec | Regenerate — DO-NOT-EDIT banner, rewritten in full every sync | N/A — always rewritten to match the spec | N/A — not orphan-pruned, always rewritten |
| `bootstrap/modules.ts` (module registry) | spec | Regenerate — DO-NOT-EDIT banner, rewritten in full every sync, after the create/regenerate/prune writes land, so every surface it names exists on disk by the time it is written | N/A — one import per `src/<module>/mod-root.ts` barrel (`module-isolation`: bootstrap reaches modules only via `mod-root.ts` — [05-linter.md § Rule families](../05-linter/01-rule-families.md)), each barrel re-exporting every `[ENT]`/`[ENT:ws]` surface controller the spec **implies** (the post-sync, spec-projected surface set, including any `[ENT]` surface this same sync's `toCreate` is about to write, not just ones already on disk before the sync ran); the registry composes those re-exports into the `modules` array, plus the production-gated ghost-stub entry while a generated `bootstrap/stubs.ts` is live | N/A — always rewritten to match the spec |
| Coordinator `mod.ts` (`domain/coordinators/<noun>-<verb>/`) | dev | Create-once — "Edit the body" banner, written only if absent | No — preserved verbatim, outside the growth target set | Whole dir — see "dir orphan" below |
| Business/adapter `mod.ts` (`domain/business/<noun>/`, `domain/data/<noun>/`) | dev | Create-once — "Edit the body" banner, written only if absent | Yes — a missing member is **appended** exactly as the generator would emit it (a throwing stub method); append-only, a changed or removed member never propagates (`--regen <path>` writes a `.new` sibling for the non-destructive pull); a class too drifted to locate is reported as owed hand-work | Whole dir — see "dir orphan" below |
| Entrypoint body (`entrypoints/<surface>/mod.ts`) | dev | Create-once — "Edit the body" banner, written only if absent | Yes — an `@Endpoint` delegator is appended (same append-only rule as business/adapter) | Whole dir — see "dir orphan" below |
| `[DTO]` class (`dto/<name>.ts`) | dev | Create-once — "Edit the body" banner, written only if absent; hand enrichments survive re-syncs | Yes — a spec-exact DTO field (decorators included) is appended (same append-only rule) | Single file — see "dto orphan" below |
| `[TYP]` alias (`dto/<name>.ts`) — non-`Class`-typed only; a `Class`-typed `[TYP]` generates no file at all, the same "no file of its own" treatment `[NON]` gets (see the `[TYP]` emission row in [§3 Generate](#3-generate) and [02-language.md § Types, DTOs, and constraint modifiers](../02-language/04-types-dtos-and-constraint-modifiers.md)) — so it has no lifecycle slot to reconcile | dev | Create-once — "Edit the body" banner, written only if absent; hand enrichments survive re-syncs | No — preserved verbatim, outside the growth target set | Single file — see "dto orphan" below |
| `[SRV]` client (`src/core/data/<service>/mod.ts`) | dev | Create-once — "Edit the body" banner, written only if absent | No — preserved verbatim, outside the growth target set | `prunable: false` — never auto-deleted; an orphaned client is removed by hand |
| Tests (`test.ts`, `int.test.ts`, `smk.test.ts`, `e2e.test.ts`) | dev | Create-once — "Edit the body" banner, written only if absent | No — preserved verbatim, outside the growth target set | Not pruned standalone — prunes with its code folder's dir, see "dir orphan" below |
| Poly base / variant (`base/{mod,test}.ts`, `implementations/<case>/{mod,test}.ts`) | dev | Create-once — written only if absent | No — sits deeper than the growable `<noun>/mod.ts` path and falls outside the growth target set; a member the poly subtree gains is never appended to (nor reported as owed hand-work on) an existing base or variant file — it reaches the tree only when a new `[CSE]` scaffolds its own `implementations/<case>/` | Whole dir — see "dir orphan" below |
| `poly-mod.ts` barrel | dev | Create-once — scaffolded pointing at the first declared variant, thereafter the dev's dispatch choice; a new `[CSE]` scaffolds its `implementations/<case>/` but never edits the barrel | No — never grows (it holds no class) | Never deleted by sync — a stale reference (a variant no `[CSE]` declares, or whose folder is gone, e.g. a `--force` prune removed the arm) gets a warning telling the dev to repoint the barrel by hand; a hand-rewritten barrel (runtime switch, multiple re-exports) is skipped rather than falsely warned about |
| `bootstrap/mod.ts` | dev | Create-once — "Edit the body" banner, written only if absent | No — fixed shape: exports both `Backend` — the composition wrapper `serve.ts` calls (`appName`/`modules` inlined, wired to keep's `Backend(appName, module, options?)` primitive — [06-runtime.md § Composition & serving](../06-runtime/06-composition-serving.md)) — and `api = await bootstrapServer(<app-name>, modules, { port: config.port })` (app name derived from the project dir), the `{ listen, stop, backend, handler, docs }` result the run-all gate ([§ The run-all gate](06-the-run-all-gate.md)) and any in-process backend client import directly; plus an `import.meta.main` listen block | N/A — not orphan-prunable, a fixed bootstrap file |
| `bootstrap/config.ts` | dev | Create-once — "Edit the body" banner, written only if absent | No — fixed shape: centralized env reads (`config.port` from `PORT`, default `3000`) | N/A — not orphan-prunable, a fixed bootstrap file |
| **dto orphan** — any `dto/` file ([DTO] or [TYP]) no longer implied by the spec | spec | — (prune-only classification) | — | Single file — counts spec-owned for prune, deleted on every sync |
| **dir orphan** — any dir under `domain/{business,data,coordinators}/` or `entrypoints/` no longer implied by the spec | dev | — (prune-only classification) | — | Whole dir — counts dev-owned (hand-written bodies, the dir prunes as a unit), reported every sync, deleted only under `--force` |

**Byte-identical writes are skipped** — no mtime change, no FS event — so
`rune dev`'s watcher can't loop on sync's own output.

Sync also maintains the project `deno.json` import map — `REQUIRED_IMPORTS`
plus the `experimentalDecorators` + `emitDecoratorMetadata` compiler options —
and regenerates the bootstrap registry. The exact pin enumeration (versions,
which aliases are pinned vs left floating) is load-bearing for the
single-copy invariant, owned by
[03-cli.md § `rune sync` semantics, step 4](../03-cli/02-rune-sync-semantics-that-matter.md)
and [01-architecture.md § The canonical generated-project shape](../01-architecture/05-the-canonical-generated-project-shape.md),
not restated here. The finalized spec is **not** relocated into `src/<module>/`: it
stays durable in `spec/runes/<m>.rune` — the canonical home
([02-language.md](../02-language/00-overview.md)) — and codegen READS it there, generating
into `<root>/src/<module>/` ([§3 Generate](#3-generate), above). Full step order in [03-cli.md](../03-cli/00-overview.md).

