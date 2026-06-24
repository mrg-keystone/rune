---
name: "rune:spec"
description: >-
  Author and edit the `.rune` spec DSL — the shaping layer where you model a
  module's endpoints, services, DTOs, and validation, then drive it to a `rune
  check`-clean draft. Use whenever you touch/create a `.rune` file, "write a spec
  for X", "add an endpoint/feature/module", "wire two modules together", or decide
  modeling granularity (what becomes a `[REQ]`, when `[PLY]` vs a looped step,
  `[ENT]`/`[MOD]` scope); whenever you declare a shared service (`[SRV]` + `@docs`
  in `core.rune`) or a `[TYP]` validation modifier; whenever you run `rune
  check`/`rune fmt`; and whenever a spec "won't parse / won't lint" with a spec
  error — DTO-suffix, scope, indentation, line-length, untyped-field, ambiguous-
  endpoint complaints. The spec is the source of truth; this skill produces a
  `rune check`-clean `spec/<m>.in-prog.rune` and stops there. NOT generating the
  module, filling bodies, or the test fleet → use `rune:build`; NOT the runtime
  (`@Endpoint` semantics, `bootstrapServer`, auth, deploy) → use `rune:framework`;
  NOT the interactive cake / heal-rules schema → use `rune:cake`; NOT the Swagger
  doc surface (`@ApiProperty`, where `@docs`/`example=` show up) → use `rune:docs`.
user-invocable: true
argument-hint: "[what to spec / the feature or endpoint to add]"
---

# rune:spec

The **shaping layer** of rune: a tiny indentation-significant DSL for specifying a
module's requirements. You write a `.rune` spec and the toolchain generates a typed
backend from it. **The spec is the source of truth — you regenerate from it, you
don't hand-edit the generated structure.** This skill is everything about authoring
that spec and driving it to a clean state; it stops the moment the spec is good.

## This skill vs its siblings

- **`rune:spec` (here)** — author/edit the `.rune` DSL: tags, granularity, `[SRV]`,
  `[TYP]`, the rules that bite, `rune check`/`rune fmt`. **You end at a `rune
  check`-clean `spec/<m>.in-prog.rune`.**
- **`rune:build`** — owns everything from *finalize onward*: dropping the `.in-prog`
  infix, `rune sync` (codegen), filling bodies, the TDD test fleet, `rune lint`, the
  green run-all. Hand off the instant your spec checks clean.
- **`rune:framework`** — the runtime the generated code runs on: `@Endpoint`/
  `@EndpointController` *semantics*, `bootstrapServer`, auth (`@Public`/`@Roles`,
  401/403), `exerciseEndpoints`, deploy. (This skill only describes how the *spec*
  expresses order/deps/bind; the runtime behavior lives there.)
- **`rune:cake`** — the interactive cake at `/docs/<m>`, real-data e2e walks, and the
  heal-rules *schema* + panel. (This skill only notes that `rune sync` *scaffolds* a
  heal-rules file from your fault slugs.)
- **`rune:docs`** — the Swagger surface: `@ApiProperty`, where your `@docs <url>` and
  `[TYP:example=…]` show up in the generated OpenAPI doc.

## The loop you own

```text
write spec/<m>.in-prog.rune  ─▶  rune check  ─▶  (errors? iterate)  ─▶  clean
                                                                          │
                              finalize: drop .in-prog  ◀─────────────────┘
                                        │
                                        ▼
                                  hand to rune:build  (sync → fill → test → lint)
```

You stay in `spec/`, iterate `write → rune check → fix → re-check` until exit 0, then
finalize (rename `spec/<m>.in-prog.rune` → `spec/<m>.rune`) and hand the finalized
spec to the **`rune:build`** skill. You never run `rune sync` or fill code here — your
deliverable is a valid spec.

> In the repo without an installed `rune` binary, prefix any command with
> `deno run -A src/bootstrap/mod.ts` (e.g. `deno run -A src/bootstrap/mod.ts check
> spec/<m>.rune`). Elsewhere, just `rune check …`.

## Mental model (read this first)

- **One source of truth.** The spec is the contract. Generated DTOs, business/adapter
  impls, coordinators, entrypoint controllers, and tests are *create-once / dev-owned*
  — written once with stubs, then never overwritten. You regenerate the *contract*
  from the spec; you don't hand-edit generated structure to express intent. (How
  generation works is the **`rune:build`** skill's job; here you just trust that a
  clean spec produces a faithful scaffold.)
- **One language definition.** The tags, codegen templates, lint rules, and folder
  layout all derive from `lang/keywords.json` (edited via Rune Studio,
  `deno task studio` — it documents every construct live). Don't hardcode language
  behavior anywhere else.
- **Spec → concrete code.** A spec generates **plain concrete classes** for business
  features and data adapters (no `sig.ts` — only `[PLY]` variants get an abstract
  base), **class-validator / class-transformer DTOs** (fields typed from the
  `[TYP]`s), and coordinators split into an imperative shell + a pure `<verb>Core`.
- **Every seam is validated.** Generated DTOs carry class-validator constraints from
  your `[TYP:modifiers]`, and the generated coordinator `assert`s every seam. A failed
  contract throws `RuneAssertError`; the runtime maps it to HTTP 422. So *the spec's
  types are the runtime contract* — see **Validation** below.

## Writing a `.rune` — the shape

A spec is a flat, indentation-significant file. Tags are bracketed 3-letter codes. The
canonical reference is **`lang/docs/spec.md`**; the enforced rules are in
**`lang/docs/constraints.md`**; modeling patterns (echo-fields, teardown flows,
`$input` vs capture-bind, dependsOn-as-sequencing) are in **`lang/docs/cookbook.md`**.
The essentials:

```
[MOD] tasks                                  # names the module (optional; else filename)

[REQ] task.create(CreateTaskDto): TaskDto    # a feature: noun.verb(InputDto): OutputDto
    id::generate(): id                       # static step (::), no scope needed
    [NEW] task                               # construct + add `task` to scope
    task.fill(title): task                   # instance step (.), noun must be in scope
    db:task.save(TaskDto): void              # boundary: service:noun.verb (one colon)
      timeout                                # fault: indented 2 deeper, lowercase-hyphenated
    task.toDto(): TaskDto                     # LAST step must return the REQ output DTO

[TYP] id: string                              # a named primitive type
    a unique identifier                       # description required, indented 4
[DTO] CreateTaskDto: title                    # a data contract; name MUST end in Dto
    input to create a task
[DTO] TaskDto: id, title, done
    a persisted task
[NON] task                                    # declares a noun + prose
    a single todo item
```

`[RET]` (return a value created earlier in the flow) exists too — see
`lang/docs/spec.md`. `[PLY]`/`[CSE]` (polymorphism) is covered under **Granularity**.

## Services (boundary steps) — `[SRV]` + `@docs`

A boundary step `service:noun.verb(In): Out` (single colon) calls a declared
**service** — distinct from `Noun::verb()` (static, double colon) and `noun.verb()`
(in-module business step). Its params/returns must be DTOs or primitives. Services are
**SHARED**: declare each one **ONCE** in `src/core/core.rune` (module `core`), and
every other spec resolves its boundary services from there — no per-module `[SRV]`, no
import line, the engine just loads the project's core spec:

```
// src/core/core.rune
[MOD] core
[SRV] (TRANSPORT)<service>: <ENV_VAR, ENV_VAR2>   # transport: SDK/HTTP/WEBSOCKET/SIDECAR
    one-line prose description                      # indented 4
    @docs <url>                                     # REQUIRED, indented 4
```

So a `db:task.save(...)` boundary step in a module spec resolves against a
`[SRV] (SIDECAR)db: DB_URL` block in `core.rune`. The rules:

- `transport` is a **closed set** — `SDK` / `HTTP` / `WEBSOCKET` / `SIDECAR`.
- The OLD fixed kinds `db:`/`fs:`/`mq:`/`ex:`/`os:`/`lg:` are **gone as builtins** —
  `db:` is now just a service *named* `db` that needs a matching
  `[SRV] (SIDECAR)db: DB_URL` in `core.rune`.
- An **undeclared** service prefix is a spec error (`rune-service-presence`); a
  `[SRV]` declared anywhere other than `core.rune` is an error too
  (`rune-service-core-only`).
- The `@docs <url>` line is **required** on every `[SRV]` — one missing it is a hard
  parse error (`[SRV] <name> requires an @docs <url> line`, from `rune check`/`sync`,
  mirrored by the LSP).

`rune sync` generates a shared client per `[SRV]` (the data-adapter side is the
**`rune:build`** skill's concern), and the `@docs` url surfaces in the generated
Swagger — *where* it appears in the OpenAPI doc is the **`rune:docs`** skill's topic;
here, just know the line is mandatory.

## Granularity — decide this first

Syntax is the easy part. The modeling decision an LLM gets wrong *first and worst* is
**scale** — how much belongs in one `[REQ]`. There is no syntax error for getting it
wrong: a too-shallow spec and a too-deep one both check clean, so the model fills the
vacuum by guessing, inconsistently. Decide it deliberately.

**One `[REQ]` = one endpoint.** A `[REQ]` models an *externally-triggerable entry
point* — an HTTPS function, a scheduled/cron job, a queue or Firestore trigger, a
webhook. The system's **endpoint inventory is the source of truth** for how many REQs a
module has and what they're named (e.g. the functions wired in `index.ts` / the router
/ the trigger manifest). Domain and internal logic is expressed as **steps inside** a
REQ — never as its own REQ. **If it isn't independently callable from outside, it isn't
a REQ; it's a step.**

- *Too shallow (wrong):* a whole qualification engine collapsed into one
  `qualifier.runGates()` step — the endpoint is one call, but its real work (the gates)
  should be the visible steps.
- *Too deep (wrong):* every internal operation promoted to its own `[REQ]` — those
  aren't endpoints, they're steps of the endpoint that invokes them.

**Author from the wiring, not the prose.** Start from the endpoint/transport manifest
(the file that registers the functions), not architecture prose. Prose compresses many
endpoints into one sentence and hides the real count; the wiring file is the actual
contract for REQ count and names.

**`[MOD]` = one deployable surface / service area** — not one per concept or per doc
folder. Map one rune to a service the system ships, against its function surface (not
its documentation structure).

### `[PLY]` is runtime dispatch, NOT a catalog

`[PLY]`/`[CSE]` models **runtime polymorphic dispatch**: this *one* call is handled by
exactly one of N implementations (per-provider fetch, per-channel send, per-transport
encode). The natural-but-wrong reading is "I have N of something → N cases." Don't.
**The test: does exactly one arm execute per call (→ `[PLY]`), or do they all execute
and combine (→ a single step, looped in the body)?**

- ✓ `[PLY] channel.deliver(...)` with `[CSE] email` / `[CSE] push` — one channel is
  chosen per send. (Polymorphic *and* a small catalog, which is exactly why it's easy
  to overgeneralize from.)
- ✗ Eleven qualification predicates that **all** evaluate and combine by AND are **one
  step** (e.g. `gate.evaluate(CandidateDto): ResultDto`, predicates in the body),
  **not** eleven `[CSE]`s. "There are 11 things" ≠ "there are 11 branches."

## `[ENT]` — the outside edge

`[ENT] surface.action(InDto): OutDto` is the **inbound** edge — the HTTP route (or
CLI/queue handler) that reaches the `[REQ]` it dispatches to. `rune sync` generates an
entrypoint controller from it (a runtime controller with one `@Endpoint` per `[ENT]`,
each delegating to its coordinator). You own and tweak that controller afterward — but
the *spec* is where the edge is declared; don't hand-roll routing or parsing. The
runtime semantics of the generated `@Endpoint`/`@EndpointController` are the
**`rune:framework`** skill's domain.

rune picks each `[ENT]`'s coordinator by the `(input, output)` DTO pair. Two `[REQ]`s
sharing that signature are **ambiguous** (`rune check` errors) — name the target in the
`[ENT]` body to disambiguate:

```
[ENT] http.postRecording(GetRecordingDto): IdDto
    [REQ] recording.set(GetRecordingDto): IdDto    # dispatch to recording.set
```

An empty input (`[ENT] http.refresh({}): StatusDto`) generates a **no-argument**
handler — the `@Endpoint` omits `input` and the method takes no body.

## Declaring process order, dependencies, and binds

Endpoints in a module run as a *process*. You express the ordering **in the spec** with
three constructs; `rune sync` derives them into `@Endpoint` metadata, and the runtime
(see **`rune:framework`**) executes them:

- `order` — position in the sequence (ascending).
- `dependsOn` — endpoint id(s) that must run first.
- `bind` — `{ thisInputField: "otherEndpointId.outputField" }`: fill this request from
  an earlier response.

**You rarely write this by hand.** `rune sync` derives order/dependsOn/bind from the
**DTO field graph** — same-named output→input fields chain automatically — when it
generates the entrypoint. Your job in the spec is to *shape the DTOs so the right chain
falls out*. Three spec constructs cover the non-straight-chain cases (all derived into
`@Endpoint` metadata by sync):

- **Flows (XOR branches)** — `[ENT:card] http.payCard(PayDto): PaymentDto` puts the
  endpoint in the named flow; untagged endpoints belong to every flow. When endpoints
  in *different* flows produce the same field, the consumer is generated as the
  **OR-join** (`dependsOn` all of them, `bind` a list — first resolvable wins).
- **External inputs** — `[TYP:ext] memberId: string` marks a value minted **outside**
  the module. An unproduced input field of that type generates
  `bind: { memberId: "$memberId" }` — the value is supplied at run time (the cake lists
  it under **Module inputs**; how that surfaces is the **`rune:cake`** skill's topic).
- **Optional steps** — `[ENT:optional] http.survey(SurveyDto): ThanksDto` is attempted
  but not required: its failure doesn't stop the run-all (it lands in
  `report.optionalFailed`, not `report.failed`).

**The stub lifecycle (ghost stubs).** Until a `[TYP:ext]` input's real producer exists,
`rune sync` generates a `bootstrap/stubs.ts` — one trivial endpoint per unfulfilled
input that mints a placeholder, mounted at `/docs/stubs` and excluded when
`DENO_ENV=production`. It **evaporates** on the next sync once any module produces the
field. Never edit or reference it — it's generated-owned.

**The snap-together composition story.** Declare the value you need as `[TYP:ext]` and
develop against the ghost stub; later, sync the module that really produces the field
into the same project and it **auto-wires** — the shared field name *is* the contract,
no glue code, no config. (The composition runtime behavior is **`rune:framework`**; the
cake's view of it is **`rune:cake`**.)

**The plural convention (list→item).** Composition also matches collections: `$name`
resolves from an exact `name` output **or** the first element of a `name + "s"`
collection (`$tableName` ← `discover.tableNames[0]`). **Name collection fields
`<singular>(s)`** — an output called `tables` does *not* feed `$tableName`; `rune sync`
flags such near-misses in its `inputs:` diagnostics.

**Heal-rules (mention only).** When your boundary steps declare **fault slugs** (the
lowercase-hyphenated names indented under boundary steps), `rune sync` *also* scaffolds
a starter `fixtures/heal-rules.json`. Authoring the slugs is your job here; the rule
**schema** and the cake's heal panel belong to the **`rune:cake`** skill, and
**enriching** each scaffolded entry (the `todo: true` flag) is the **`rune:build`**
skill's job. Just write good fault slugs.

## Validation: constraints in the spec, asserts at every seam

Constraint modifiers ride in the `[TYP]` bracket slot — a comma-separated list,
composing freely with `ext`/`core` — and become class-validator decorators on every
generated DTO field of that type:

```
[TYP:uuid] id: string                  # @IsUUID()
[TYP:min=0,max=100] qty: number        # @Min(0) @Max(100)
[TYP:ext,uuid] memberId: string        # ext semantics + @IsUUID()
```

| Modifier    | Needs    | Decorator                                   |
| ----------- | -------- | ------------------------------------------- |
| `uuid`      | `string` | `@IsUUID()`                                 |
| `email`     | `string` | `@IsEmail()`                                |
| `url`       | `string` | `@IsUrl()`                                  |
| `nonempty`  | `string` | `@IsNotEmpty()`                             |
| `int`       | `number` | `@IsInt()` — **replaces** `@IsNumber()`     |
| `min=N`     | `number` | `@Min(N)`                                   |
| `max=N`     | `number` | `@Max(N)`                                   |
| `positive`  | `number` | `@IsPositive()`                             |
| `example=V` | any      | `@ApiProperty({ example: V })` — swagger    |

`example=<value>` is **not** a validator: it emits the swagger example the runtime's
runner and cake **fill required, unbound input fields from**. A required field with no
producer, no bind, and no example is a **guaranteed 422** in any headless walk —
`rune sync` warns about exactly those fields. The value runs to the next comma/`]` (no
commas inside) and is typed by the declared primitive (`[TYP:example=3,min=1] qty:
number` → `example: 3`). Composes with ext: `[TYP:ext,example=orders]`. (Where the
example shows up in the OpenAPI doc is the **`rune:docs`** skill's topic.)

`(s)` array properties get the `{ each: true }` decorator forms. Only `min`/`max` take
a value (`min=0`, numeric). String constraints need a `string` type, number constraints
a `number` type; `rune check` and the LSP reject anything else — and reject any
`[REQ:x]` (REQ takes no modifier).

**The `#assert` authoring view.** The generated coordinator validates every seam via
`import { assert } from "#assert"` — input, adapter reads/writes, result:

```ts
export async function create(input: CreateTaskDto): Promise<TaskDto> {
  const validInput = assert(CreateTaskDto, input, "task.create input");
  // reads — validated at the seam
  const taskLoad = assert(TaskDto, await taskData.load(validInput.id),
    "task.load");
  // core — pure business logic, no I/O
  const out = createCore(validInput, taskLoad);
  // writes — validated before they leave
  await taskData.save(assert(TaskDto, out.save, "task.save input"));
  return assert(TaskDto, out.result, "task.create output");
}
```

What this means *for the spec author*: the bodies anyone fills in are validated against
**your DTO contracts** at every seam — whatever an adapter or core returns must satisfy
the DTO before it crosses a seam, and fields the DTO class doesn't declare are stripped
(the class is the contract). Types that resolve to primitives are checked with
`assert.string` / `assert.number` / `assert.boolean` / `assert.uint8Array`. A failed
contract throws `RuneAssertError { target, context, failures }` with dotted failure
paths (`"lines.1.qty"`); **the runtime maps it to HTTP 422** — the mapping mechanics
(and `RUNE_ASSERT=off` trusted-prod mode) are the **`rune:framework`** skill's topic. So
model your DTOs tightly: every constraint you put in a `[TYP]` becomes a runtime gate.

## The rules that bite (from constraints.md)

These cause the "won't parse / won't lint (spec error)" surprises. When in doubt, read
**`lang/docs/constraints.md`** (the full table) — don't guess.

- **DTOs must end in `Dto`**; a `[REQ]`'s input and output must both be DTOs (or an
  inline `{}` input). Output is always a DTO.
- **Last step of a `[REQ]` must return that REQ's output DTO.**
- **Scope:** an instance call `noun.verb()` requires `noun` to be in scope — added by
  `[NEW] noun`, returned by an earlier step, or a property of the input DTO. Static
  calls `Noun::verb()` need no scope. **Scope resets at each `[REQ]`.**
- **Indentation is exact:** `[REQ]`=0, steps=4, faults=6; `[PLY]`=4, `[CSE]`=8, case
  steps=8, case faults=10; descriptions=4. Wrong indent = error.
- **Lines ≤ 80 chars.** Tags are exactly 3 letters in brackets.
- **Boundary step `service:noun.verb` (single colon)** calls a declared service; its
  params/returns must be DTOs or primitives (`string`/`number`/`boolean`/`void`/
  `Uint8Array`). The `service:` prefix MUST have a matching `[SRV]` block in
  `src/core/core.rune` (undeclared = error; `[SRV]` outside `core.rune` = error). There
  are **no builtin boundary kinds** — `db:`/`fs:`/`ex:`/… are just service names you
  declare (see **Services**).
- **`[TYP]` resolves to a primitive** (`string`/`number`/`boolean`/`void`/`Uint8Array`/
  `Class`/`Primitive` + generics), **never to a DTO**.
- **Every `[DTO]` field must resolve to a `[TYP]` or a nested `[DTO]`** (modifiers `?` /
  `(s)` allowed) — no untyped fields. `rune check`/`sync` rejects a field with no
  declaration (e.g. `[DTO] BookDto: id, borrowed` with no `[TYP] borrowed`).
- **Same `noun.verb` keeps one signature throughout**; no duplicate names.
- **No blind DTO casts in coordinators** (`no-dto-cast`, a *lint* error caught later by
  **`rune:build`**) — generated code already asserts its seams; don't reintroduce casts
  by hand (test files are exempt).
- **Don't name a verb after a JS/TS reserved word** (`delete`, `new`, `class`, `return`,
  `function`, `default`, …). Codegen emits `export async function <verb>(...)` **without
  sanitizing**, so `task.delete(...)` produces invalid TS that won't even parse. Use a
  synonym — `discard`, `remove`, `archive`. (This bites at `rune sync` in **`rune:build`**,
  but the fix is a spec decision: choose the verb name here.)

## Where specs live — author in `spec/`, label drafts `.in-prog`

Every rune you write goes in the project's `spec/` folder and **STAYS there** — that is
the authoring home; codegen goes to `src/<module>/`, the spec never moves out of
`spec/`. While a spec is a work in progress, name it **`spec/<module>.in-prog.rune`**.
The `.in-prog` infix marks it "not ready to wire in": auto-discovery (the `rune dev`
watch and the composed-app run-all) skips it, so a half-finished draft can't break the
running app. You still iterate freely — `rune check spec/<module>.in-prog.rune`
validates an in-prog file.

**Finalize by dropping the infix** (rename `spec/<module>.in-prog.rune` →
`spec/<module>.rune`); from then on auto-discovery picks it up. That rename **is the
seam** to the **`rune:build`** skill — build owns finalize, `rune sync`, and everything
downstream. So a new feature is born as `spec/<module>.in-prog.rune` and graduates to
`spec/<module>.rune`.

## The commands you own — `init`, `check`, `fmt`, `validate`

```sh
rune init  <project-name>                # scaffold a fresh project: deno.json, spec/core.rune,
                                         #   an empty src/, bootstrap/. Author specs in spec/.
rune check spec/<module>.in-prog.rune    # IS THIS RUNE GOOD? exit 0 = clean, 2 = errors
rune fmt   spec/<module>.in-prog.rune    # format the spec
rune validate <artifact.json>            # validate a keywords.json artifact (the language source)
rune lsp                                 # language server — the editor's squiggles mirror `rune check`
rune --help                              # the full command set (the rest live in `rune:build`/`rune:framework`)
```

(`rune sync`/`manifest`/`lint`/`dev` belong to the **`rune:build`** loop, not here — you
hand off before codegen. In the repo without an installed binary, prefix any command with
`deno run -A src/bootstrap/mod.ts`.)

**To check if a rune is good, run `rune check`.** It runs the exact same parser + rules
as `sync` and the editor LSP (every `[DTO]` field resolves to a `[TYP]` or `[DTO]`;
signatures; scope; indentation; structure) but **writes nothing** — no codegen. Exit 0
means the spec is valid and ready to finalize; exit 2 prints the errors with line
numbers. The editor's red squiggles (`rune lsp`) mirror `rune check` exactly, so a clean
editor means a clean `check`. Iterate `write → check → fix` until exit 0; then `rune
fmt` and finalize.

## Worked examples

`examples/todos/` has three real specs and their generated trees:

- `src/tasks/tasks.rune` — pure logic + a `db:` service boundary, two `[REQ]`s
- `src/lists/lists.rune` — same shape; shows a `(s)` array DTO field (`taskId(s)` →
  `taskIds: string[]`)
- `src/notify/notify.rune` — `[PLY]` polymorphism (`channel` → email/push) + an `ex:`
  service boundary

Copy one of these as a starting point — all three pass `rune check` clean (and
`rune sync`/`deno check`/`rune lint` once you hand them to **`rune:build`**).
`examples/todos/README.md` walks through the layout and the edit loop.
