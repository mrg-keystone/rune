# The `.rune` Spec Language

> Part of the [project spec series](README.md). Sources of truth: `lang/docs/spec.md`
> (syntax), `lang/docs/constraints.md` (enforced rules), `lang/keywords.json` (the
> machine-readable language artifact — see [08-language-tooling.md](08-language-tooling.md)).

A `.rune` file is a small, indentation-significant spec describing **one backend
module**: its externally triggered features, the steps they take, the seams they
cross, the data contracts they exchange, and the ways each step can fail. The
engine (`rune sync`) generates a typed, validated TypeScript tree from it —
the spec is the source of truth; generated structure is never hand-edited.

The founding idea (from `lang/README.md`): *"Constrain what LLMs build. Get
exactly what you need."* Faults imply test cases; DTOs imply validation; steps
imply the file layout. An LLM (or a human) implements exactly what the spec
declares — no more, no less.

## A complete example

`examples/todos/spec/runes/tasks.rune` — the canonical starter:

```rune
[MOD] tasks

[REQ] task.create(CreateTaskDto): TaskDto
    id::generate(): id
    [NEW] task
    task.fill(title): task
    db:task.save(TaskDto): void
      timeout
    task.toDto(): TaskDto

[REQ] task.complete(TaskRefDto): TaskDto
    db:task.load(id): TaskDto
      not-found
    task.markDone(): task
    db:task.save(TaskDto): void
      timeout
    task.toDto(): TaskDto

[TYP] id: string
    a unique task identifier
[TYP] title: string
    the human-readable task title
[TYP] done: boolean
    whether the task has been completed

[DTO] CreateTaskDto: title
    input to create a new task
[DTO] TaskRefDto: id
    a reference to an existing task
[DTO] TaskDto: id, title, done
    a persisted task record

[NON] task
    a single todo item
```

## Tags

Every keyword tag in the fixed set is written as a three-letter code in
brackets, but that width is a convention, not a checked rule. The enforced rule
is that a tag must be a **known/recognized tag** (one of the fixed set below);
any unrecognized bracket tag — even a 3-letter one like `[XYZ]` — errors as an
unrecognized line, and length is never measured. The uniform width is what keeps
content after a bare margin tag starting at column 7; that alignment is the
design rationale, not a checked rule (modifier lists like `[TYP:ext,uuid]` and
indented tags shift content right, and no diagnostic measures columns).

| Tag | Purpose |
| --- | --- |
| `[MOD]` | Module directive — names the module (top of file; defaults to the filename) |
| `[REQ]` | Requirement — one externally triggerable feature, `noun.verb(InDto): OutDto` |
| `[ENT]` | Inbound entrypoint — the only source of an HTTP/WS surface |
| `[SRV]` | Backing-service declaration (core.rune only) |
| `[PLY]` | Polymorphic step (interface dispatch) |
| `[CSE]` | Concrete case inside a `[PLY]` block |
| `[NEW]` | Constructor shorthand (`[CTR]` is an accepted synonym; `[NEW]` is canonical) |
| `[RET]` | Return an in-scope value (when the last step is a side effect) |
| `[TYP]` | Named type — the primitive building blocks |
| `[DTO]` | Data-transfer object — composed of types, name must end in `Dto` |
| `[NON]` | Noun — a domain concept description; names the domain class that untagged steps and `[NEW]` operate on (see the todos example) |

The `[MOD]` line may carry a description: `[MOD] name: one-line prose`, with
indented continuation lines beneath it appending further prose (the same
front-door-doc shape `[SRV]` blocks use). The colon and everything after it are
optional — a bare `[MOD] name` leaves the description empty. The collected text
becomes the module description and feeds codegen: it renders as the `//` comment
header of the generated module barrel (`src/<module>/mod-root.ts`), above the
`[NON]`/`[TYP]`/`[SRV]` glossary, as the module's front-door doc (see
[04-codegen.md](04-codegen.md)).

## Requirements and steps

- `[REQ] noun.verb(InputDto): OutputDto` at column 0. Input must be a DTO (or
  inline `{prop:type, ...}`, empty `{}` included — the DTO-input check passes
  anything starting with `{`), output must be a DTO, and by convention the
  **last step returns the REQ's output DTO**. Like the scope rules, that
  last-step rule is documented, not enforced: no tool diagnoses a mismatch
  (the LSP carries a parity test asserting a non-matching last step is NOT
  flagged), and codegen derives the coordinator's result from the seam types —
  any step producing the output DTO — not from the last line, so a final
  `[RET]` is never checked against the output either. One `[REQ]` per feature;
  it represents the happy path (and implies the e2e test).
- Steps are indented 4 spaces, `noun.verb(args): return-type`. Each step's
  return value enters scope for later steps. The parser of record also accepts
  a boundary step with **no return clause** at all (`service:noun.verb(args)`,
  no `: type`) — a lenient parse: such a step is a **send**, an awaited call
  like any other (errors propagate), with nothing bound from it (see
  [04-codegen.md](04-codegen.md)). "No blank lines between steps" is
  convention only: the parser of record ignores blank lines inside a `[REQ]`
  (they close nothing — following steps still attach) and no tool emits a
  diagnostic for them. Between requirements a double blank line is the
  documented convention — warning-level at most, never an error (the example's
  single blanks parse clean). 80-character line limit.
- **A step signature may span multiple lines.** When a step's `(` is not closed
  on its own line the parser of record tracks paren depth and folds the
  following indented lines into the one signature until the parens balance
  (`os:storage.save(` / `id,` / `payload` / `): void` — two in-scope names
  folded across lines — is a single step). The
  closing line ends the step on depth alone, so a bare `)` terminator closes it
  even with the output omitted (the following top-level `[REQ]` is not
  swallowed). This is distinct from a multi-line `[DTO]` description below —
  here the continuation is the *signature* itself.
- **Arguments are names, not variable expressions.** A plain (non-`Dto`)
  argument references an in-scope value — a previous step's return or a field
  of the REQ's input DTO (`task.fill(title)` uses the input's `title`). An
  argument ending in `Dto` instead declares the **data contract at that call**;
  no such value need be in scope: the example's `db:task.save(TaskDto)` says
  the save crosses the seam as a `TaskDto`, and codegen sources that value
  from the validated request input when the name is the REQ's own input DTO,
  otherwise from a value the flow builds (the pure core returns it, asserted
  at the seam) — except a write's **primary param**: on a boundary step
  declared `: void`, the first `Dto` param (else the first param) is always
  core-built or an earlier post-core step's result, never the request input,
  even when it names the REQ's own input DTO (the example's save consumes the
  core-built `TaskDto`; full resolution precedence in
  [04-codegen.md](04-codegen.md)'s coordinator paragraph). The scope
  convention ("params from scope or REQ input") governs plain arguments only.
- **Instance vs static:** `noun.verb()` operates on an instance (`noun` must be
  in scope); `Noun::verb()` is a static/class-level call (no scope requirement).
  A noun enters scope via `[NEW]`, a step that returns it, or a **boundary read
  on that noun** — loading its data hydrates the instance: in the example's
  `task.complete`, `db:task.load(id): TaskDto` puts `task` in scope for
  `task.markDone()` (in generated code the loaded DTO feeds the pure core,
  where instance steps run — see [04-codegen.md](04-codegen.md)).
- **Dot-less camelCase signature.** A `[REQ]` or `[ENT]` signature may be
  written with no `.`/`::` separator as a single camelCase `verbNoun`: the
  parser of record splits it at the first interior uppercase letter into
  verb + noun and lowercases the noun's leading letter. For a `[REQ]` this is
  the primary form — the verb-part becomes the verb and the noun-part the
  noun, so `createOrder` parses exactly like `order.create` (an accepted
  alternative to the `noun.verb` instance form). An `[ENT]` signature is
  `surface.action`, not `noun.verb`: a dot-less `[ENT]` maps the noun-part to
  the **surface** and the verb-part to the **action** — so `getRecording`
  yields surface `recording`, action `get`. A bare name with no interior
  uppercase and no separator fails to parse.
- **`[NEW] class`** instantiates a domain class — no parens, no return type
  (the class itself is implied and enters scope). The name refers to a domain
  concept declared as `[TYP] ...: Class` or described by a `[NON]` noun (the
  example's `[NEW] task` is backed by `[NON] task`, and `task` then serves as
  step instance and return type). Like the scope rules below, that reference is
  documented convention, not an enforced diagnostic. Constructor details are
  deliberately unspecified: specs describe flow, not construction.
- **`[RET] value`** returns something already in scope — used when the final
  operation is a side effect (e.g. a `db:` save returning `void`). The value's
  in-scope-ness is not checked (a scope rule, documented-not-enforced), and a
  `[RET]` is accepted at any step position, not only the last line — only its
  step-level indentation is validated. Generated coordinators derive the
  returned value from the seam types; the `[RET]` line survives only in the
  recipe comment.
- **Faults** sit 2 spaces deeper than their step (6 normally, 10 inside poly
  cases): lowercase, hyphen-separated, space-separated on one line
  (`not-found timed-out invalid-id`). Fault names describe *why* something
  failed. **Each fault implies a test case; a step with no faults cannot fail.**

### Boundaries and `[SRV]` services

A step that crosses a system boundary is written with a single-colon **service
prefix**: `db:task.save(TaskDto): void`. There are no built-in boundary kinds —
`db:`, `fs:`, `ex:`, `os:` are just service names, and every prefix used must
be declared by a matching `[SRV]` block in the project's shared **core spec**:
`core.rune`, recognized at the root-relative `spec/runes/core.rune` (canonical —
the durable home of the core spec) or under the legacy layouts still resolved
for reading (in-tree `src/core/core.rune`, plural `specs/runes/core.rune`;
legacy flat `spec/core.rune` / `specs/core.rune`),
probed in that order: the first readable copy wins. All finalized locations
are probed before any draft; the `.in-prog.rune` variants of the same
locations follow, in the same order, so a finalized core anywhere (e.g.
`spec/runes/core.rune`) beats a draft anywhere (e.g.
`src/core/core.in-prog.rune`). An `[SRV]` in any other project spec is
the `rune-service-core-only` error; only a standalone spec outside a project
layout (docs examples, corpus fixtures) may carry a self-contained `[SRV]`:

```rune
[SRV] (SIDECAR)db: DB_URL
    the project's primary datastore
    @docs https://docs.example.com/db
```

- Format: `[SRV] (TRANSPORT)<service>: <ENV_VAR, ...>`. The `: <ENV_VAR, ...>`
  clause is optional for **every** transport — an env-var-less declaration
  (`[SRV] (SDK)stripe`, with its required description and `@docs` line per the
  next bullet) parses clean; nothing requires env vars per transport.
  Transport is a closed set: `SDK`, `HTTP`, `WEBSOCKET`, `SIDECAR`, `NATIVE`
  (`NATIVE` = in-process runtime/std-lib boundary — filesystem, subprocess,
  crypto, clock; faults map to synchronous throws; typically declared without
  env vars).
- A one-line description **and** an `@docs <url>` line are required. Missing
  `@docs` is a hard parse error enforced by both the TS engine and the LSP; a
  missing description is enforced by the LSP only, mirroring `[DTO]`'s
  required description (`rune check`/`rune sync` let it pass — see Validation
  summary below). The URL surfaces as `@see` JSDoc on the generated adapter
  method.
- Boundary params/returns must be DTOs or one of the boundary-safe primitives
  (`string`, `number`, `boolean`, `void`, `Uint8Array`) — the full primitive
  set also includes `Class` and the `Primitive` alias (see Types, DTOs, and
  constraint modifiers below). `Class` is the one primitive that is never
  boundary-safe. `Primitive` (`string | number | boolean`) is boundary-safe:
  every member of the union is itself a boundary-safe primitive, so it erases
  to that union at the seam. A named `[TYP]` that resolves to a boundary-safe
  primitive (including `Primitive`) counts — it erases to its primitive at the
  seam (the example's `db:task.load(id)` crosses as a `string`); a `[TYP]`
  that resolves to `Class`, or to a non-primitive body, never crosses a
  boundary.
- Each `[SRV]` generates a shared client at `src/core/data/<service>/mod.ts`;
  module-level per-noun adapters construct it.

### Polymorphism

```rune
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        [CSE] fiveNine
        ...
```

`[PLY]` at step level (4 spaces) opens the block; `[CSE]` cases at 8 spaces,
their steps at 8, their faults at 10. The block closes when indentation returns
to 4. Cases may differ in sub-steps but share the interface return type.
Generated layout: `base/` + `implementations/<case>/` + `poly-mod.ts` barrel
(see [04-codegen.md](04-codegen.md)). Known gap: a `[PLY]` nested inside a
`[CSE]` is spec-illegal, but the parser of record accepts it leniently — the
nested `[PLY]` restarts a top-level poly block under the `[REQ]`, dropping the
case nesting. That lenient parse is normative for now: the fixture lives in the
valid corpus and its parse golden captures it, so a rebuilt parser must
reproduce it; rejection is deferred to the artifact-driven parser/lint work
(`fixtures/README.md`).

## Types, DTOs, and constraint modifiers

- `[TYP] name: primitive` — primitives are `string`, `number`, `boolean`,
  `void`, `Uint8Array`, `Class`, plus the `Primitive` alias
  (`string | number | boolean`). Generics (`Array<url>`,
  `Record<string, Primitive>`) and tuples (`[id, name]`) are allowed. A
  **bare-word union** body (`[TYP] verb: GET | POST | DELETE` — two-plus
  `|`-separated members, each a plain identifier that is neither a TS
  primitive/keyword nor a `*Dto` name) is accepted leniently — a `[TYP]` body
  is free text to the parser of record — and is a **string-literal enum**: the
  generated alias quotes the members, and DTO fields of the type validate with
  `@IsIn`; any other union passes through verbatim (see
  [04-codegen.md](04-codegen.md)). Types give semantic meaning to primitives
  (`id` vs raw `string`). A `[TYP]` body may also name a DTO or another
  `[TYP]` — no tool rejects either (the LSP carries a parity test asserting
  both parse clean), but only the DTO alias is supported: codegen imports the
  DTO class and re-exports it, and a DTO field of the alias nests and
  validates through it. A bare alias of another `[TYP]` (`[TYP] taskId: id`)
  is unsupported convention, like the scope rules: codegen emits the body
  verbatim (`export type TaskId = id;` — an unresolved reference, since the
  aliased type generates as `Id`), DTO fields of it carry only `@Allow()` (no
  validator), and it does not count as a primitive at boundaries — alias the
  primitive instead. Generic parameters and tuple members may reference
  declared `[TYP]`s, as the examples above do.
- `[DTO] NameDto: prop1, prop2` — properties reference types or other DTOs by
  name (property name = type name). Name must end in `Dto`. A 4-space-indented
  description line is **required** on `[DTO]` — but enforced by the LSP only
  (`lang/lsp/src/main.rs:643`; `rune check`/`rune sync` exit 0 on an undescribed
  DTO). Multi-line is allowed; it feeds LSP hover and generated docs. The same
  description line on `[TYP]` is **conventional, not required** — no tool flags
  an undescribed `[TYP]` (there is no `typ-described` rule anywhere).
- **`[DTO:open]`** (opaque-inbound DTO) validates its declared fields strictly
  but lets **undeclared** top-level fields ride through, instead of stripping
  them the way a plain `[DTO]` and `[DTO:core]` do. Codegen marks the generated
  class `static __keepOpen = true`; at the seam keep's assert validates the
  declared fields, then re-attaches the payload's extra fields (see
  [06-runtime.md](06-runtime.md), [04-codegen.md](04-codegen.md)). The only
  `[DTO]` modifiers are `core` and `open` — any other (`[DTO:opne]`) is an
  unknown-modifier error naming `:core or :open`.
- **Array properties** use a parenthesized suffix: `url(s)` → `urls: Array<url>`,
  `address(es)` → `addresses`, `child(ren)` → `children`.
- Unused types/DTOs are warnings; duplicate names are errors; the same
  `noun.verb` must keep an identical signature everywhere in the file.

The `[TYP]` bracket slot takes a comma-separated **modifier list**
(`[TYP:ext,uuid] memberId: string`):

| Modifier | Requires | Effect |
| --- | --- | --- |
| `core` | — | route to the shared kernel `src/core/` (also on `[DTO:core]`; never on `[REQ]`) |
| `ext` | — | value produced outside this module → `$name` external-input bind |
| `uuid` / `email` / `url` / `nonempty` / `json` | `string` | class-validator decorator on generated DTO fields (`@IsUUID()`, …; `json` = `@IsJSON()`, validates a JSON-blob string parses at the seam) |
| `int` / `min=N` / `max=N` / `positive` | `number` | `@IsInt()`, `@Min(N)`, `@Max(N)`, `@IsPositive()` |
| `example=V` | any | swagger `@ApiProperty({ example: V })` — feeds the cake/runner's generated bodies (see [07-cake.md](07-cake.md)) |
| `from=path\|path*\|query\|header` | — | where the field binds at the HTTP boundary (body is the default); `path` appends `/:field` to the derived route, `path*` a catch-all (route derivation: see Entrypoints below) |

The slot is split on **every** comma — no quoting or escaping — so a value
(`example=V`) runs only to the next comma or `]` and can never itself contain
a comma: the text after the comma is tokenized as another modifier (normally
an unknown-modifier error).

Array properties of constrained types use the `{ each: true }` decorator forms.
`[REQ]` takes **no** modifier at all.

## Entrypoints (`[ENT]`)

`[ENT] surface.action(InputDto): OutputDto` declares an inbound surface — the
inverse of a boundary call. **It is the only source of an HTTP surface**: a
module with `[REQ]`s but no `[ENT]` is a pure library module — no controller,
no route, no OpenAPI doc, no cake rows. Each `[ENT]` dispatches to the `[REQ]`
matched by its `(input, output)` signature — textual equality of the pair, so
named DTOs match by name and an inline `{...}` (or empty `{}`) input matches
only a `[REQ]` whose input reads identically; there is no structural
comparison. When two `[REQ]`s share the signature the dispatch is ambiguous
(an error) unless the `[ENT]` names its target explicitly with one indented
`[REQ]` body line restating the target's full signature:

```rune
[ENT] http.postRecording(GetRecordingDto): IdDto
    [REQ] recording.set(GetRecordingDto): IdDto
```

Only the body line's `noun.verb` resolves the dispatch; the parser of record
accepts the line at any indent ≥ 1 (4 spaces is the convention — no depth is
checked), it takes no modifier (a `[REQ:x]` body line is an error), and naming
a `[REQ]` the file doesn't define is an error. Zero matches is not an error:
the handler is generated unwired ("No coordinator wired"), throwing
`not implemented` and naming the coordinator file to create.

- Default: `POST` at an auto-derived route — the kebab-cased action under the
  kebab-cased surface (`http.getTask` → `POST /http/get-task`), plus one
  `/:field` segment per `from=path` input field in DTO declaration order and a
  trailing catch-all for a `from=path*` field. An optional clause between name
  and parens overrides verb and/or route:
  `[ENT] http.getTask @ GET /tasks/{id}(TaskRefDto): TaskDto`. Verbs are
  limited to `GET/POST/PUT/PATCH/DELETE`; `@ METHOD` alone overrides only the
  verb (route still auto-derived). An explicit `/template` replaces the derived
  sub-path (still mounted under the surface prefix): its `{field}` segments
  (and one trailing `{field*}` catch-all) bind URL parts to same-named
  input-DTO fields and are the sole source of path bindings — `from=path`
  appending never applies to a templated route (`from=query`/`header` still
  compose). No diagnostic checks a template's `{field}` names against the
  input DTO: a segment naming no field still becomes a route param and a
  recorded path source, but it binds nothing — the URL value reaches no DTO
  field. The converse gap binds nothing either: a `from=path` field the
  template does not name keeps its recorded `path` source (template sources
  merely overlay the field-declared ones) but gets no route segment, so no
  URL part exists to bind it — it stays unbound rather than falling back to
  the body.
- **The verb is contract, not styling** (the "waist rule" — see
  [12-history-and-roadmap.md](12-history-and-roadmap.md)): reads are `GET`
  queries returning current-state DTOs; writes stay `POST` command verbs. Never
  an "edit-this-record" endpoint.
- Empty input `({})` generates a no-argument handler.

### Process flows and derivation

A module's `[ENT]`s form a *process* that the **cake** — keep's interactive
per-module docs page (`/docs/<module>`), a guided walk of the endpoints in
process order — and the headless runner walk (see [07-cake.md](07-cake.md)).
The `order` / `dependsOn` / `bind` metadata is **derived from the DTO field
graph** — no wiring is written by hand:

- An ent depends on the earliest-declared ent whose **output mints** a field its
  input consumes (earliest-producer-wins). **Outputs declare what an ent mints,
  not what it echoes** — a field in both input and output is not a producer
  (echoes would poison derivation).
- Declare `[ENT]`s in the order the process runs — producer edges only point
  backward, so derived `dependsOn` can never cycle. A field minted only by a
  later-declared endpoint (or whose producer edge would close a cycle) gets no
  edge: it falls back to a `$field` bind, an external input at that point in
  the process.
- `[ENT:card]` / `[ENT:cash]` name **flows** (branches): tagged endpoints exist
  only in that flow, untagged in every flow; a field produced in different
  flows makes its consumer an OR-join (first-resolvable-wins alternatives).
  `[ENT:optional]` marks a step that is attempted but never blocks a run.
  Unlike `[TYP]`, the `[ENT]` bracket slot holds exactly **one** modifier —
  `ws`, `optional`, or a single flow name; there is no comma list and they do
  not combine (`[ENT:card,optional]` parses as a flow literally named
  `card,optional`). `ws` and `optional` are the only reserved words a flow
  cannot be named; any other word is a valid flow name — no diagnostic
  validates the modifier.
- A consumed field no endpoint produces, typed `[TYP:ext]`, becomes a `$field`
  **external input** — the cake's "Module inputs" card / the runner's
  `overrides.seeds` supply it, and *ghost stubs* keep it runnable meanwhile
  (see [04-codegen.md](04-codegen.md)). Without `[TYP:ext]`, such a field gets
  no bind at all: it stays an ordinary request field the cake/runner fill from
  its `example=` at send time, and `rune sync` warns when an input field has
  neither producer nor example (a guaranteed 422). The warning covers every
  field of the input DTO — the diagnostic draws no required/optional
  distinction.

### WebSocket entrypoints

`[ENT:ws] <surface> [@ /path]` declares a socket header; the indented
`verb(InputDto): OutputDto` lines under it are its **topics** (message
handlers), accepted at any indent ≥ 1 (4 spaces is the convention — no depth
is checked). The "WS topic rules" the Validation summary names are the parser
of record's errors: a malformed header (`[ENT:ws]` without a valid
`<surface> [@ /path]`, or one carrying a `(...)` signature), a socket with
zero topics, and a malformed topic — a topic's verb must be a bare identifier
and its output non-empty (`void` means "no reply"); any other indented line
under a socket, including a `[REQ]` line, is a malformed-topic error. Client
messages are `{ "topic": "<verb>", "data": <InputDto> }`; a non-`void` return
is the reply to that sender. Each topic dispatches to a `[REQ]` exactly as an
HTTP `[ENT]` does — matched by its `(input, output)` signature, a shared
signature is the same ambiguity error (topics cannot carry a body `[REQ]`, so
disambiguate with distinct signatures), and zero matches generates an unwired
handler. The match is textual on **both** slots, so a `void`-output topic
could only wire to a `[REQ]` declared `: void` — which the DTO-output rule
flags — and in a clean spec every no-reply topic therefore takes the
zero-match path. That path is the intended one, not a dead end: the socket
controller is create-once and dev-owned, so the dev implements the no-reply
behavior directly in the generated handler body (it throws `not implemented`
until filled). The `void` still shapes the generated method — no `output:` in
its decorator, a `Promise<void>` return, and no reply sent. A header's `@ /path`
segments provide the socket's handshake bindings: its `{name}` segments
translate to route params exactly like an HTTP template (`{name}` → `:name`,
a trailing `{name*}` catch-all) to form the socket's mount path. A header with
no `@ /path` mounts at `/<kebab-cased-surface>` — the same surface-derived
default an HTTP `[ENT]` uses for its route prefix — and carries no route
params. Either way the generated code binds nothing from the mount path
itself: each topic handler receives only its message payload (`data:
InputDto`), and reading connect-time values is left to the dev-owned handler
bodies. `from=` field sources are an HTTP-only concept: WS
codegen never consults them, so a `[TYP:from=query]` (or `path`/`header`)
field of a topic's input DTO stays an ordinary message-payload field. WS
endpoints carry no HTTP verb and never enter
the OpenAPI doc or the cake walk. A surface is HTTP or WS, never both.

## Validation summary

`rune check` / `rune sync` (the TS engine, `planManifest`) and the Rust LSP do
**not** enforce the same diagnostics — the LSP is stricter. The TS engine
enforces structure and semantics (what the generator needs to emit correct
code); the LSP additionally enforces the *shape* rules — `Dto` suffix, required
descriptions, in/out-DTO, boundary type-safety, uniqueness, line length,
indentation — that `rune check`/`rune sync` let pass (they exit 0 on all of
them). Do not assume a `check`-clean spec is LSP-clean; editing in the LSP
catches far more than a bare `rune check` (see [03-cli.md](03-cli.md)). The
load-bearing categories from `lang/docs/constraints.md`:

**Enforced by `rune check` / `rune sync` (the TS engine; the LSP mirrors these):**

- **Structure / parse** — every line must be a **known/recognized tag** (there
  is no tag-length rule — an unrecognized bracket tag, even a 3-letter one like
  `[XYZ]`, errors as an unrecognized line), `.`/`::` separators (though a
  dot-less camelCase `verbNoun` signature also parses — see Dot-less camelCase
  signature above — so a separator is not strictly required), fault format,
  and other malformed-line errors.
- **Types** — `[TYP]` modifier validation (unknown modifier, wrong base
  primitive, missing numeric value, bad `from=` source), and every DTO property
  resolving to a declared type/DTO.
- **Services** — `[SRV] @docs` presence (a hard parse error) and strict service
  resolution (a `service:` boundary prefix must name a declared `[SRV]`).
- **Entrypoints** — valid verb, body-`[REQ]` dispatch resolution,
  ambiguous-signature dispatch, `[PLY]`-requires-`[CSE]`, HTTP-vs-WS surface
  exclusivity, and WS topic rules (malformed header/topic, zero-topic socket —
  see WebSocket entrypoints). The `[ENT]` bracket modifier itself is never
  validated (flow names are free-form — see Process flows above).
- `[REQ]` takes no modifier.

**Enforced by the Rust LSP only (`rune check`/`rune sync` exit 0 on these):**

- **Line length** — the 80-column limit (`main.rs:167`).
- **Indentation** — REQ 0 / steps 4 / faults 6 / PLY 4 / CSE 8 / case faults 10
  / descriptions 4. Two indented forms carry no checked depth: an `[ENT]`
  body `[REQ]` line and `[ENT:ws]` topic lines (any indent ≥ 1 parses; 4 is
  the convention).
- **Types/DTOs** — the `Dto` suffix (`main.rs:490`), a required 4-space
  description on every `[DTO]` (`main.rs:643`; a `[TYP]` description is
  conventional, not required), a required one-line description on every
  `[SRV]` (mirroring `[DTO]`'s), and no duplicate `[REQ]` declaration (a
  repeated `noun.verb` `[REQ]` header errors as `Duplicate REQ`,
  `main.rs:387`; repeated *calls* to the same `noun.verb` are fine as long as
  the signature stays identical — see the identical-signature rule above).
- **DTO in/out** — a `[REQ]` (`main.rs:391`) and an `[ENT]` (`main.rs:341`)
  input and output must each be a DTO (any input starting with `{` — inline
  shapes and the empty `{}` — passes; only a bare non-`Dto` name is flagged).
- **Boundary type-safety** — a boundary-call parameter must be a DTO or a
  boundary-safe primitive (`main.rs:438`).

- **Scope rules** (instance nouns in scope, plain non-`Dto` params from scope
  or REQ input, step return types and `[NEW]` names resolving to declared
  types/nouns, the last step returning the REQ's output DTO, a `[RET]` value
  being in scope) are **documented but enforced by neither engine** — both
  deliberately skip them, and the LSP diagnostics mirror what the TS parser of
  record actually checks (see `lang/docs/constraints.md` and the design note at
  `lang/lsp/src/main.rs:102-104`).

## Comments and file conventions

`// ...` inline or whole-line comments are stripped before validation. A `//`
opens a comment only at the start of a line or after whitespace; glued to a
non-space character it stays intact, so the `://` in a URL never starts one —
`@docs https://…` links, URLs in prose, and `example=https://…` modifier
values all survive the stripper. One module per file. A spec is authored and KEPT at
`spec/runes/<module>.rune` — the durable canonical home. `rune sync` READS the
spec there and generates code into `<pkg>/src/<module>/`
(`<git>/server/src/<module>/` in the composed monorepo); it NEVER relocates the
spec into `src/` (for core, exactly the canonical `spec/runes/core.rune` above;
see [03-cli.md](03-cli.md)). Legacy layouts still resolve for reading — as read
sources, never move targets: flat `spec/<n>.rune` / `specs/<n>.rune`, plural
`specs/runes/<n>.rune`, and in-tree `src/<m>/spec.rune`. In-progress specs use
the `<module>.in-prog.rune` infix until finalized in place in `spec/runes/` by
the build pipeline (see [09-claude-skills.md](09-claude-skills.md)).
