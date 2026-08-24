# Codegen — From Spec to Tree

> Part of the [project spec series](README.md). The generator lives in
> `src/rune/domain/business/rune-manifest/mod.ts` (`planManifest`) — **pure**:
> spec text + the existing file set in, a `ManifestPlan{toCreate, toRegenerate,
> toSkip, errors}` out — `toSkip` carries each preserved file's fresh content,
> which is what `--regen` offers as a `.new` sibling. The equally pure
> `rune-sync/mod.ts` extends it to the `SyncPlan` §4 executes: `planSync` adds
> `toPrune` (every prunable orphan) and `toPruneOwned` (its dev-owned subset,
> which the entrypoint gates behind `--force`; the spec-owned rest deletes
> ungated), and `planCreateOnceGrowth` computes each preserved file's
> appended members — or its owed-hand-work report. The entrypoints (`sync`,
> `manifest`, `check`) do all I/O.

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
Planner-time errors: undeclared boundary services (strict
wherever a user meets them: `check`, `sync`, `manifest`, and `dev`'s pre-sync
check all set `strictServices`; the Rust LSP mirrors the strict check,
resolving shared `[SRV]`s from the project's `core.rune`; only raw codegen
callers — Studio preview, golden capture — leave strictness off), `[SRV]`
outside `core.rune`, ambiguous `[ENT]`→`[REQ]` matches, a surface declared
both HTTP and WS. `rune check`, `rune sync`, `rune dev`, and the LSP all
surface the same diagnostics — one source of truth.

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
| `[TYP]` | `dto/<name>.ts` — type alias. A bare-word union body (`[TYP] verb: GET \| POST \| DELETE` — two-plus `\|`-separated members, each a plain identifier that is neither a TS primitive/keyword nor a `*Dto` name) is a **string-literal enum**: the alias quotes the members, and DTO fields of the type validate with `@IsIn`; any other union passes through verbatim (typed, kept past assert's whitelist with `@Allow()`, no validator). The union body is a lenient parse — `[TYP]` bodies are free text — documented as the bare-word union form in [02-language.md](02-language.md). |
| `[ENT]` (HTTP surface) | `entrypoints/<surface>/mod.ts` — `@EndpointController` with one `@Endpoint` per action, computed `order`/`dependsOn`/`bind` — + `e2e.test.ts` |
| `[ENT:ws]` | `entrypoints/<surface>/mod.ts` — `@WsEndpointController` with one `@WsEndpoint` per topic; deliberately no test file — WS topics never enter the `exerciseEndpoints` walk `e2e.test.ts` drives |
| `[SRV]` (core.rune only) | `src/core/data/<service>/mod.ts` shared client + `smk.test.ts` |
| `[NON]` | no file of its own — its prose flows into generated docs: the noun's business/adapter class JSDoc, the poly base's doc comment, the business `test.ts` header, and `mod-root.ts`'s "Domain nouns" glossary |
| `[NEW]`/`[CTR]`, `[RET]` | no file — recipe-only: each renders as a numbered line (`[NEW] <Class>`, `[RET] <value>`) in the core's recipe comment and the `int.test.ts` copy of it |
| module | `src/<module>/mod-root.ts` (regenerated barrel) |

**Fault-implied tests**: every declared fault scaffolds a named
`Deno.test("<fault>", …)` TODO stub in fixed test files — `int.test.ts`
carries every fault in its `[REQ]`'s subtree (poly cases included), a noun's
`smk.test.ts` every fault on any of its boundary steps, a business `test.ts`
every fault on its untagged steps; no other emitted test carries fault stubs.
The `rune-fault-coverage` lint rule fails a declared fault whose file lacks an
exactly-named test ([05-linter.md](05-linter.md)).

**The generated `e2e.test.ts` is env-gated.** Each `[ENT]` surface's
`e2e.test.ts` is emitted with `ignore: !Deno.env.get("RUNE_E2E")`, so a bare
`deno test` **silently skips it** — it boots the surface and drives every
endpoint through `exerciseEndpoints` only when `RUNE_E2E` is set in the
environment (`RUNE_E2E=1`). It is the only env-gated generated test:
`int.test.ts` and `smk.test.ts` run ungated. A legend comment above the
exercise call says as much ("run with `RUNE_E2E=1` to drive every endpoint to
green").

**The coordinator is the hexagonal imperative shell.** Generated shape: assert
the input DTO at the seam → run read-boundaries pre-core → call a pure
`<verb>Core()` (where all business logic lives — generated as
`throw new Error("not implemented")`, **red by design**) → run mutation/write
boundaries post-core in spec order, each call site bound from one shared
name-resolution table → assert the output DTO. Which side of the core a
boundary step runs on is decided by verb + dataflow, not by return type alone:
a step is a pre-core read only when its verb prefix-matches the read-verb
whitelist (`get list load read fetch find lookup query search download count
peek check exists`, plus `is`/`has`/`can`/`assert` predicates — matched on the
camelCase word boundary, so `getRecording` reads but `getaway` doesn't) **and**
every DTO param it takes is the request input itself. Every other boundary
runs post-core in spec order, each emitted as an awaited call whose errors
propagate: a step declared `: void` is a **write** — its primary param (first
DTO param, else first param) is core-built, added to the core's return
contract and seam-asserted at the call site, unless an earlier post-core
result already produced it — those are the primary param's only two sources
(the table is never consulted for it, so a write whose primary param names
the REQ's own input DTO still consumes a core-minted value, never the
validated input), while its remaining params resolve through the table; a
step with no return clause at all is a **send** — an awaited call like every
other post-core boundary (errors propagate; nothing runs detached), just with
no value to bind: every param resolves through the table (a form the parser
of record accepts leniently — documented with the step grammar in
[02-language.md](02-language.md)); and the rest — value-returning mutations
(`db:task.create(TaskDto): TaskDto`) and reads consuming a core-built DTO —
bind seam-asserted locals. So the core's guards throw before any write lands. The
table resolves every post-core param but a write's primary in fixed
precedence — request-input value,
hoisted pure-producer local, an earlier post-core result, a pre-core read's
output — and an unbindable param is never a planner error (scope rules are
documented but deliberately unenforced — see
[02-language.md](02-language.md)): post-core it is added to the core's return
contract (`out.<field>` — the red-by-design core must mint it); pre-core it
falls back to an input-field access, leaving the spec error visible as a type
error at `deno check`. Hoisting is the only way an untagged step appears in
the coordinator: a pure step whose scalar output any table-resolved post-core
param consumes — a write's non-primary param, a send's param, a
value-returning mutation's param, or a read's param — (transitively, through
producers' own params) is emitted as a local between the adapter
constructions and the pre-core reads — in spec order, first producer of a
value wins; every other untagged step exists only in the core's recipe. Context labels
(`"task.create input"`, `"task.load"`) flow into `RuneAssertError` so a 422
says where the check ran (see [06-runtime.md](06-runtime.md)).

Process metadata for `[ENT]` chains is computed here from the DTO field graph
(mint-not-echo, earliest-producer-wins, declaration order — the rules in
[02-language.md](02-language.md)) and written as `@Endpoint` decorator
arguments; keep surfaces them as the `x-keep-process` OpenAPI extension.

The template engine is a tiny `{{#each}}`/`{{var}}` substituter; substitutable
bodies (`DEFAULT_TEMPLATES`) are mirrored byte-identically into
`keywords.json → codegen.templates` by `scripts/gen-codegen-templates.ts`, so
the artifact can drive generation (`--artifact`) without drift.

### 4. Reconcile and emit (`rune sync`)

The lifecycle policy (`DEFAULT_POLICIES`) is the load-bearing invariant:

- **Regenerate** (spec-owned, DO-NOT-EDIT banner): `mod-root.ts` and
  `bootstrap/modules.ts` (the module registry: one import per
  `src/<module>/entrypoints/<surface>/mod.ts` surface module the **spec
  implies** — the post-sync, spec-projected surface set, including any
  `[ENT]` surface this same sync's `toCreate` is about to write, not just
  ones already on disk before the sync ran — exported as the `modules` array —
  plus the production-gated ghost-stub entry while a generated
  `bootstrap/stubs.ts` is live). Rewritten in full every sync, after the
  create/regenerate/prune writes land, so every surface it names exists on
  disk by the time it is written.
- **Create-once** (dev-owned, "Edit the body" banner): everything else —
  coordinator/business/adapter `mod.ts` bodies, all tests, entrypoint bodies,
  `dto/` files (`[DTO]` classes and `[TYP]` aliases — hand enrichments survive
  re-syncs), `bootstrap/mod.ts` (the app bootstrap: exports `api = await
  bootstrapServer(<app-name>, modules, { port: config.port })` — app name
  derived from the project dir — plus an `import.meta.main` listen block), and
  `bootstrap/config.ts` (centralized env reads: `config.port` from `PORT`,
  default `3000`). Written only if absent; when a spec
  grows, missing members are **appended** exactly as the generator would emit
  them — a throwing stub method, a spec-exact DTO field (decorators included),
  an `@Endpoint` delegator. Growth applies only to business/adapter/entrypoint
  `mod.ts` classes and `[DTO]` classes — tests, coordinators, `[TYP]` aliases,
  and `[SRV]` clients are preserved verbatim, and so are an existing `[PLY]`
  noun's files: `base/{mod,test}.ts` and `implementations/<case>/mod.ts` sit
  deeper than the growable `<noun>/mod.ts` path and fall outside the growth
  target set, so a member the poly subtree gains is never appended to (nor
  reported as owed hand-work on) an existing base or variant file — it reaches
  the tree only when a new `[CSE]` scaffolds its own `implementations/<case>/`
  — and is append-only: a changed
  or removed member never propagates (`--regen <path>` is the non-destructive
  pull). Classes too drifted to locate are reported as owed hand-work.
  The `poly-mod.ts` barrel is create-once and never grows (it holds no class):
  scaffolded pointing at the first declared variant, it is thereafter the dev's
  dispatch choice — a new `[CSE]` scaffolds its `implementations/<case>/` but
  never edits the barrel. Sync's only touch is a warning: when the barrel
  re-exports a variant no `[CSE]` declares, or whose folder is gone (e.g. a
  `--force` prune removed the arm), it tells the dev to repoint the barrel by
  hand; a hand-rewritten barrel (runtime switch, multiple re-exports) is
  skipped rather than falsely warned about.
- **Prune**: orphans are pruned per slot — whole dirs under
  `domain/{business,data,coordinators}/` and `entrypoints/`, single files
  under `dto/`. An orphaned `dto/` file ([DTO] or
  [TYP]) counts spec-owned for prune and is deleted on every sync; a dir
  orphan counts dev-owned (hand-written bodies — the dir prunes as a unit),
  is reported every sync and deleted only under `--force`. The shared `[SRV]` clients are `prunable: false` — never
  auto-deleted; an orphaned client is removed by hand. `--regen <path>` writes
  a `.new` sibling for non-destructive single-file regeneration.
- **Byte-identical writes are skipped** — no mtime change, no FS event — so
  `rune dev`'s watcher can't loop on sync's own output.

Sync also maintains the project `deno.json` import map (`REQUIRED_IMPORTS`,
the complete set: `@/` → `./` (the project root), `class-validator` →
`npm:class-validator@^0.14`, `class-transformer` →
`npm:class-transformer@^0.5`, `reflect-metadata` → the exact
`npm:reflect-metadata@0.1.13` pin — kept in lockstep with keep's own copy;
load-bearing for the single-copy invariant ([06-runtime.md](06-runtime.md)) —
`#std/assert` → `jsr:@std/assert` and `#std/path` → `jsr:@std/path` (both
unpinned), `@mrg-keystone/rune` → `jsr:@mrg-keystone/rune@^4` with `#assert` →
`jsr:@mrg-keystone/rune@^4/assert` (keep's assert subpath — same major by
design, so both resolve to one keep copy), and `#api-doc` →
`jsr:@danet/swagger@^2.1.1/decorators`; plus the `experimentalDecorators` +
`emitDecoratorMetadata` compiler options) and regenerates the bootstrap
registry. The finalized spec is **not** relocated into `src/<module>/`: it
stays durable in `spec/runes/<m>.rune` — the canonical home
([02-language.md](02-language.md)) — and codegen READS it there, generating
into `<root>/src/<module>/` (§3). Full step order in [03-cli.md](03-cli.md).

## The contract artifact — `spec/contract/`

The build also EMITS a committed contract under `spec/contract/`, so downstream
consumers — the typed client and the sprig frontend — build **with no rune
backend present**:

- **`spec/contract/openapi.json`** — a DERIVED artifact: the composed app's
  OpenAPI document, refreshed as part of the build pipeline and **stamped with
  a content hash of the built backend** (the generated `src/<module>/` tree).
  It is committed to `spec/`, so consumers read it offline instead of booting
  the app to scrape `/docs/<m>/json`.
- **`spec/contract/client/`** — the typed client, generated from
  `openapi.json` by the `contract client` tool and **stamped with the
  `openapi.json` hash it consumed**.

The stamps make a stale contract **fail loud** rather than drift silently: a
committed `openapi.json` whose stamp no longer matches the backend it was built
from, or a client whose stamp no longer matches the `openapi.json` it was
generated from, is a build error. That is what lets the frontend build from the
committed `spec/contract/` files alone — the hash chain, not a live backend,
guarantees they are in sync.

## Ghost stubs — the `[TYP:ext]` lifecycle

An external input is a promise that *someone else* produces the value. Until
that producer exists, sync generates `bootstrap/stubs.ts` — a ghost stub
module with one trivial GET endpoint per unfulfilled input (`mint-<name>`,
marked `stub: true`), each minting a placeholder of the declared primitive. It
mounts like any module (cake at `/docs/stubs`, badged `stub`), so dependent
modules run end-to-end before their real producers are built.

- **Production exclusion** — the generated registry skips the stub module when
  `DENO_ENV=production`; stubs can never ship.
- **Evaporation** — the moment any synced module's endpoint mints the field,
  the next sync removes the stub endpoint, and deletes `bootstrap/stubs.ts`
  entirely once every input has a real producer. Nothing references the file,
  so nothing breaks when it goes.
- The file is header-guarded: a hand-written `bootstrap/stubs.ts` or a real
  module named `stubs` disables ghost stubs rather than being overwritten. In
  that state the regenerated registry omits both the stub import and its
  `DENO_ENV=production` gate — the hand-written file is left untouched but
  never wired into `modules`; the production gate exists only for the
  generated ghost. (A real `stubs` module's surface is registered like any
  other, ungated.)

## Heal rules

Sync scaffolds `heal-rules.json` from the spec's declared fault slugs. Its
directory mirrors keep's cake config resolution ([03-cli.md](03-cli.md) step
8): `KEEP_FIXTURES_DIR` when set, else `spec/misc/` when the codegen root has
a `spec/` dir of its own, else the legacy `fixtures/` — so in the canonical
composed layout the file lands at `<git>/server/fixtures/heal-rules.json`.
Unlike this durable, merge-owned fixture, transient build scratch — baseline,
facts, module-map, test-inventory — never lands in `spec/`: it is DERIVED and
lives in a non-spec build cache (e.g. `<root>/.rune-build/<m>/`), so the
durable `spec/` artifact carries no transient scratch.
The file is a declarative map from API error slugs (`"not-found"`, `"already-exists"`)
to one-click fixes (`run-step`, `set-input`, `pick`, `retry`, `note`, …) that
the cake's heal panel executes ([07-cake.md](07-cake.md)). The file is
**merge-owned**: sync adds new slugs and never clobbers hand-enriched entries.
Slugs whose fault leaves the spec are kept, never auto-deleted; every sync
reports them as stale ("kept — prune by hand"). Fresh entries carry
`todo: true`; `rune lint --strict` refuses to ship a module while any remain
un-enriched — including a stale `todo: true` orphan, which blocks until it is
enriched or hand-pruned.

## Validation & Swagger details worth knowing

- A DTO field whose `[TYP]` aliases a primitive validates with that
  primitive's base check — `@IsString()` / `@IsNumber()` / `@IsBoolean()` —
  plus the alias's constraint-modifier decorators (`[TYP:email] email: string`
  → `@IsString()` + `@IsEmail()`). A field with no `[TYP]` at all is typed
  `unknown` under `@Allow()` with a `// TODO: tighten` marker; the
  `@Allow()`-only pass-through otherwise applies only to a `[TYP]` resolving
  to a non-primitive, non-enum type (`Uint8Array`, a generic, a real type
  union) with no constraint modifiers — see the `[TYP]` row in §3.
- Constraint modifiers become class-validator decorators; `(s)` array
  properties use the `{ each: true }` forms; `int` replaces `@IsNumber()`.
- `(s?)` arrays deliberately drop per-element validation (tolerating dirty
  inbound data — a `null` element passes). The `?` inside the parens is
  element-leniency only: the property itself stays required — `@IsArray()`
  still applies, so omitting the field is still a 422. Whole-field optionality
  is the separate trailing `?` (`field(s?)?` → `@IsOptional()`).
- The `@ApiProperty` builder routes `min`/`max`/`type` under `items` for array
  properties — OpenAPI silently ignores them at the property level.
- `example=` values emit swagger examples that the cake and runner use to fill
  required, unbound input fields; sync's input diagnostics warn when a
  required field has no producer *and* no example (a guaranteed 422).
- `jsdocSafe` breaks `*/` in prose with a zero-width space so descriptions
  can't terminate a generated JSDoc block.
- `[SRV]` `@docs` URLs surface as `@see` JSDoc on generated adapter methods.

## The run-all gate

Sync's final act: write a throwaway runner script, boot the composed app in a
subprocess, and drive keep's `exerciseEndpoints` over it — printing the
verdict last: `run-all: N/N steps passed — the composed app runs green`. Soft
on every failure mode, skippable with `--no-run`. Together with red-by-design
cores and fault-implied tests, this is the "you can't not notice" principle:
generation never pretends the app works.
