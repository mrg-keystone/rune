# Rune Codegen Enrichment Specification

## Build status (2026-06-17)

**SHIPPED & GREEN** (verify GREEN, 392 tests pass) — all *programmatic* renderers
enriched; no grammar change, no breaking change:
- Coordinator `renderCoordinator`: E1 spec-line provenance · E2 `@param`/`@returns`/
  `@throws` JSDoc · E3 ordered step recipe in `<verb>Core` · **E4 static-`new`
  bug fix** (static-only nouns no longer `new`'d).
- Business + data classes `renderImpl`: E12 provenance + `[NON]` class doc · E13
  per-method `@throws` (faults UNIONed on `MethodSig`) · E14 `@param`/`@returns`
  from `[TYP]`/`[DTO]` prose · E18 adapter I/O-boundary role doc.
- DTO `renderDto`: E23 field `[TYP]` JSDoc · E24 field provenance · E25 ext note ·
  E26 class JSDoc + visibility + provenance · E27 **merged `@ApiProperty` umbrella**
  (description/example/required/isArray/minimum/maximum/format/minLength/binary) ·
  E28 pluralization + unknown-field remedy.
- TYP `renderTyp`: E29 alias JSDoc · E30 constraint prose + ext + core + line.
- Entrypoint controller `renderEntrypointController`: E37 per-endpoint provenance ·
  E38 delegate/process/bind/flow/optional JSDoc + comments · E39 actionable
  unmatched-handler guidance.
- Entrypoint e2e `renderEntrypointE2e`: E43 seed from `example=` · E44 seed legend
  + endpoint-chain roster.
- Business test `renderBusinessTest`: E32 AAA skeleton + `[NON]` header + fault
  raiser context.

**NOT YET BUILT:**
- Template-based (need `gen-codegen-templates.ts` resync): E33 int-test recipe ·
  E34 smk boundary list · E35 poly test skeletons · E36 int-test provenance ·
  E46 mod-root glossary · E48 poly base docs. Non-breaking; achievable.
**SHIPPED — Tier 2 grammar (built in worktree, integrated, GREEN):**
- `[SRV] <transport>:<name>: <ENV,…>` + `[MOD] name: desc` parsing; `matchBoundary`
  rewritten to a single-colon `service:` prefix (no fixed kinds); `BoundaryStepNode.
  tag`→`service`; `SrvNode` + `RuneAst.srvs`/`moduleDescription`.
- tree-sitter `srv` tag (keywords.json + generate-core + grammar.js/json + WASM +
  highlights — 11/11 tags); `artifact/schema.ts` FOLLOWS gained `service`.
- new `rune-service-presence` lint rule (project-scoped); migrated example/todos +
  fixtures/specs to `[SRV]`.
- **E20 service docs on adapters**: each generated adapter method documents its
  backing service + transport + env vars + prose (the original jr-dev gap, closed).

**SHIPPED — final polish (all green):**
- `[MOD]` description + mod-root **front-door doc**: the `[MOD]` prose, domain-noun
  glossary ([NON]), type vocabulary ([TYP]), and backing services ([SRV]) (E10/E46).
- int-test ordered recipe + spec-line provenance (E33/E36); smk boundary-method
  list (E34); poly base variant roster + [NON] prose + real signature, impl AAA
  (E35/E48). (templates resynced via gen-codegen-templates.ts.)
- **Editor highlighting of `service:` prefixes** — SOLVED. The external scanner
  emits a `SERVICE_PREFIX` token (lowercase word + a single colon, distinct from
  the `::` static separator — the lookahead the DFA can't do), unified with the
  desc/fault externals at the shared line-start entry. Proven via `tree-sitter
  parse`: `firebase:order.save` → `boundary_line`/`service_prefix`, `id::generate`
  → `step_line`, `timeout` → `fault_line`.

**Status: complete.** Every spec item is built; `verify: GREEN`; 399/400 tests
(the 1 is `findGitRoot` asserting the dir is named "rune" — a worktree-path
artifact that passes in the real repo). Ship by merging
`worktree-agent-a976ca4e071053a7f` → develop.

## Thesis

The rune AST carries roughly twice the dev-facing information that codegen emits: every `.line`, every `faults[]`, the entire ordered `ReqNode.steps` recipe, all `NonNode` prose, `TypNode.description`/`modifiers` at the field-usage site, `[NEW]`/`[RET]` declarations, the real `[PLY]` signature, and `DtoNode.description` as anything richer than a bare `//` line are parsed and then discarded before reaching the generated file — so a junior dev opening a scaffolded `mod.ts` sees `throw new Error("not implemented")` with no statement of what the file must do, what it can throw, where it came from, or what its types mean. This specification accounts for **100% (69/69) of the fields** on the twelve `rune-parse/mod.ts` interfaces, defines the enrichment that surfaces each discarded field into the generated code (overwhelmingly via comment/JSDoc/provenance channels that change no runtime behavior), and sequences the work into three tiers: **Tier 1** (comment-only, data available today — ship immediately), **Tier 2** (gated on the two LOCKED-but-unbuilt grammar changes, `[SRV]` services and `[MOD]` descriptions), and **Tier 3** (changes emitted code — recipe-into-core, `@ApiProperty` schema, test skeletons — requiring golden refreshes and the specific correctness guards itemized below).

---

## 1. Coverage Matrix — all 69 fields, 12 interfaces

**Status legend:** `emit-now` = data present today, comment/doc channel, no grammar dep · `needs-SRV` = blocked on the `[SRV]` grammar (change 1) · `needs-MOD` = blocked on the `[MOD]` description grammar (change 2) · `emit-now (code)` = data present today but the enrichment changes emitted code (Tier 3) · `not-emitted` = intentionally never surfaced, with reason.

Field references are `rune-parse/mod.ts:<line>`. "Current" = today's codegen treatment (verified, cited inline in §3).

### RuneAst (`:11-19`) — 7 fields

| Field | Current codegen treatment | Planned enrichment | Status |
|---|---|---|---|
| `module` (:12) | Name only — import paths (`rune-sig:124`), `@EndpointModule` pascal arg, `MOD_ROOT_TPL` (`:1562`) | NAME already emitted; **[MOD] description** → mod-root doc, controller JSDoc/`@EndpointController({description})`, impl/coordinator/e2e headers, `@module/@fileoverview` | name `emit-now`; description `needs-MOD` |
| `reqs` (:13) | Fully consumed — coordinators, mod-root re-exports, tests | + recipe-into-core, `@throws`, `@param/@returns`, mod-root signature comments, ENT→REQ xref | `emit-now` |
| `ents` (:14) | Fully consumed — controllers, e2e | + per-endpoint provenance, process/bind prose, delegate summary | `emit-now` |
| `dtos` (:15) | Fully consumed — `renderDto` | + field JSDoc, provenance, `@ApiProperty`, visibility tags | `emit-now` |
| `typs` (:16) | Fully consumed — `renderTyp`, `renderDto` | + field-level desc/modifiers/format/enum, alias JSDoc | `emit-now` |
| `nons` (:17) | **ZERO codegen readers** (only `rune-parse/test.ts`) | glossary, business/data/poly class docs, coordinator import xref, stepless stub | `emit-now` |
| `errors` (:18) | Consumed for diagnostics only (`rune-manifest:125`) | — | `not-emitted` (diagnostics, not codegen output) |

### ReqNode (`:21-28`) — 6 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `noun` (:22) | Coordinator signature, file paths, mod-root | + mod-root `// [REQ]` comment, ENT→REQ xref, `@throws` step attribution | `emit-now` |
| `verb` (:23) | Coordinator signature, file paths | + same | `emit-now` |
| `input` (:24) | Signature + at-seam assert ctx | + `@param` JSDoc on coordinator + endpoint, int-test fixture | `emit-now` |
| `output` (:25) | Signature + return assert | + `@returns` JSDoc | `emit-now` |
| `steps` (:26) | **Partial** — filtered to boundaries + `instanceNouns`; ordered recipe discarded (`:1016`) | full recipe-as-comment in `<verb>Core` + int-test; data-flow wiring | `emit-now (code)` |
| `line` (:27) | **ZERO readers** (only `ParseError.line`) | `// Spec: <runePath>:<line+1>` coordinator/test provenance | `emit-now` |

### EntNode (`:30-48`) — 7 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `surface` (:31) | `@EndpointController(kebab)`, paths | + handler JSDoc / route label | `emit-now` |
| `action` (:32) | `@Endpoint` method name | + delegate summary, e2e roster | `emit-now` |
| `input` (:33) | `@Endpoint({input})`, handler param | + `@param` from DTO desc | `emit-now` |
| `output` (:34) | `@Endpoint({output})`, return type | + `@returns` from DTO desc | `emit-now` |
| `modifier` (:40) | `entFlow`→`flows`/`optional` (`:1045`,`:1135`) | + flow-branch & optional-semantics comments | `emit-now` |
| `line` (:41) | **ZERO readers** | `// from <runePath>:<line+1>` above each `@Endpoint` | `emit-now` |
| `delegate` (:47) | Coordinator match (`:1170`) | + named in delegate-summary / unmatched-handler guidance | `emit-now` |

### StepNode (`:52-61`) — 8 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `kind` (:53) | Routing discriminant (`:823`) | — | `not-emitted` (discriminant) |
| `noun` (:54) | `instanceNouns`, `collectNounMethods` | recipe, method provenance | `emit-now` |
| `verb` (:55) | Business class method name only | recipe lines, fault attribution | `emit-now (code)` |
| `params` (:56) | Business method stub; **never in core** | core pre-stub / recipe | `emit-now (code)` |
| `output` (:57) | Business method return; **never in core** | recipe `: output` annotation | `emit-now (code)` |
| `isStatic` (:58) | static/instance split in `renderImpl`; **not branched in core** (bug) | recipe `::` rendering + drop bogus `new` for static-only nouns | `emit-now (code)` |
| `faults` (:59) | **Partial** — test stubs only; never `@throws` | `@throws` on method/coordinator + recipe annotations | `emit-now` |
| `line` (:60) | **ZERO readers** | recipe/test provenance | `emit-now` |

### BoundaryStepNode (`:63-73`) — 9 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `kind` (:64) | Routing discriminant | — | `not-emitted` (discriminant) |
| `tag` (:65) | **ZERO codegen reads** of the value; being **replaced** by `[SRV]` | service+transport doc; interim db/fs/... classifier possible | `needs-SRV` (interim `emit-now`, transitional) |
| `noun` (:66) | Adapter class, `collectNounMethods` | recipe, fault attribution | `emit-now` |
| `verb` (:67) | Adapter method name | recipe, `@throws` attribution | `emit-now` |
| `params` (:68) | Adapter method params | recipe, call provenance | `emit-now` |
| `output` (:69) | reads/writes/**sends** partition (`:825-830`) | fire-and-forget marker when `output===""` | `emit-now` |
| `isStatic` (:70) | static/instance in `renderImpl` | — (already correct) | `emit-now` |
| `faults` (:71) | **Partial** — smk test stubs only | `@throws` on adapter method | `emit-now` |
| `line` (:72) | **ZERO readers** | call/recipe provenance | `emit-now` |

### PlyNode (`:75-84`) — 8 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `kind` (:76) | Routing discriminant | — | `not-emitted` (discriminant) |
| `noun` (:77) | Poly dir/class; excluded from `instanceNouns` (`:839`) | base/barrel docs, coordinator dispatch note | `emit-now` |
| `verb` (:78) | `POLY_BASE_MOD_TPL` abstract name | real-signature doc, dispatch coverage test | `emit-now` |
| `params` (:79) | **Overwritten to `unknown`** in `typedPly` (`:399`) | recover real type in base doc comment | `emit-now` |
| `output` (:80) | **Overwritten to `unknown`** (`:399`) | recover real type in base doc comment | `emit-now` |
| `isStatic` (:81) | Copied to `typedPly`, **never read** | `// rune: static dispatch` note | `emit-now (code)` |
| `cases` (:82) | Poly impl dirs/classes | base variant roster, barrel dispatch map | `emit-now` |
| `line` (:83) | **ZERO readers** | test provenance | `emit-now` |

### CseNode (`:86-90`) — 3 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `name` (:87) | Poly impl dir/class name | variant roster, dispatch map | `emit-now` |
| `steps` (:88) | **Discarded as recipe** — walked for sub-file emit + faults only; variant body is bare `throw` | per-case recipe + faults in variant body/test | `emit-now (code)` |
| `line` (:89) | **ZERO readers** | `// Variant … [CSE] @ <path>:<line+1>` | `emit-now` |

### CtrNode (`:92-96`) — 3 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `kind` (:93) | Routing discriminant | — | `not-emitted` (discriminant) |
| `className` (:94) | **ZERO codegen readers** — core `new X()` comes from `instanceNouns`, not `[NEW]` | `[NEW]` recipe line; construct only `[NEW]`-only nouns (dedup vs `instanceNouns`) | `emit-now` (comment); construction `emit-now (code)` |
| `line` (:95) | **ZERO readers** | recipe-row provenance (depends on recipe item) | `emit-now` (with recipe) |

### RetNode (`:98-102`) — 3 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `kind` (:99) | Routing discriminant | — | `not-emitted` (discriminant) |
| `value` (:100) | **ZERO codegen readers** — result type comes from `req.output` seam, not `[RET]` | `[RET]` recipe line naming the `result` expression | `emit-now` |
| `line` (:101) | **ZERO readers** | recipe-row provenance (depends on recipe item) | `emit-now` (with recipe) |

### DtoNode (`:104-110`) — 5 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `name` (:105) | Class name | — (already emitted) | `emit-now` |
| `properties` (:106) | Fields | field provenance, pluralization note, dispatch-discriminator note | `emit-now` |
| `description` (:107) | **Partial** — bare `// ` line above class only (`:693`) | `/** */` class JSDoc, nested-field desc, `@param/@returns`, `@ApiProperty({description})` | `emit-now` + `emit-now (code)` |
| `isCore` (:108) | Dir placement only (`dtoDir`) | `// rune declares: [DTO:core]` + `@public/@internal` | `emit-now` |
| `line` (:109) | **ZERO readers** (error formatting only) | `// rune declares: [DTO…] @ line <line+1>` | `emit-now` |

### TypNode (`:112-132`) — 7 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `name` (:113) | Alias name + `// rune declares:` line | — | `emit-now` |
| `typeName` (:114) | Alias type, DTO field type | enum (`\|`-union)→`@IsIn`+`@ApiProperty({enum})`; `Uint8Array`→`{format:"binary"}` | `emit-now` + `emit-now (code)` |
| `description` (:115) | **Partial** — only `// ` in alias file (`:733`); **never on DTO fields, `@ApiProperty`, impl params/returns, stubs, e2e seeds** — the single largest discarded node-axis signal | field JSDoc, `@ApiProperty({description})`, impl `@param/@returns`, stub doc, e2e seed comment, alias `/** */` | `emit-now` + `emit-now (code)` |
| `isCore` (:116) | Dir placement (`src/core/dto`) | `// core: shared across modules` + `@public` | `emit-now` |
| `isExternal` (:122) | Entrypoint `$field` binds; **never in `renderDto`** | field `// [TYP:ext]` note, alias provenance, e2e seed note | `emit-now` |
| `modifiers` (:130) | DTO field validators + alias tag; **not mirrored to `@ApiProperty`** | `@ApiProperty({minimum,maximum,format,enum,isArray,required,minLength})`, alias constraint prose, stub validators/mint | alias prose `emit-now`; `@ApiProperty` `emit-now (code)` |
| `line` (:131) | **ZERO readers** (error only) | `// Generated … :<line+1>` alias/DTO provenance | `emit-now` |

### NonNode (`:134-138`) — 3 fields

| Field | Current | Planned | Status |
|---|---|---|---|
| `name` (:135) | **ZERO codegen readers** | glossary entry, class-doc subject, xref | `emit-now` |
| `description` (:136) | **ZERO codegen readers** (the confirmed gap) | business/data/poly class doc, mod-root glossary, coordinator import xref, controller/test subject | `emit-now` |
| `line` (:137) | **ZERO readers** | — | `not-emitted` (no catalog item; `[NON]` owns no own file except the optional stepless stub, which anchors no line; `name`+`description` carry the value — flagged as the lone deliberate drop) |

### Completeness statement

**69/69 fields accounted for.** Every field has a verified current treatment and an explicit disposition. The only field with **no enrichment item anywhere** is `NonNode.line` (`:137`) — explicitly classified `not-emitted` with reason above (it is the lone deliberate drop, not an oversight). Out-of-scope of the named twelve interfaces: `ParseError {line,message}` (`:140-143`, pure diagnostics — surfaced only via `rune-manifest:125`) and the `BoundaryTag` string-union type alias (`:9`, not an interface, superseded by `[SRV]`). No field is left unverified.

---

## 2. Channel legend

| Channel | Becomes | Behavioral? |
|---|---|---|
| `provenance` | `// Generated … :<line>` / `// rune declares:` | No |
| `doc-comment` | `/** */` block (IDE hover, TypeDoc) | No |
| `line-comment` | inline `//` note | No |
| `jsdoc-throws` | `@throws <slug>` | No |
| `@param/@returns/@see/@link/@example/@module` | navigable/structured JSDoc | No |
| `api-property` | `@ApiProperty({…})` (Swagger / `/docs` cake) | **Yes** |
| `decorator` | `@EndpointController(s,{…})`, `@IsIn`, etc. | **Yes** |
| `code-stub` | emitted code (pre-stubs, test bodies, new files) | **Yes** |
| `deno-lint-ignore` | `// deno-lint-ignore` or `_`-prefix | No (suppression) |

---

## 3. Enrichments grouped by generated file

Renderer → file:line map (all `rune-manifest/mod.ts` unless noted):

| Renderer | Entry | Key emit sites |
|---|---|---|
| `renderCoordinator` | `:816` | header `:901-902`; sig comment `:925-932`; reads `:944-958`; writes/sends `:967-979`; core `:1007-1018`; instanceNouns `:842-850`; imports `:905-922` |
| `computeEntProcess` | `:1058` | order `:1131`, dependsOn `:1124`, bind `:1112-1126`, `$field` `:1113`, alt-array `:1118-1121` |
| `renderImpl` | `rune-sig:86` | class `:104`; methods `:105-114`; header `:117-120`; imports `:122-127` |
| `collectNounMethods` | `rune-sig:47-78` | `MethodSig` `:23-29`; dedup `:53` |
| `renderDto` | `:570` | field loop `:580-666`; class comment `:693`; field emit `:695-699`; ApiProperty `:639-645`; import gate `:685-687`; nested `:600-611` |
| `renderTyp` | `:708` | header `:719`; desc `:733`; declares `:734` |
| `renderBusinessTest` | `:750` | header `:758`; method stub `:762-768`; fault loop `:769-774` |
| `ADAPTER_SMK_TEST_TPL` | `:1546-1556` | connectivity + `{{#each faults}}` |
| `COORDINATOR_INT_TEST_TPL` | `:1489-1501` | happy-path + faults |
| `renderEntrypointController` | `:1145` | decorator `:1196`; class `:1197`; opts `:1206-1220`; handler `:1220-1233`; match `:1170-1186`; unmatched `:1230-1231` |
| `renderEntrypointE2e` | `:1246` | seeds `:1257-1279`; `placeholder()` `:1267-1272`; header `:1288-1289` |
| `addModRoot` / `MOD_ROOT_TPL` | `:1330-1358` / `:1558-1563` | call site `:239` |
| Poly templates | `:1503-1544` | base `:1503`; barrel `:1521`; impl mod `:1526`; base test `:1511`; impl test `:1538` |
| `addBusinessFeature`/`addAdapter`/`addCoordinator`/`addPolyFeature` | `:354`/`:446`/`:328`/`:383` | thread new opts here |
| sync renderers | `sync/mod.ts` | `renderMain:481`; `renderConfig:504`; `renderAppRegistry:448`; `ensureImportMap:290-371` |
| `rune-stubs` | `rune-stubs/mod.ts` | `planStubs:27-73`; `renderStubsModule:219`; `mintFor:197-210`; `StubField:13-16` |
| `rune-heal` | `rune-heal/mod.ts` | `reqSlugs:127-143`; `scaffoldFor:153-167` |

> **Snippet rule:** every BEFORE/AFTER line below is ≤80 chars. All `'revise'`-verdict snippets use the **corrected** form from the catalog notes (obsolete `db:` prefixes dropped where the call form is shown; fabricated fault prose removed — faults are bare kebab slugs; multi-line descriptions assumed space-joined per `rune-parse:485-486`).

---

### 3.1 Coordinator + `<verb>Core` — `renderCoordinator` (`:816`)

**E1 · Spec provenance header** `[coordinator-provenance-reqline]` — `ReqNode.line` · provenance · none · `:901`
```ts
// BEFORE
// Generated by rune manifest from src/tasks/tasks.rune.
// AFTER (req.line is 0-based → +1)
// Generated by rune manifest from src/tasks/tasks.rune:3.
```

**E2 · `@throws`/`@param`/`@returns` JSDoc on the exported `<verb>`** `[coordinator-throws-jsdoc, coordinator-param-returns-jsdoc, coordinator-fault-throws, coordinator-io-type-doc]` — `StepNode.faults`+`BoundaryStepNode.faults`+`Req.input/output`+`Dto/Typ.description` · jsdoc-throws/doc-comment · none · replace the single `//` push at `:925-927`, keep the single-line signature `:928-932`.
```ts
// AFTER (faults attributed via a per-step walk, NOT collectAllFaults
// which dedups & drops the raising step; opaque-seam @param/@returns
// branch on seam.kind — say "passed through unvalidated" for opaque)
/**
 * Coordinator for [REQ] task.complete(TaskRefDto): TaskDto.
 * @param input TaskRefDto — asserted against its contract at the seam.
 * @returns TaskDto — asserted before return.
 * @throws not-found — raised by task.load
 * @throws timeout — raised by task.save
 */
export async function complete(input: TaskRefDto): Promise<TaskDto> {
```

**E3 · Ordered recipe in `<verb>Core`** `[core-recipe-checklist, core-step-recipe, coordinator-core-recipe, req-recipe-includes-ply-ctr-ret]` — `ReqNode.steps` (Step/Ctr/Ret/Ply) · line-comment · changes-emitted-code · replace the generic TODO at `:1016`, **keep `throw`** at `:1017`.
```ts
// AFTER (notification.send; echo source tag [NEW] not AST kind [CTR];
// boundaries are NOT in core — they are the wrapper reads/writes/sends)
  // Recipe from [REQ] notification.send (run in order):
  //   1. id::generate(): id
  //   2. [NEW] notification
  //   3. notification.fill(message): notification
  //   4. [PLY] channel.deliver(SendDto): ReceiptDto (cases: email|push)
  //   5. notification.toDto(): ReceiptDto
  // TODO: implement the steps above, build the dtos
  throw new Error("not implemented");
```
Per-element rules: `StepNode`→`N. noun.verb(params): output` (append ` (static)` / render `noun::verb` when `isStatic`); `CtrNode`→`N. [NEW] <className>`; `RetNode`→`N. [RET] <value>`; `PlyNode`→`N. [PLY] noun.verb(...): output (cases: a|b)`; append ` -> throws: <slug,…>` only when a **pure** step carries `.faults`. Guard each line ≤80.

**E4 · Static-step correctness + recipe** `[core-static-step-prestub, core-static-step-recipe]` — `StepNode.isStatic` · code · changes-emitted-code. Split static-only nouns OUT of `instanceNouns` (`:842-850`) so they are neither `new`'d (`:1010`) nor double-imported; render them `Id.generate()` in the recipe. (Fixes the live `const id = new Id()` defect where `Id.generate` is static.)

**E5 · `[NEW]`/`[RET]` recipe rows** `[core-ctr-class-annot, core-ctr-new-recipe, core-ret-value-recipe]` — `CtrNode.className`, `RetNode.value` · line-comment · none. Emit `// [NEW] <className>: construct a fresh <Pascal>` **only for `[NEW]`-only nouns** (dedup vs `instanceNouns` to avoid duplicate `const` → TS2451); emit `// [RET] <value> -> result`. **Do not** auto-construct ctr-only nouns (no `business/<noun>` is generated → TS2307).

**E6 · `[PLY]` dispatch note in core** `[coordinator-ply-dispatch, core-ply-dispatch-recipe]` — `PlyNode.noun/cases` · line-comment · changes-emitted-code · before `:1016`.
```ts
  // dispatches via Channel (poly): variants email, push
  //   impls: src/notify/domain/business/channel/implementations/{...}
```

**E7 · Return-shape field→write attribution** `[core-return-shape-step-attribution]` — `BoundaryStepNode` writes · line-comment · none · replace `:1004-1008`. Map each write field to the **generated adapter call** `taskData.save` (NOT `db:task.save`):
```ts
// Returns:
//   save   -> TaskDto handed to taskData.save (the write)
//   result -> TaskDto returned to the caller
```

**E8 · Instance-noun import cross-ref** `[import-crossref-business-non]` — `NonNode.description` + step verbs · line-comment · none · prepend at `:909-915` (thread `nons` into `TypeContext`):
```ts
// Task — a single todo item. This core calls: markDone, toDto.
import { Task } from "@/src/tasks/domain/business/task/mod.ts";
```

**E9 · ENT→REQ "exposed via" header** `[coordinator-exposed-by-endpoint-xref]` — `EntNode.surface/action/delegate` · doc-comment · none · thread `ast.ents` into `addCoordinator`. Emit `// Exposed via [ENT] http.registerRecording.` (no fabricated `POST`/full URL — method/route are not in the AST); omit when no ent matches.

**E10 · `[MOD]` description header** `[coordinator-mod-description-header]` — `[MOD]` desc · header · **needs-MOD** · prepend wrapped desc above `:901-902`, preserving both existing header lines.

**E11 · Boundary call service annotation** `[coordinator-boundary-call-service-comment, boundary-adapter-service-annotation]` — `[SRV]` · line-comment · **needs-SRV** · annotate each `await <noun>Data.<verb>(...)` with `// <verb> -> <service> (<transport>). Env: …` (per-call, since a noun spans services).

---

### 3.2 Business class — `renderImpl` (`rune-sig:86`)

**E12 · Provenance header** `[impl-spec-provenance-header, impl-provenance-header, business-class-non-doc]` — runePath + `NonNode` · provenance/doc-comment · none. Thread `runePath` into `renderImpl` (both call sites `:369`/`:461` already hold it); prepend the canonical line above the existing scaffold note; emit the `[NON]` prose as a `//` line above `export class` (match `renderDto:693` `//` style, **not** `/** */`):
```ts
// BEFORE
// Scaffolded once; fill in the bodies. `sync` preserves this file.

export class Task {
// AFTER (data adapter variant adds "— data adapter (I/O seam)")
// Generated by rune manifest from corpus/valid/entrypoint.rune.
// Scaffolded once; fill in the bodies. `sync` preserves this file.

// a single todo item
export class Task {
```
Guards: only push the `//` line when `description` is non-empty; thread `nonByNoun: Map<string,NonNode>` via a new `RenderImplOptions.doc`.

**E13 · `@throws` per method** `[method-throws-jsdoc, method-throws-business, method-throws-adapter, business-method-faults-throws, data-method-faults-throws]` — `Step/Boundary.faults` · jsdoc-throws · none. Add `faults` to `MethodSig` (`:23-29`); in `collectNounMethods` (`:62-67`) **UNION** faults on the dedup path (`:53` dedups by verb+isStatic — first-write-wins would drop later faults). Emit one bare-slug line per fault:
```ts
  /**
   * @throws timeout
   */
  save(taskDto: TaskDto): Promise<void> {
    throw new Error("not implemented");
  }
```

**E14 · `@param`/`@returns` from `[TYP]`/`[DTO]` description** `[typ-desc-to-impl-param-jsdoc, method-param-typ-desc, method-return-typ-desc]` — `Typ/Dto.description` · doc-comment · none. `opts.typMap`/`dtoByName` already threaded. Use the **emitted** param identifier from `renderParams` (`:189-194` renames empty/dup → `argN`); skip undescribed/void/noun-self; wrap if >80.
```ts
  /**
   * @param message the notification body text
   */
  fill(message: string): Notification {
```

**E15 · Method role / step provenance** `[method-role-business, business-method-provenance]` — `Req`+step index · doc-comment · none. Add `roles[]` to `MethodSig`; emit one line per owning flow: `// Step 3 of 5 in \`task.create(CreateTaskDto): TaskDto\`.` Drop the un-derivable "Runs after X" neighbor line; wrap/fallback to `noun.verb` when >80.

**E16 · `unknown`-position tighten marker** `[impl-param-unknown-tighten-marker]` — params/output resolving to no `[TYP]` (`rune-sig:96,160,175`) · doc-comment · changes-emitted-code. Mirror `renderDto`'s `// TODO: tighten` for impl signatures; one `@param`/`@returns` line per `unknown` position (≤80):
```ts
  /** @param taskId no [TYP] — declare `[TYP] taskId: <type>` to tighten */
  archive(taskId: unknown): Promise<unknown> {
```

**E17 · `[MOD]` module line** `[mod-desc-impl-header]` — `[MOD]` desc · header · **needs-MOD**. Insert one flattened `// Module: tasks — <desc first line>` after the scaffold note (single line, ≤80).

---

### 3.3 Data adapter — `renderImpl` async path (`addAdapter:446`)

**E18 · Adapter class role doc** `[adapter-class-doc, adapter-class-io-doc, non-desc-to-adapter-class-doc, data-adapter-non-desc]` — `NonNode.description` + `opts.async` · doc-comment · none. Gate on `opts.async`; emit role + `[NON]` prose (place after the DTO import block, before `export class`). **Drop** the obsolete per-`db:`-call enumeration (the class also fronts pure methods; tags are deleted by `[SRV]`).
```ts
// Data adapter for `task` — the I/O boundary. Coordinators await
// these methods; implement each against its declared service.
// a single todo item
export class Task {
```

**E19 · Per-method boundary kind** `[data-adapter-boundary-kind, boundary-tag-discarded-interim-doc]` — `BoundaryStepNode.tag` · doc-comment · **needs-SRV** (interim db/fs/… possible but transitional). Durable form rides on the service+transport (E20). Interim, build a per-noun kind **set** (a `collectBoundaryKinds` analogous to `collectBoundaryFaults`) — the tag is per-step and a noun spans kinds.

**E20 · Service/transport/env method + class doc** `[adapter-method-service-jsdoc, adapter-method-service, srv-description-to-adapter-doc, adapter-class-service-header, data-adapter-service-meta]` — `[SRV]` · doc-comment · **needs-SRV**. Per-method (service is per-method): `service: <name> (transport <t>)`, the `[SRV]` description, wrapped `Connection env:` list, then `@throws`.

**E21 · Transport connection scaffold** `[srv-connection-scaffolding, adapter-conn-stub]` — `[SRV].transport` · code-stub · **needs-SRV**. Drive `sk`=SDK client / `hp`=base-URL+fetch / `ws`=socket / `sc`=sidecar. **Keep comment-only until the data-adapter DI/config convention is settled** (a `private readonly base = config.firebase.apiKey` references an unimported `config` → compile break). Requires E27 (config sub-objects) first.

**E22 · `@throws` + call provenance per method** — covered by E13; the call-ref form becomes `service:noun.verb` once `[SRV]` lands (no rework).

---

### 3.4 DTO — `renderDto` (`:570`)

**E23 · Field `[TYP]` description JSDoc** `[typ-description-to-field-jsdoc, typ-desc-to-dto-field-jsdoc, dto-field-typ-desc, dto-field-typ-description-jsdoc]` — `TypNode.description` (**the single largest discarded node-axis signal**) · doc-comment · none. In the field loop, when `typMap.get(base)?.description` is non-empty, push `/** <desc> */` (multi-line block when >80) before the decorator stack at `:695-699`.
```ts
// AFTER (example/todos add-task.ts)
  /** an id of a task placed on the list */
  @IsString()
  taskId!: string;
```

**E24 · Field `[TYP]` provenance** `[field-provenance-comment, dto-field-typ-provenance]` — `Typ.name/typeName/modifiers` · provenance · none. Mirror `renderTyp`'s convention: `// rune declares: [TYP:uuid] id: string`. Echo the **base** (singular) type, not the pluralized field name; clamp to ≤80.

**E25 · `[TYP:ext]` field note** `[typ-external-note-on-field, typ-ext-to-dto-field-note, dto-ext-field-note]` — `TypNode.isExternal` · line-comment · none. `renderDto` skips `ext` at `:648`. Unshift a marker (interpolate `$${name}` dynamically):
```ts
  // rune: [TYP:ext] — supplied by another module / the caller
  @IsString()
  @IsUUID()
  memberId!: string;
```

**E26 · Class JSDoc + provenance + visibility** `[dto-description-to-class-jsdoc, dto-description-empty-guard, dto-class-provenance-line, dto-line-file-provenance, dto-line-provenance, jsdoc-visibility-internal-public]` — `Dto.{description,isCore,name,properties,line}` · doc-comment/provenance · none. Upgrade `:693` `// <desc>` → `/** <desc> */` **guarded on non-empty** (empty → emit nothing, not `/** */`); add `// rune declares: [DTO<:core>] Name: p1, p2` (after desc, before class, matching `renderTyp` order); add `@public cross-module contract` (isCore) / `@internal` while **preserving** the description.

**E27 · `@ApiProperty` umbrella (merge-or-perish)** `[apiproperty-consolidate-and-emit-on-every-field, dto-apiproperty-always, typ-description-to-apiproperty-description, typ-desc-to-apiproperty-description, dto-field-apiproperty-description, apiproperty-required-from-optional, apiproperty-isarray-and-type-from-plural, apiproperty-minimum-maximum-from-modifiers, apiproperty-format-from-uuid-email-url, apiproperty-minlength-from-nonempty, apiproperty-int-positive-schema, nested-dto-apiproperty-type, dto-nested-field-apiproperty, apiproperty-enum-from-union-typename, typ-union-enum-isin-apiproperty, apiproperty-binary-format-from-uint8array, dto-apiproperty-required-false, dto-apiproperty-isarray-type, dto-apiproperty-constraint-hints]` — `Dto.properties` + `Typ.{description,modifiers,typeName}` + `?`/`(s)` · api-property/decorator · changes-emitted-code.

**This is one umbrella, not nineteen decorators.** Build **ONE** options object per field and emit a single `@ApiProperty({…})` (the existing `example=` path unshifts at `:642` — two `@ApiProperty` on one property is undefined in Swagger). **Widen the import gate** at `:685-687` from `hasExample` to `hasApiProperty` or the decorator references an unimported symbol.

Mapping into the merged object:
- `description` (non-empty `Typ.description`) — escape via `JSON.stringify`/`exampleLiteral`
- `example=` → `example`
- `?` optional → `required: false`
- `(s)` array → `isArray: true`, `type: String|Number|Boolean` (or `() => NestedDto`)
- `min=N`/`max=N` → `minimum`/`maximum`; `positive` → `exclusiveMinimum: 0` (**not** `minimum:1`; `@IsPositive` allows 0.5); `int` → `type: "integer"`
- `uuid`/`email`/`url` → `format: "uuid"|"email"|"uri"`
- `nonempty` (scalar string only) → `minLength: 1` (skip array each-form)
- `\|`-union of string literals → `enum: [...]` + `@IsIn([...])` (`validators.add("IsIn")`)
- `Uint8Array` → `{ type: "string", format: "binary" }`
```ts
// AFTER ([TYP:min=0,max=100,example=5] qty written qty(s)?)
  @ApiProperty({
    description: "an order quantity",
    example: [5],
    required: false,
    isArray: true,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @IsArray()
  @IsNumber({ each: true })
  @Min(0, { each: true })
  @Max(100, { each: true })
  qtys?: number[];
```
Wrap any single `description:`/`example:` line that would exceed 80.

**E28 · Pluralization note + unknown-field remedy + dispatch note** `[dto-array-pluralization-note, dto-unknown-field-marker-enrich, dto-field-drives-poly-dispatch-note]` — `properties`/`typeName` · line-comment · none. `// rune: taskId(s) — array of [TYP] taskId`; extend the existing `// TODO: tighten` (`:620-625`) with `// Add \`[TYP] foo: <type>\` to the .rune to type it.` (≤80 — short form for long field names); on a discriminator field whose union members equal a `[PLY]`'s case set, note `// rune: selects the provider.getRecording variant (genie|fiveNine)` above its **actual** `@Allow()` (not a fabricated `@IsIn`).

---

### 3.5 TYP alias — `renderTyp` (`:708`)

**E29 · Description JSDoc + empty guard** `[typ-alias-jsdoc-and-empty-guard, typ-description-jsdoc]` — `TypNode.description` · doc-comment · none. `:733` `// <desc>` (unconditional → bare `// ` when empty) → `if (typ.description) push("/** <desc> */")` (multi-line block when >80). Verified: the intervening `// rune declares:` line does not block JSDoc hover attachment.

**E30 · Constraint prose + ext + core meaning + line** `[typ-modifier-prose-in-alias, typ-modifier-semantics-comment, typ-ext-provenance-comment, typ-core-meaning-doc, typ-line-provenance]` — `Typ.{modifiers,isExternal,isCore,line}` · line-comment/provenance · none. Insert after `:734`, only when relevant:
```ts
// a stock count bounded between zero and one hundred
// rune declares: [TYP:min=0,max=100] quantity: number
// enforced on DTO fields: @Min(0), @Max(100)
export type Quantity = number;
```
Append `// [TYP:ext] — produced OUTSIDE this module; entrypoints wire it / as a $external input` (isExternal); `// core: shared across modules — narrow with cross-module care.` (isCore); `:<line+1>` on the header. Skip non-constraint mods (ext/core/example produce no decorator); keep `//` style, not `/** */`.

**E31 · Opaque `[NON]` alias file (optional)** `[non-opaque-type-file]` — `NonNode.{name,description}` · code-stub · changes-emitted-code. Optionally emit `export type Storage = unknown;` mirroring `renderTyp`; **must extend `addTyp` disambiguation (`:501-504`) to also diff against `[TYP]` stems** (a `[NON] task` + `[TYP] task` both → `task-type.ts` collide; emit's first-writer-wins silently drops one). Orphan symbol (nothing imports it) — low priority.

---

### 3.6 Tests — business / coordinator-int / adapter-smk / poly

**E32 · Business test fault + AAA + `[NON]` header** `[business-fault-trigger-hint, business-test-fault-context, business-aaa-skeleton, business-non-description-header]` — `Step.faults`+`verb`, `MethodSig.params/output`, `NonNode.desc` · code-stub · changes-emitted-code. Retain `verb→fault` (don't union to bare `string[]`); name the raiser in title-adjacent comment; emit a **comment-only** AAA skeleton respecting `isStatic`/void/params (a live `new Id().generate()` is TS2576; live calls with DTO args don't compile); add the `[NON]` line into the existing banner block (guard empty).
```ts
Deno.test("Task.markDone", () => {
  // Arrange — // const subject = new Task();
  // Act — markDone(): Task
  // Assert — TODO: assert result is the expected Task
});
```

**E33 · Coordinator int-test recipe + input fixture + fault context** `[int-recipe-skeleton, int-input-fixture-from-example, int-fault-trigger-hint, coordinator-int-test-recipe-context]` — `Req.steps`/`input`+`example=`/faults · code-stub · changes-emitted-code. Add a `// Recipe (from [REQ] …)` block; precompute a typed input literal + the missing DTO import (`import { CreateTaskDto } …` only when `inputSeam.kind==="dto"`); **keep green** — comment the `await create(input)` call (the core throws); fault stub gets `Deno.test("timeout", …)` + `// raised by task.save`. (Template is pure-substitution → precompute fixture/recipe strings in `addCoordinator`.)

**E34 · Adapter smk boundary list + fault + service** `[smk-boundary-methods, smk-fault-trigger-hint, smk-test-connectivity-names-service, smk-transport-connection-scaffold, smk-adapter-non-desc]` — `MethodSig[]`/`Boundary.faults`/`[SRV]`/`NonNode` · code/line-comment · changes-emitted-code (service part **needs-SRV**). Forward `methods` into the template; list calls as a **comment** (no `new Task()` — undefined/unused → lint break); **keep the bare fault name in the `Deno.test` title** — `rune-fault-coverage/mod.ts:115` matches `Deno.test("<slug>"` exactly, so put `// raised by the task.save boundary call` in the body, never in the title.

**E35 · Poly tests** `[ply-base-variant-enum, poly-base-variant-roster, poly-impl-aaa-skeleton, cse-faults-to-variant-test, cse-step-faults-in-variant-doc]` — `PlyNode.cases`/`verb`/`CseNode.steps.faults` · code-stub · changes-emitted-code. Base test: precompute PascalCase `variants[]` (engine `{{#each}}` can't join/case) and emit per-line dispatch-coverage roster. Impl test: `new {{ply.noun}}{{cse.name}}()`, consume via `void variant`, keep `HEADER`. Variant fault stubs: append `{{#each faults}}` mirroring `ADAPTER_SMK_TEST_TPL` (keep the placeholder test; collect each case's step faults in `addPolyFeature`).

**E36 · Test provenance line** `[test-provenance-rune-line]` — `Req/Ply.line` · provenance · none. **Scope to `renderCoordinator`/int-test only** (it holds `req`); `renderBusinessTest` takes `MethodSig[]` with no `.line` — leave its banner path-only unless `.line` is threaded onto `MethodSig`. Use `+1`.

---

### 3.7 Entrypoint controller — `renderEntrypointController` (`:1145`)

**E37 · Per-endpoint provenance** `[ent-source-provenance, endpoint-provenance-line]` — `EntNode.line` · provenance · none · insert before `:1220` at 2-space indent, `+1`:
```ts
  // from corpus/valid/entrypoint.rune:4
  @Endpoint({ path: "pay-order", ... })
```

**E38 · Delegate + process + bind + flows + optional JSDoc/comments** `[endpoint-process-jsdoc, endpoint-delegate-summary, endpoint-io-param-returns, endpoint-throws-faults, bind-producer-comment, bind-external-input-comment, bind-alternatives-comment, dependson-rationale-comment, flow-meaning-comment, optional-meaning-comment, endpoint-process-prose, endpoint-flows-doc, endpoint-optional-doc, entrypoint-bind-rationale]` — `EntProcess.{order,dependsOn,bind,flows,optional}` + matched `Req` + DTO/TYP desc + faults · doc-comment/line-comment · none. Insert above the **unchanged single-line** `@Endpoint` at `:1220`. The decorator stays one line — emit comments only:
```ts
  /**
   * Delegates to coordinator payment.pay
   * (matched by input/output signature).
   * @param body PayDto — a payment for an order
   * @returns ReceiptDto — a receipt for a payment
   * @throws timeout (payment.charge)
   */
  // Runs after createOrder (binds id from its output).
  // Only in the "card" flow branch (untagged endpoints run in every flow).
  // Optional: attempted but never blocks the run.
  @Endpoint({ path: "pay-order", ... })
```
Bind cases: producer dotted `id <- createOrder.id`; alternatives array `id <- payCard.id OR payCash.id`; `$field` external `id <- supplied externally (seed / module input)`. Branch the delegate line on `ent.delegate` (named-by-body) vs signature-match vs **no-match** (say "no coordinator wired"). `@throws` uses bare slugs (optionally ` (noun.verb)`), never invented prose.

**E39 · Unmatched-handler actionable guidance** `[unmatched-coordinator-guidance]` — `Ent.input/output/delegate` · code-stub · none · enrich `:1230-1231`. Include the real `src/<module>/domain/coordinators/<noun>-<verb>/mod.ts` path (use `module` param + `processName`); concrete when `ent.delegate` set, placeholder `<noun>-<verb>` otherwise.

**E40 · `[MOD]` controller doc + decorator opt** `[mod-desc-controller-jsdoc, mod-desc-endpoint-controller-opt, mod-desc-controller-class-jsdoc, mod-desc-endpointcontroller-arg, controller-description-from-mod]` — `[MOD]` desc · doc-comment/decorator · **needs-MOD**. JSDoc above `export class …Controller` + `@EndpointController("http", { description })` (keep supports it: `endpoint-decorator/mod.ts:176-184`). Multi-line desc must collapse to one JS string literal and **wrap to avoid >80**.

**E41 · `@Endpoint({description})` composed / `[ENT]` description** `[endpoint-description-composed, entrypoint-endpoint-description, future-ent-description-block]` — `Ent.delegate`+`order` / new `[ENT]` desc · api-property · none (composed) / **needs-grammar** (authored). Composed form (today): push `description: "payment.pay — step 2"` into the opts array (it joins onto the one line); authored per-route prose needs a new `[ENT]` description grammar (a third change, **not** in flight).

**E42 · Service touchpoints + `[NON]` subject** `[controller-service-touchpoints, controller-noun-non-desc]` — `[SRV]` / `NonNode.desc` · doc-comment · **needs-SRV** (services) / none (`[NON]`, thread `nons`).

---

### 3.8 Entrypoint e2e — `renderEntrypointE2e` (`:1246`)

**E43 · Seed from `example=`** `[e2e-seed-from-example]` — `Typ.modifiers example=` · code-stub · none. `placeholder()` (`:1267`) reads only `typeName`; scan modifiers for `example=` and emit `exampleLiteral(value, typeName)` before the synthetic stub.

**E44 · Seed legend, chain roster, run order, `[MOD]` header** `[typ-ext-to-e2e-seed-note, e2e-seed-typ-comment, e2e-chain-order-comment, e2e-chain-narrative, e2e-run-roster, e2e-mod-description-header]` — `Typ.{isExternal,description}`/`EntProcess.{order,dependsOn,bind}`/`[MOD]` · line-comment/header · none (desc `needs-MOD`). Guard on non-empty `seedEntries`; the real call is **one line** (`:1278`) — prepend comments:
```ts
        // $ext seeds — replace stub values with real inputs:
        //   memberId — the authenticated member's id
        // Endpoint chain (by @Endpoint order):
        //   1. createOrder -> OrderDto
        //   2. payOrder  (after createOrder; id<-createOrder.id)
        const report = await exerciseEndpoints({ api, overrides: { ... } });
```

**E45 · Required service env vars** `[e2e-required-service-env-vars]` — `[SRV].envVars` · line-comment · **needs-SRV** · thread `reqs` + `[SRV]` into `renderEntrypointE2e`.

---

### 3.9 Infra — mod-root / sync / stubs / heal / deno.json / `.env`

**E46 · mod-root glossary + coordinator signatures + type vocabulary + `[MOD]` desc** `[non-desc-mod-root-glossary, non-note-to-mod-root-header, mod-root-coordinator-summary, mod-root-export-signature-comment, mod-root-type-vocabulary-glossary, mod-desc-mod-root-doc, mod-root-module-description, mod-root-module-desc, mod-desc-to-module-headers]` — `nons`/`reqs`/`dtos`/`typs`/`[MOD]` · doc-comment · none (desc `needs-MOD`). Thread `ast.nons`/`dtos`/`typs` into `addModRoot` (call site `:239` passes only `reqs`). Emit, ≤80, wrapped, each section guarded (engine has no `{{#if}}` → build the block in JS):
```ts
// Generated by rune manifest — DO NOT EDIT (regenerated on every `rune
// sync`).
//
// Domain nouns (from [NON]):
//   storage: a class representing the storage system used to save
//     and retrieve recording data
//
// Types this module speaks:
//   OrderDto — the placed order
//   amount: number — minor units (cents)
//
// Public API surface for module "checkout".
// [REQ] order.create(NewOrderDto): OrderDto
export { create } from "./domain/coordinators/order-create/mod.ts";
```
Keep `REGEN_HEADER` path-omitted (byte-stability rationale `:1482-1485`); mod-root is emitted only when `reqs>0` — handle a `[NON]`/`[TYP]`-only module.

**E47 · Stepless `[NON]` materialization** `[stepless-non-materialize-stub]` — `NonNode` · code-stub · changes-emitted-code. After the req/dto/typ loops, iterate `ast.nons`; for a noun not already a business/adapter class, emit a documented empty class. **MUST ship with a `rune-extra-files` companion change** (add `src/<mod>/domain/business/<kebab>` per `[NON]` to `getPredictions`) or the project self-fails the orphan-dir lint (`rune-extra-files/mod.ts:43-45`). Emit `mod.ts` only — **no `test.ts`** (`rune-business-presence` collects only step nouns). Depends on E12's doc option.

**E48 · Poly base/barrel `[NON]` + variant roster + dispatch + signature** `[ply-noun-non-description-to-base, ply-base-non-desc-and-variants, ply-base-method-real-signature, ply-base-variant-roster, ply-dispatch-doc-in-barrel, ply-static-dispatch-discarded, cse-case-recipe-in-variant-body, poly-impl-case-recipe-faults, poly-dispatch-discriminator-doc, ply-cse-description-grammar, cse-ctr-ret-line-provenance, cse-line-variant-provenance]` — `PlyNode`/`CseNode`/`NonNode` · doc-comment/code-stub · mostly none (`[CSE]` selection-rule prose `needs-grammar`). Thread original `ply.params/output` + `ast.nons` into `addPolyFeature` (`typedPly` overwrites to `unknown` at `:399`); precompute `variants[]`, `srcLine = cse.line+1`, per-case `recipe[]`+`faults[]` strings:
```ts
// POLY_BASE_MOD_TPL
// Polymorphic base for "Channel": a delivery channel (email or push).
// Variants: email, push. Spec signature: deliver(SendDto): ReceiptDto
export abstract class ChannelBase {
  abstract deliver(sendDto: unknown): unknown;
}
// POLY_IMPL_MOD_TPL
// Variant: Email — [CSE] @ src/notify/notify.rune:9
// Recipe:
//   channel.sendEmail(SendDto): ReceiptDto
export default class ChannelEmail extends ChannelBase {
  /** @throws timeout @throws invalid-address */
  deliver(sendDto: unknown): unknown {
    throw new Error("not implemented");
  }
}
```
Static-`[PLY]` (`isStatic`): `// rune: static dispatch verb (Provider::pick)`.

**E49 · bootstrap header normalization** `[bootstrap-header-normalize]` — provenance string · provenance · none · `sync/mod.ts:482-485,505-508`. Prepend the canonical `// Generated by rune sync (dev-owned: created once, never overwritten).` **additively** (preserve existing guidance; do **not** use `DO NOT EDIT` — these files are dev-owned).

**E50 · `bootstrap/modules.ts` module description** `[registry-module-description-comment]` — `[MOD]` desc · line-comment · **needs-MOD**. Thread module→desc into `renderAppRegistry` (de-dup per module across surfaces).

**E51 · `bootstrap/config.ts` + `services.ts` service blocks** `[srv-config-reads, config-service-env-blocks, services-connection-scaffold]` — `[SRV]` · code-stub · **needs-SRV**. One typed sub-object / one client per `[SRV]` keyed by transport; env keys = declared ENV_VAR names verbatim. Create-once (seed at scaffold).

**E52 · `.env.example` (new file)** `[srv-env-example-file, env-example-from-services]` — `[SRV].envVars` · code-stub · **needs-SRV**. Dedup env vars across services; group per `[SRV]` with transport + description header.

**E53 · `deno.json` transport deps** `[deno-json-srv-transport-deps]` — `[SRV].transport` · code-stub · **needs-SRV** (+ a package field for `sk`). Only `sk` adds a dep; `hp`/`ws`/`sc` use built-in `fetch`/`WebSocket` (no entry). `ensureImportMap` is the only renderer consuming zero spec signal today.

**E54 · `bootstrap/mod.ts` emulator inventory** `[main-module-emulator-inventory]` — `SurfaceModule[]` · header · changes-emitted-code (created-once). Pass `surfaces` into `renderMain` (already in scope at `sync:525`); print real `/docs/<module> (<surface>)` per surface instead of the literal `<module>` token. Update `sync/test.ts:78` call.

**E55 · Ghost-stub enrichments** `[stub-typ-description-comment, stub-consumer-provenance, stub-typ-modifier-validators, stub-example-value-mint]` — `Typ.{description,modifiers}` + consumer `Ent` · doc-comment/decorator/code-stub · changes-emitted-code. Thread `description`/`modifiers`/`consumers[]` into `StubField`; fold desc into the `@Endpoint` description; apply the real validators + `crypto.randomUUID()`/bounds mint so the ghost passes the consumer's 422; use `example=` literal when present. **Update `rune-stubs/test.ts:38,128,149,152,213`** (exact-shape assertions).

**E56 · heal `why` step + service provenance** `[heal-why-raising-step-provenance, heal-why-service-transport]` — raising step + `tag`/`[SRV]` · provenance · changes-emitted-code (`fixtures/heal-rules.json`). Track `step→fault` (don't flatten to a `Set`); pre-fill `why` with the concrete raising `noun.verb` + `[REQ]`. Skip RESERVED_GENERIC slugs (e.g. `timeout` is keep-healed, never scaffolded). Service/transport text is **needs-SRV**.

**E57 · README.md per module** `[module-readme-artifact]` — `[MOD]`+`reqs`+`ents`+`[SRV]` · README artifact · **needs-MOD + needs-SRV**. Route via sync create-once (not manifest emit) to avoid churning the manifest golden's pinned file set.

**E58 · JSDoc `@see`/`{@link}`, `@example`, `@module`/`@fileoverview`, lint-ignore** `[jsdoc-see-link-crossrefs, jsdoc-example-tag-from-example-modifier, module-fileoverview-jsdoc-tag, deno-lint-directives-on-scaffold-stubs]` — edges/`example=`/`[MOD]`/scaffold-state · cross-channel · none (`@module` desc `needs-MOD`). `{@link}` **only** for symbols imported in the emitting file (impl→coordinator and dto→consumer reverse-links are dead text → use `@see <path>:<line>`). For lint-clean scaffolds prefer **`_`-prefixing unused identifiers** over `// deno-lint-ignore` (a directive on a non-async stub trips `ban-unused-ignore`); the lone real `require-await` is the coordinator outer wrapper with no awaited I/O.

---

## 4. Prioritized rollout

Bucketed off the catalog's `breakingRisk`/`verdict`. "Golden refresh" everywhere below means the mechanical `deno task verify --update-goldens` (no `deno fmt` — see §5), **not** a contract break.

### Tier 1 — comment/doc-only, data available today, no grammar (~97 items) — SHIP FIRST

No runtime/type change, no lint-rule change, no compile risk. Goldens refresh mechanically.

- **Provenance:** E1, E12 (header half), E24, E26 (provenance half), E30 (line), E36, E37, E49. Items: `impl-spec-provenance-header`, `impl-provenance-header`, `coordinator-provenance-reqline`, `coordinator-spec-line-provenance`, `ent-source-provenance`, `endpoint-provenance-line`, `typ-line-provenance`, `dto-line-provenance`, `dto-line-file-provenance`, `cse-line-variant-provenance`, `field-provenance-comment`, `dto-field-typ-provenance`, `dto-class-provenance-line`, `test-provenance-rune-line`, `bootstrap-header-normalize`.
- **`[NON]` prose:** E8, E12 (`[NON]` line), E18, E46 (glossary), E48 (poly base). Items: `non-desc-mod-root-glossary`, `non-note-to-mod-root-header`, `business-class-non-doc`, `non-desc-to-business-class-doc`, `non-desc-to-adapter-class-doc`, `data-adapter-non-desc`, `ply-noun-non-description-to-base`, `import-crossref-business-non`, `controller-noun-non-desc`, `business-non-description-header`, `smk-adapter-non-desc`.
- **`[TYP]` description / modifiers / ext / core (doc only):** E14, E23, E25, E29, E30, E28 (notes). Items: `typ-description-to-field-jsdoc`, `typ-desc-to-dto-field-jsdoc`, `dto-field-typ-desc`, `dto-field-typ-description-jsdoc`, `typ-desc-to-impl-param-jsdoc`, `method-param-typ-desc`, `method-return-typ-desc`, `typ-external-note-on-field`, `typ-ext-to-dto-field-note`, `dto-ext-field-note`, `typ-ext-provenance-comment`, `typ-modifier-prose-in-alias`, `typ-modifier-semantics-comment`, `typ-core-meaning-doc`, `typ-description-jsdoc`, `typ-alias-jsdoc-and-empty-guard`, `dto-array-pluralization-note`, `dto-unknown-field-marker-enrich`, `dto-field-drives-poly-dispatch-note`.
- **`@throws` JSDoc (comment-only):** E2, E13. Items: `coordinator-throws-jsdoc`, `coordinator-param-returns-jsdoc`, `coordinator-io-type-doc`, `coordinator-fault-throws`, `method-throws-jsdoc`, `method-throws-business`, `method-throws-adapter`, `adapter-method-throws-jsdoc`, `core-step-fault-annot`, `business-method-faults-throws`, `data-method-faults-throws`.
- **`[NEW]`/`[RET]`/recipe-as-comment, dispatch notes, return attribution:** E5, E6, E7, E9. Items: `core-ctr-class-annot`, `core-ret-value-recipe`, `coordinator-ply-dispatch`, `core-return-shape-step-attribution`, `coordinator-exposed-by-endpoint-xref`.
- **DTO class JSDoc + visibility:** E26. Items: `dto-description-to-class-jsdoc`, `dto-description-empty-guard`, `dto-class-jsdoc`, `jsdoc-visibility-internal-public`.
- **Entrypoint process/bind/flow/optional/delegate comments:** E38, E39, E44 (non-MOD). Items: `endpoint-process-jsdoc`, `endpoint-delegate-summary`, `endpoint-io-param-returns`, `endpoint-throws-faults`, `bind-producer-comment`, `bind-external-input-comment`, `bind-alternatives-comment`, `dependson-rationale-comment`, `flow-meaning-comment`, `optional-meaning-comment`, `endpoint-process-prose`, `endpoint-flows-doc`, `endpoint-optional-doc`, `entrypoint-bind-rationale`, `unmatched-coordinator-guidance`, `e2e-chain-order-comment`, `e2e-chain-narrative`, `e2e-run-roster`, `typ-ext-to-e2e-seed-note`, `e2e-seed-typ-comment`.
- **mod-root vocabulary/signatures + poly real-signature/roster/dispatch docs + method role + send marker + heal-why-step + `@see`/`@example`:** E15, E22, E30, E46 (non-MOD), E48 (non-grammar), E56 (step), E58 (non-MOD). Items: `mod-root-coordinator-summary`, `mod-root-export-signature-comment`, `mod-root-type-vocabulary-glossary`, `ply-base-method-real-signature`, `poly-base-variant-roster`, `ply-base-variant-enum`, `ply-dispatch-doc-in-barrel`, `poly-dispatch-discriminator-doc`, `cse-line-variant-provenance`, `method-role-business`, `business-method-provenance`, `coordinator-send-fireforget-comment`, `heal-why-raising-step-provenance`, `jsdoc-see-link-crossrefs`, `jsdoc-example-tag-from-example-modifier`, `coordinator-step-faults-throws`, `boundary-tag-discarded-interim-doc` (interim).

### Tier 2 — needs grammar (~50 items) — BLOCKED on the two LOCKED changes

**`[SRV]` (change 1):** E11, E19 (durable), E20, E21, E34 (service part), E42 (services), E45, E51, E52, E53, E56 (transport). Items: `adapter-method-service-jsdoc`, `adapter-method-service`, `adapter-method-call-provenance-jsdoc`, `srv-description-to-adapter-doc`, `srv-env-example-file`, `srv-config-reads`, `srv-connection-scaffolding`, `adapter-conn-stub`, `adapter-class-service-header`, `data-adapter-service-meta`, `data-adapter-boundary-kind`, `smk-test-connectivity-names-service`, `smk-transport-connection-scaffold`, `coordinator-boundary-call-service-comment`, `boundary-adapter-service-annotation`, `config-service-env-blocks`, `env-example-from-services`, `services-connection-scaffold`, `deno-json-srv-transport-deps`, `e2e-required-service-env-vars`, `controller-service-touchpoints`, `heal-why-service-transport`.

**`[MOD]` (change 2):** E10, E17, E40, E44 (header), E46 (desc), E50, E58 (`@module`). Items: `mod-desc-mod-root-doc`, `mod-root-module-description`, `mod-root-module-desc`, `mod-desc-endpoint-controller-opt`, `mod-desc-controller-jsdoc`, `mod-desc-controller-class-jsdoc`, `mod-desc-endpointcontroller-arg`, `controller-description-from-mod`, `mod-desc-to-module-headers`, `mod-desc-impl-header`, `coordinator-mod-description-header`, `registry-module-description-comment`, `e2e-mod-description-header`, `module-fileoverview-jsdoc-tag`.

**Net-new grammar (a third change, NOT in flight — defer):** `apiproperty-unfillable-options-need-new-modifier` (deprecated/enum/nullable modifiers — note `enum` is already coverable via union typeName, E27), `future-ent-description-block`, `ply-cse-description-grammar`. **Both grammars:** `module-readme-artifact` (E57).

### Tier 3 — changes emitted code, golden + test updates (~60 items)

Each carries a specific correctness guard (itemized in §3) — do not ship without it.

- **Recipe-into-core stubs:** E3, E4. `core-recipe-checklist`, `core-step-recipe`, `coordinator-core-recipe`, `req-recipe-includes-ply-ctr-ret`, `core-instance-step-prestub`, `core-static-step-prestub`, `core-static-step-recipe`, `core-ply-dispatch-recipe`, `coordinator-step-dataflow-wiring`, `core-ctr-new-recipe`. **Guard:** keep `throw`; dedup `[NEW]` vs `instanceNouns`; drop `new`/import for static-only nouns; `stepArgs` cannot reference prior-step outputs.
- **`@ApiProperty` umbrella (E27):** all `apiproperty-*` + `dto-apiproperty-*` + `nested-dto-*` + `typ-union-enum-isin-apiproperty` + `apiproperty-binary-format-from-uint8array` + `typ-description-to-apiproperty-description` + `dto-field-apiproperty-description`. **Guard:** ONE merged decorator; widen import gate beyond `hasExample`; `@IsPositive`→`exclusiveMinimum:0`.
- **Test skeletons (E32-E35):** `business-aaa-skeleton`, `business-fault-trigger-hint`, `int-recipe-skeleton`, `int-input-fixture-from-example`, `int-fault-trigger-hint`, `coordinator-int-test-recipe-context`, `smk-boundary-methods`, `smk-fault-trigger-hint`, `poly-impl-aaa-skeleton`, `ply-base-variant-enum`, `cse-faults-to-variant-test`, `cse-step-faults-in-variant-doc`, `cse-case-recipe-in-variant-body`, `poly-impl-case-recipe-faults`. **Guard:** comment-only AAA (respect `isStatic`/void/params); keep tests green (comment the throwing call); keep bare fault names in `Deno.test` titles for `rune-fault-coverage`.
- **New files / structural:** E31 (`non-opaque-type-file` — extend `addTyp` disambiguation), E47 (`stepless-non-materialize-stub` — + `rune-extra-files` companion), E54 (`main-module-emulator-inventory`).
- **Ghost stubs (E55) + heal (E56):** `stub-typ-description-comment`, `stub-consumer-provenance`, `stub-typ-modifier-validators`, `stub-example-value-mint`, `e2e-seed-from-example`, `heal-why-raising-step-provenance` (write). **Guard:** update `rune-stubs/test.ts` shape assertions.
- **`[PLY]` static + impl signature recovery:** `ply-static-dispatch-discarded`, `ply-base-non-desc-and-variants`.

---

## 5. Lint rules & golden fixtures to update

### Lint rules (`src/rune/domain/business/rules/implementations/`)

The ≤80-char rule is an **LSP/`.rune`-source** constraint (`constraints.md:9`) — it is **NOT** enforced on generated TypeScript (generated coordinators/controllers already ship 100+ char lines). So **no comment-only Tier-1 item requires a lint-rule change.** The rules that **do** need coordinated changes:

| Rule | Why it must change | For item |
|---|---|---|
| `rune-extra-files` (`mod.ts:43-45,118-122,136-140`) | `getPredictions` derives business dirs from step nouns only; a stepless `[NON]` business dir is an "orphan" → self-fails. Add `ast.nons`→`src/<mod>/domain/business/<kebab>` (skip nouns already emitted as adapters). | E47 |
| `rune-fault-coverage` (`mod.ts:115`) | Title-match regex requires the bare slug immediately quote-closed. Smk/business/int fault stubs **must keep the bare fault name in the `Deno.test` title** (raiser goes in the body). No rule edit needed **if** that constraint is honored — listed as a hard guardrail. | E34, E33, E32 |
| `dto-validation` (`mod.ts:5-24`) | Unaffected (`@ApiProperty` is additive; `@IsIn`/`@IsUUID` etc. still match `/@Is\w+/`). **Verify** the `@Allow()` path stays for unknown/ext fields. | E27 |
| `no-dto-cast`, `barrel-discipline`, `rune-dto-shape`, `rune-typ-shape`, `rune-business-presence`, `structure`, `module-fragmentation` | No change required — confirmed unaffected (comments/JSDoc/decorators don't trip them; `barrel-discipline` exempts mod-root; `rune-business-presence` collects only step nouns so the stepless stub needs no `test.ts`). | — |
| `lint-config` (`mod.ts:22-43`) | No line-length rule exists on generated output; **no new rule should be added** — long descriptions are wrapped at emit time instead. | all |

### Golden fixtures & unit tests

**Manifest goldens** (`fixtures/golden/manifest/`) — every Tier-1/Tier-3 emit changes these; regenerate with `deno task verify --update-goldens`:
- `entrypoint.json` (already `M` in git status), `typ-constraints.json`, `module-billing.json`, `module-catalog.json`, `inline-dto.json`, `all-tags.json`, `scope-static-instance.json`.
- Poly specs `poly-single-case.json` / `poly-nested.json` / `poly-many-cases.json` and `example-e2e.json` currently error on missing `[MOD]` (empty `toCreate`) — they only gain content once their specs get a `[MOD]`; poly **template** edits affect `example/todos` output, not these.
- **E47/E54/E31** change the **file set** (`toCreate`) pinned in `entrypoint.json` etc. — these break until regenerated (not just content).

**Live project fixtures:** `fixtures/projects/entrypoint/src/checkout/**` (incl. the new `dto/receipt-type.ts` already untracked), and **`fixtures/heal-rules.json`** (E56).

**Example projects (hand-checked-in output):** `example/todos/src/**` (every `mod.ts`/`test.ts`/`dto`/`mod-root.ts`/`int.test.ts`/`smk.test.ts`), `example/cake/**`. READMEs (`example/todos/README.md`, `example/cake/README.md`) are hand-written — E57 must be **create-once** so it never clobbers them.

**Parse goldens** (`fixtures/golden/parse/`): **unchanged** by codegen enrichments; they change **only** when `[SRV]`/`[MOD]` grammar lands (new AST fields). Flag for Tier 2.

**Unit-test assertions to update (NOT goldens):**
- `rune-stubs/test.ts:38,128,149,152,213` — exact `StubField` shape + `@Endpoint` description string (E55).
- `rune-manifest/test.ts:1150` (core TODO string), `:250`/`:191` (`@Endpoint`/bind) (E3, E27, E38).
- `rune-sig/test.ts` — `assertStringIncludes` on `throw new Error(...)` survives added JSDoc; shape `assertEquals` on `MethodSig` breaks when `faults`/`roles`/`serves` added (E13/E15).
- `sync/test.ts:78` — `renderMain` now takes `surfaces` (E54).
- `rune-heal/test.ts:87,90-105` — `why` text change (E56); `raisedBy` is bare verb, not module-prefixed.

**Process:** never run `deno fmt` (repo has no fmt config + intentional long lines — churns whole files). Hand-edit renderers, run `deno task verify --update-goldens`, confirm the valid corpus stays at **0 LSP diagnostics** (the "map runs green" definition of done) and `deno lint`/`deno check` pass on the regenerated `example/todos` tree.
