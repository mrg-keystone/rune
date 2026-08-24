## Rule families

### Definitions

Predicates and conventions reused across both rule families — each rule
below states only how it applies them.

**Non-test source file.** A `.ts`/`.tsx`/`.js`/`.jsx` file
(`data-class-returns` narrows this to `.ts`/`.tsx`) whose path contains no
`.test.` or `.spec.` marker.

> **Exception — `module-fragmentation`.** It does not use the predicate
> above. It excludes any basename containing the substring `test.` — which
> catches the canonical bare `test.ts` (and, incidentally, any name
> containing it, like `latest.ts`) but not `.spec.` files, which it counts
> as source — and counts that same set everywhere it counts files: its
> small-files signal, its coupling tally, and its fewer-than-2-files skip.

**`isProjectSpec` gate** (`src/rune/domain/business/rune-bindings/mod.ts`).
Recognizes a `.rune` entry as a project spec only by its root-relative
path — whether the entry reached the check via the walk or via the
rune-derived family's auto-discovery scan (see Reach below): `<name>.rune`
directly under a staging dir —
`spec/runes/`, `specs/runes/`, or the legacy flat `spec/`/`specs/` (files
nested deeper, like `spec/misc/` and `spec/ui/`, fall through). This is the
spec's one durable home: `rune sync` reads it in place and never relocates
it ([04-codegen.md § Pipeline, step 4](../04-codegen/01-pipeline.md);
[03-cli.md § `rune sync` semantics, step 5](../03-cli/02-rune-sync-semantics-that-matter.md)),
so there is no second recognized location under `src/<module>/`. Any other
`.rune` file is ignored, and a `.in-prog.rune` draft always fails the gate.

**`src/bootstrap/` prefix.** Several rules key on a root-relative path
starting with the literal prefix `src/bootstrap/` — a prefix the composed
layout's top-level `bootstrap/` (a sibling of `src/`, not a child of it)
never matches, so this prefix is dead in the canonical composed layout and
live only in flatter/legacy layouts.

**Create-once test file → owning presence rule.** Each generated test file
is scaffolded once by the presence rule that also owns its `mod.ts` slot:

| Test file | Owning presence rule |
| --- | --- |
| `test.ts` (business noun) | `rune-business-presence` |
| `smk.test.ts` | `rune-adapter-presence` |
| `int.test.ts` | `rune-coordinator-presence` |
| `e2e.test.ts` | `rune-entrypoint-presence` |

A `[PLY]` noun is the one exception: `rune-business-presence` stops at its
feature folder's existence, and its internal `base/test.ts` and
`implementations/<case>/test.ts` files belong to `rune-poly-cases` instead
(see below).

**LSP dependency.** Every rule below is tagged with exactly one of:

- **static-only** — no LSP query; behavior is identical with or without it.
- **LSP-enhanced (degrades to static)** — the LSP sharpens the finding;
  under `SHAPE_NO_LSP=1`, or with the `rune-lsp` binary missing or failing
  to initialize, the rule still runs and reports its static-only findings.
- **LSP-only (silent without LSP)** — the whole rule goes quiet under
  `SHAPE_NO_LSP=1` or a missing/failed LSP.

(See [00-overview.md § Determinism and goldens](00-overview.md) for how the
session is spawned and gated.)

### Generic architecture rules

**`structure`**

- **Flags:** file/folder placement violating the canonical layout tree.
- **Detection (static-only):** checked against `keywords.json →
  canonicalPaths` — top-level slots `bootstrap/`, `src/`, `spec/`,
  `specs/`, `fixtures/`, `assets/`, `dist/`, `app/`; the full recursive
  tree (with its `$ignore` opt-outs) lives in that key and is not
  duplicated here. The ban lists are `$`-keys of the same object:
  `$forbiddenDirNames` (dir names: `lib`, `modules`, `internal`),
  `$looseFileNames` (vague name words `utils`, `helpers`, `common`,
  `shared`, `util`, `helper`, matched as whole-word tokens, so
  `utilization` passes), `$rootFiles` (the only files allowed at the top
  level of the lint root: `deno`, `deno.lock`, `README`, `.gitignore`,
  `TODOS`, `serve`, `serve-dev` — matched by name with the last extension
  stripped or verbatim, so `deno.json`/`README.md` pass) — plus, beyond
  those `$`-keys, `core` is forbidden anywhere except `src/core`.
- **Exempts/skips:** none beyond the ban-list carve-outs above.
- **Boundary-owner:** `keywords.json → canonicalPaths` is the single
  source of the layout tree and every ban list; this rule only enforces
  it.
- **Fix:** "Wrong extension"/"Missing required file" findings get a
  message-derived suggestion naming the expected extension/filename;
  "not allowed" placement findings can additionally get a best-effort LLM
  suggestion — see [00-overview.md § Suggestions](00-overview.md).

**`layer-restrictions`**

- **Flags:** an import that crosses a layer boundary the adjacency table
  below forbids.
- **Detection (LSP-enhanced — degrades to static):** each layer's complete
  allowed-import set — business → {business, dto}; data → {data, dto};
  coordinators → {coordinators, business, data, dto}; entrypoints →
  {entrypoints, coordinators, business, data, dto} (so entrypoints may
  import business and data directly, not only via coordinators); dto →
  {dto}; bootstrap → everything. The static check maps each `src/` import
  specifier to its layer; on files it already flagged, an LSP pass
  additionally traces every import's exported symbols to their defining
  files, catching violations hidden behind barrel re-exports.
- **Exempts/skips:** a file whose only violations hide behind barrels has
  no static finding and is never traced, so under `SHAPE_NO_LSP=1` (or a
  missing/failed LSP) those barrel-hidden violations go undetected — the
  rule keeps only its specifier-level findings.
- **Boundary-owner:** this rule defines the layer adjacency table (no
  external config).
- **Fix:** the first violation message is echoed as the suggestion — see
  [00-overview.md § Suggestions](00-overview.md).

**`module-isolation`**

- **Flags:** a module importing anything beyond itself + `core`; bootstrap
  reaching a module by any path other than its `mod-root.ts`.
- **Detection (static-only):** import-specifier resolution to
  module/layer.
- **Exempts/skips:** none.
- **Boundary-owner:** this rule.
- **Fix:** the first violation message is echoed as the suggestion — see
  [00-overview.md § Suggestions](00-overview.md).

**`poly-isolation`**

- **Flags:** importing any file inside a poly structure other than its
  `poly-mod.ts`; with the LSP up, also a symbol `poly-mod.ts` re-exports
  that resolves to a file outside the structure (a leak).
- **Detection (LSP-enhanced — degrades to static):** `poly-mod.ts` is a
  poly structure's only public surface, checked by static import path;
  the leak check is entirely LSP-gated — under `SHAPE_NO_LSP=1` (or a
  missing/failed LSP) only the static importer check runs and re-export
  leaks go undetected.
- **Exempts/skips:** none beyond the LSP-off degradation above.
- **Boundary-owner:** this rule.
- **Fix:** none — no CLI suggestion (see
  [00-overview.md § Suggestions](00-overview.md)).

**`poly-detection`**

- **Flags:** 3+ sibling business features exporting the same name with
  compatible (same-arity) signatures that should be one poly structure.
- **Detection (LSP-only — silent without LSP):** judged per export name —
  a single name exported from 3+ siblings' `mod.ts` whose signatures all
  share one arity triggers the finding; the siblings' full export sets
  need not match; reported on the `domain/business` folder.
- **Exempts/skips:** fewer than 3 qualifying siblings.
- **Boundary-owner:** this rule.
- **Fix:** none — no CLI suggestion.

**`poly-stray`**

- **Flags:** a standalone business feature whose `mod.ts` shares 2+ of a
  sibling poly structure's common exports — it belongs inside that poly as
  another variant.
- **Detection (static-only):** export names regexed from `export
  function`/`export const` declarations; name overlap only, no signature
  comparison. "Common exports" is the intersection of every
  implementation's `mod.*` exports (implementations without a `mod.*` are
  skipped from the computation).
- **Exempts/skips:** a poly whose intersection has fewer than 2 names is
  never a comparison base.
- **Boundary-owner:** this rule.
- **Fix:** none — no CLI suggestion.

**`dto-validation`**

- **Flags:** a non-test source file with a `dto` path segment carrying no
  runtime-validation marker, unless exempt below.
- **Detection (LSP-enhanced — degrades to static):** file-level, not
  per-property — any one recognized marker passes it: a schema/validator
  call (zod `z.*`, valibot `v.*(`, TypeBox `Type.*`, `parse`/`safeParse`/
  `validate*`, `.refine(`, or the standalone word `schema`), a
  class-validator/class-transformer decorator or call (`@Is*`, `@Valid*`,
  `@Allow`, `@Transform`, `plainToInstance` & co.), or a `throw new`.
- **Exempts/skips:** files whose exports are all type-only
  (`type`/`interface`) have no runtime surface and are exempt, via two
  independent paths — either alone suffices, never both required: a regex
  pass (some `export type`/`export interface`, no value export) exempts
  without consulting the LSP at all; failing that, with the LSP up, the
  file is exempt when every export the LSP reports is type-only — so under
  `SHAPE_NO_LSP=1` (or a missing/failed LSP) only the regex exemption
  applies, and an LSP query failure flags the file, same as the static
  miss.
- **Boundary-owner:** this rule (the marker list is defined here).
- **Fix:** deterministic — "add a Zod schema" — see
  [00-overview.md § Suggestions](00-overview.md).

**`data-class-returns`**

- **Flags:** a data-class method returning anything other than `void`,
  `this`, or a type headed by a single capitalized identifier.
- **Detection (LSP-only — silent without LSP):** judged by the return type
  in the class's LSP-rendered signature, after unwrapping a top-level
  `Promise<>`; the "head" is the text before any `<` — `Foo`,
  `Array<Foo>`, `Map<string, Foo>` pass; primitives (`string`, `number`,
  `boolean`, `bigint`, `symbol`, `null`, `undefined`), `any`/`unknown`/
  `object`, inline `{…}` object types, literal types, `Foo[]`, `Foo |
  null`, and lowercase-named heads flag.
- **Exempts/skips:** a method whose LSP-rendered signature carries no
  return annotation is skipped, never flagged; constructors are skipped.
  A data class is any exported class in a non-test source file that
  carries class-validator decorators (`@Is*`/`@Valid*`) — path plays no
  part.
- **Boundary-owner:** this rule.
- **Fix:** none — no CLI suggestion.

**`no-dto-cast`**

- **Flags:** hand-written code casting with `as XxxDto` — validate the seam
  with `assert(XxxDto, …)` instead. This is what keeps hand-written code
  from bypassing the generated seams.
- **Detection (static-only):** every non-test source file under the lint
  root — bypassing a generated seam is just as much a violation in a
  coordinator as in an entrypoint, so the check isn't layer-scoped; a cast
  is flagged when it matches `as \w+Dto`, including the double-cast form
  `as unknown as XxxDto`.
- **Exempts/skips:** none.
- **Boundary-owner:** this rule.
- **Fix:** none — no CLI suggestion.

**`barrel-discipline`**

- **Flags:** a re-export (`export { … } from` / `export * from`) outside a
  barrel file.
- **Detection (static-only):** a barrel file is one whose extension-stripped
  basename is `mod-root` or `poly-mod` (at any path), or whose
  root-relative path starts with the `src/bootstrap/` prefix (see
  Definitions).
- **Exempts/skips:** barrel files themselves.
- **Boundary-owner:** this rule.
- **Fix:** deterministic — "move re-exports to `mod-root.ts`/
  `poly-mod.ts`" — see [00-overview.md § Suggestions](00-overview.md).

**`import-aliases`** — No parent-climbing imports: flags any static
import, `export … from`, or dynamic `import()` whose specifier contains
the substring `..` — only that. `./` specifiers pass at any depth
(`./sub/file.ts` included, not just same-dir siblings), as do `@` aliases
and every other `..`-free specifier. *(static-only · fix: message-derived
— names the offending specifier — see
[00-overview.md § Suggestions](00-overview.md))*

**`external-imports`** — No literal `npm:`/`jsr:` specifiers — external
packages go through `#` aliases in the import map. *(static-only · fix:
deterministic — "use a `#` alias" — see
[00-overview.md § Suggestions](00-overview.md))*

**`fixture-promotion`**

- **Flags:** a file under `fixtures/` that production code imports and
  that hasn't been promoted to `assets/`; fixtures only tests touch stay
  put.
- **Detection (static-only):** "production code" is any source file
  (`.ts`/`.tsx`/`.js`/`.jsx`) whose extension-stripped basename is exactly
  `mod`, plus any file under the `src/bootstrap/` prefix (see
  Definitions). An import counts when the specifier, after resolution,
  equals the fixture's root-relative path with either side's extension
  stripped.
- **Exempts/skips:** resolution only touches relative specifiers — the
  shared import scanner resolves `./`/`../` against the importer's
  directory but keeps every other specifier (including `@` aliases)
  verbatim, so an alias import like `@…/fixtures/foo` never matches. In
  practice the rule fires only on `../`-relative fixture imports
  (themselves already flagged by `import-aliases`) or verbatim
  root-relative specifiers — in an alias-clean tree it is effectively
  dormant.
- **Boundary-owner:** this rule.
- **Fix:** deterministic — "move to `assets/`" — see
  [00-overview.md § Suggestions](00-overview.md).

**`module-fragmentation`**

- **Flags:** a fragmented `src/<module>` folder, on four signals: fewer
  than 5 non-test source files; a single business feature (fires only
  when the small-files or thin-layers signal corroborates it); fewer than
  2 active layers — a layer is active iff its directory exists in the
  walked tree (`src/<module>/domain/{business,data,coordinators}`,
  `src/<module>/{entrypoints,dto}`), regardless of what it contains; and,
  on an already-flagged module, ≥50% of its cross-module imports going to
  one other module, with that target receiving at least 3 of them (the
  suggested merge target).
- **Detection (static-only):** reported once, on the `src/<module>`
  folder entry. The counting unit is the import statement: each `import
  …`/`export … from`/dynamic `import()` occurrence in a source file's
  text is one count against its resolved target module — not one per
  imported symbol, and not deduplicated to one per target file. Imports of
  `core` and of the module itself don't count as cross-module in the
  tally (neither numerator nor denominator), so `core` can never dominate
  the ratio or be suggested as the target.
- **Exempts/skips:** `core`/`bootstrap` exempt; modules with fewer than 2
  non-test source files (the module-fragmentation exception in
  Definitions) skipped from every signal, including the small-files count
  itself.
- **Boundary-owner:** this rule; it uses the module-fragmentation
  exception to the non-test-source-file predicate (Definitions), not the
  generic one.
- **Fix:** no deterministic suggestion; can get a best-effort LLM
  suggestion — see [00-overview.md § Suggestions](00-overview.md).

### Rune-derived rules (spec ↔ tree parity)

The family's spec input comes from the walk when the durable spec falls
inside the lint root — the flat/legacy layouts covered in Reach below.
In the canonical composed layout, where it doesn't, this family instead
runs the auto-discovery scan `rune sync` step 5 lists lint under, alongside
dev watch, run-all, and ghost stubs
([03-cli.md § `rune sync` semantics, step 5](../03-cli/02-rune-sync-semantics-that-matter.md)):
it lists `spec/runes/` (or legacy `spec/`) at the project (git) root
directly, recognizing entries there through the same `isProjectSpec` gate
defined once in Definitions above — a `.in-prog.rune` draft is excluded
either way. Either path hands this family the same recognized-spec object.
A recognized spec is parsed with the shared `rune-parse` parser — a
total parser that never fails: malformed lines are recorded as parse
errors and yield no AST elements, and the rules never read those errors
(surfacing them is `rune check`'s job), so a broken spec produces no lint
finding of its own — its unparseable elements simply contribute no
expectations, and the rules check whatever did parse; the parser is pure,
so this affects neither the exit code nor the byte-identical `--json`
output beyond the parity findings that remain. `rune-heal-todo`, the
family's one spec-free rule, is not keyed on a walked entry at all: it
resolves `heal-rules.json` from its known location via project-root
resolution — the same mechanism this family uses above to reach
`spec/runes/` in the canonical composed layout — independent of the walk,
so it reads the file regardless of where the walk itself is rooted, and a
`KEEP_FIXTURES_DIR` override location is still covered
([04-codegen.md § heal rules § Location](../04-codegen/04-heal-rules.md)).
A file whose contents don't parse as a heal-rules document is silently
skipped (see `--strict`).

A recognized spec is then paired with its module — the spec's `[MOD]`
directive, else the name derived from its staging filename (`<name>.rune`'s
`<name>`) — and its expectations are checked against `src/<module>/…`
entries in the same walked tree, so a staged spec whose module hasn't been
generated yet fails the presence rules like any other parity break.

**Reach.** `rune sync` never relocates a spec — `spec/runes/<m>.rune` is
its one durable home, read in place (see the `isProjectSpec` gate above).
In a flat/legacy layout, where `spec/runes/` (or legacy `spec/`) sits
beside `src/` in the same walked directory, that path falls inside the
lint root ([00-overview.md § Walk and scope](00-overview.md) computes it)
and the walk supplies the spec directly. In the canonical composed layout,
the shared `spec/` sits at the git root beside `server/` — outside the
lint root, which descends into `server/` alone — so a module's durable
spec is never a walked entry there; this family's auto-discovery scan
(above) reads it anyway, straight from the project root, independent of
the walk — no relocation needed, so the parity rules stay live in the
canonical layout too.

Because that scan runs from the project root rather than the lint root,
this family's spec-anchored findings — the ones anchored directly on the
`.rune` spec entry rather than on a walked `src/…` entry: `rune-fault-coverage`
(fires on the module's spec entry — see
[00-overview.md § Walk and scope](00-overview.md)), and `rune-service-presence`
/ `rune-service-core-only` (spec-internal checks with no filesystem slot to
anchor on) — report a `path` relative to the project root, e.g.
`spec/runes/tasks.rune`, not relative to the lint root. In the canonical
composed layout the spec sits outside the lint root, so a lint-root-relative
path would have to climb out via `../spec/runes/tasks.rune` — a path the
`isProjectSpec` gate's root-relative match would not recognize. Every other
rule in this family anchors its findings on a walked `src/…` entry and
reports the ordinary lint-root-relative path, exactly like the generic
architecture rules.

These make the spec and the generated tree provably agree:

**`rune-coordinator-presence` / `rune-business-presence` /
`rune-adapter-presence` / `rune-entrypoint-presence`**

- **Flags:** a spec element with no generated `mod.ts` **and** co-located
  test file on disk — the slot directory existing without them still
  fails.
- **Detection (static-only):** per element kind —
  - `rune-coordinator-presence`: `src/<module>/domain/coordinators/
    <process>/mod.ts` + `int.test.ts` for each `[REQ]`.
  - `rune-business-presence`: `src/<module>/domain/business/<noun>/mod.ts`
    + `test.ts` for each untagged step noun; for a `[PLY]` noun it checks
    only that the `.../<noun>/` folder exists.
  - `rune-adapter-presence`: `src/<module>/domain/data/<noun>/mod.ts` +
    `smk.test.ts` for each boundary `service:noun.verb`.
  - `rune-entrypoint-presence`: `src/<module>/entrypoints/<surface>/
    mod.ts` + `e2e.test.ts` for each `[ENT]`/`[ENT:ws]`.
- **Exempts/skips:** none.
- **Boundary-owner:** each owns exactly its own slot kind (see the
  create-once test-file map in Definitions); `rune-poly-cases` owns
  everything inside a `[PLY]` noun's folder.
- **Fix:** none — no CLI suggestion for this family (see
  [00-overview.md § Suggestions](00-overview.md)).

**`rune-service-presence`**

- **Flags:** a used boundary call `service:noun.verb(...)` whose `service`
  prefix resolves to no `[SRV]`.
- **Detection (static-only):** spec-internal, not a disk check — it
  inspects no filesystem slot. It parses the recognized spec, collects
  every used boundary call, and verifies each `service` prefix resolves to
  a `[SRV]` declared in the core spec. The core spec is *located*, not
  identified by a literal path: this is a separate mechanism from the
  `isProjectSpec` gate above (which governs only which `.rune` files are
  recognized as walked/auto-discovered project specs). Instead this rule
  walks `spec-root.ts`'s full ordered candidate list
  ([01-architecture.md § The canonical generated-project
  shape](../01-architecture/05-the-canonical-generated-project-shape.md)),
  first existing candidate wins — the same resolution codegen uses to find
  the core spec, so linter and codegen agree, and one that reaches beyond
  what `isProjectSpec` recognizes (`src/core/core.rune`, the last-resort
  bare `core.rune`, and a `.in-prog` re-probe of the whole list among its
  candidates). `spec/runes/core.rune` at the git root is the canonical
  case, not the only one; legacy layouts resolve to whichever candidate
  that list picks (the core spec resolves against its own `[SRV]`s; every
  other spec resolves against that located core spec).
- **Exempts/skips:** none.
- **Boundary-owner:** mirrors the planner's own undeclared-boundary-service
  check ([04-codegen.md § Validate](../04-codegen/01-pipeline.md)); this
  rule owns only the lint-time re-check.
- **Fix:** none — no CLI suggestion for this family.

**`rune-service-core-only`**

- **Flags:** a `[SRV]` declared outside the located core spec — see
  `rune-service-presence` above for how that spec is located via
  `spec-root.ts`'s candidate list, not a literal path.
- **Detection (static-only):** mirrors the planner error — check-time and
  lint-time can't drift.
- **Exempts/skips:** none.
- **Boundary-owner:** this rule.
- **Fix:** none — no CLI suggestion for this family.

**`rune-poly-cases`**

- **Flags:** a missing file in a `[PLY]` noun's internal scaffold.
- **Detection (static-only):** owns the internal scaffold of every `[PLY]`
  noun — `rune-business-presence` stops at the feature folder's existence.
  For each `[PLY]`: `base/mod.ts`, `base/test.ts`, `poly-mod.ts`; for each
  `[CSE]`: `implementations/<case>/mod.ts`,
  `implementations/<case>/test.ts`.
- **Exempts/skips:** none.
- **Boundary-owner:** this rule (the `[PLY]` exception to the create-once
  test-file map — see Definitions).
- **Fix:** none — no CLI suggestion for this family.

**`rune-dto-shape` / `rune-typ-shape`**

- **Flags:** a missing generated file for a `[DTO]`/`[TYP]`; on an
  existing file, a rune-declared property/name absent from the file's
  text.
- **Detection (static-only):** the file path and the `[TYP]`/`[DTO]`
  name-collision suffix are generation-owned — see
  [04-codegen.md § Generate, `[TYP]` row](../04-codegen/01-pipeline.md)
  (`typFileName`, `src/rune/domain/business/rune-bindings/mod.ts`); a
  missing file is flagged. On an existing file this rule's own check is a
  textual subset test, not structural equality: `rune-dto-shape` requires
  every rune-declared property name — normalized first (trailing `?`
  stripped, `url(s)` → `urls`) — to appear as a whole-word identifier
  anywhere in the file's text; `rune-typ-shape` requires only the
  `[TYP]`'s name itself as a whole word.
- **Exempts/skips:** extra fields on disk never flag; nothing beyond the
  names is compared — types and optionality markers are normalized away,
  not verified.
- **Boundary-owner:** file location and collision naming are
  04-codegen/01's; this rule owns only the textual-subset check.
- **Fix:** none — no CLI suggestion for this family.

**`rune-fault-coverage`**

- **Flags:** a declared fault with no matching `Deno.test` in one of its
  routed test files — the "each fault implies a test case" language rule,
  enforced.
- **Detection (static-only):** which test file(s) a given fault must
  appear in is generation-owned — see
  [04-codegen.md § Fault-implied tests](../04-codegen/01-pipeline.md).
  This rule's own check: a fault counts as covered against a routed file
  when that file contains a `Deno.test` whose name string equals the
  fault name exactly; the fault passes only when every one of its routed
  files that exists on disk contains that match.
- **Exempts/skips:** a routed file that doesn't exist is skipped here —
  `rune sync` scaffolds these create-once test files and the matching
  presence rule (see the create-once test-file map in Definitions) owns
  the missing file.
- **Boundary-owner:** routing lives in 04-codegen/01; presence of the
  routed files lives in the presence rules above; this rule owns only
  content matching.
- **Fix:** none — no CLI suggestion for this family.

**`rune-extra-files`**

- **Flags:** a walked entry sitting in a rune-owned slot that no
  recognized spec predicts — an orphan to delete or re-declare. The
  presence rules' inverse: they ask "the spec declared X, where is it on
  disk?", this asks "X is on disk, what declared it?".
- **Detection (static-only):** from every recognized spec it predicts the
  full set of declared slots — the same slot set the presence rules above
  check (coordinator/business/data/entrypoint dirs, poly cases walked,
  DTO/type files with the `-type` collision suffix — see
  `rune-dto-shape`/`rune-typ-shape` above) — then flags any walked entry
  in one of those slot positions that no spec predicts.
- **Exempts/skips:** `src/core/` is skipped; a module no spec declares is
  skipped entirely (hand-written modules are safe); files *inside* a
  declared slot folder are outside this rule's reach.
- **Boundary-owner:** the slot set is defined by the presence rules above;
  this rule owns only the predicted-vs-walked diff.
- **Fix:** none — no CLI suggestion for this family.

**`rune-signature-parity`**

- **Flags:** a `[REQ]` coordinator `mod.ts` or `[ENT]`/`[ENT:ws]`
  entrypoint `mod.ts` that doesn't reference the spec's declared I/O DTOs
  — every `[ENT:ws]` topic is checked against its socket's entrypoint file
  exactly like an `[ENT]` route.
- **Detection (static-only):** "reference" is textual, deliberately
  approximate — for each declared input/output whose name matches
  `<Name>Dto` (inline `{…}` shapes are skipped), the file's text must
  contain that identifier as a whole word anywhere; not an import trace or
  LSP signature check, so it catches wrong, missing, or typoed DTO names
  and nothing subtler.
- **Exempts/skips:** a coordinator/entrypoint file that doesn't exist is
  skipped — the presence rules own missing files.
- **Boundary-owner:** presence rules own missing files; this rule owns
  only the textual reference check.
- **Fix:** none — no CLI suggestion for this family.

**`rune-heal-todo`** — (strict-gated) No un-enriched heal-rules entries.
*(static-only · fix: none — no CLI suggestion · see `--strict`)*

### Example: `task.update` end-to-end

Reusing the `tasks` module spec and generated tree from
[04-codegen.md § Pipeline, worked example](../04-codegen/01-pipeline.md):

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

Take the generated tree from that walkthrough and plant three violations —
a missing test file, a parent-climbing import, and an orphan directory:

```
src/tasks/
  mod-root.ts
  domain/
    coordinators/
      task-update/
        mod.ts              # present
        # int.test.ts MISSING — violation 1
      task-archive/          # violation 3: no [REQ] task.archive in the spec
        mod.ts
        int.test.ts
    business/
      task/
        mod.ts               # imports "../../../../core/helper.ts" — violation 2
        test.ts
    data/
      task/
        mod.ts
        smk.test.ts
  dto/
    update-task.ts
    task.ts
    id.ts
    title.ts
    slug.ts
    done.ts
```

| Path | Rule that fires | Why |
| --- | --- | --- |
| `domain/coordinators/task-update/` | `rune-coordinator-presence` | the `[REQ] task.update`'s slot exists but its `int.test.ts` doesn't — the presence rule fails even though `mod.ts` is there |
| `domain/business/task/mod.ts` | `import-aliases` | its specifier `"../../../../core/helper.ts"` contains `..` |
| `domain/coordinators/task-archive/` | `rune-extra-files` | a coordinator-slot directory on disk that no `[REQ]` in the spec predicts |

**Tracing one `[REQ]` through the parity family**, `task.update`:

1. **Spec declaration** — `[REQ] task.update(UpdateTaskDto): TaskDto` in
   the module's `spec/runes/tasks.rune`.
2. **Presence-rule path checked** — `rune-coordinator-presence` checks
   `src/tasks/domain/coordinators/task-update/mod.ts` + `int.test.ts`
   (both required; here `int.test.ts` is missing, so this is violation 1
   above).
3. **`rune-extra-files` slot predicted** — from the same `[REQ]`,
   `rune-extra-files` predicts `src/tasks/domain/coordinators/task-update`
   as a declared coordinator slot, so nothing flags there beyond the
   presence gap already caught in step 2. `task-archive` has no matching
   `[REQ]`, so no slot is predicted for it — the directory that exists on
   disk anyway is exactly what `rune-extra-files` flags (violation 3
   above).

No other rule in either family fires on this tree: the business, data, and
DTO slots all match what the spec declares and what `rune-dto-shape` /
`rune-typ-shape` / `rune-signature-parity` expect.

