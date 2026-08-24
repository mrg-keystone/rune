# The Architecture Linter (`rune lint`)

> Part of the [project spec series](README.md). Runs via `runPipeline`
> (`src/rune/domain/coordinators/pipeline/mod.ts`) over 27 rule definitions
> (`src/rune/mod-root.ts`). Each rule is one flag-free
> `check(path, target, ctx) → string[] | null` — `target` is `"folder"` for a
> directory entry, else the file's extension (`"ts"`, `"json"`, `"rune"`, …).
> No lint flag reaches a rule body; strict-gated rules read strictness from
> the `RUNE_LINT_STRICT` env var instead — or its `RUNE_STRICT` alias, either
> one enables strict mode (see `--strict`).

`rune lint [dir]` lints a project against the canonical architecture.
`[dir]` (default `.`) is the start point, not the walk root: lint walks up
from it to the nearest directory holding a `deno.json(c)` — falling back to
`[dir]` itself when none is found — then descends into `server/` when that
root has no `src/` of its own but does hold `server/bootstrap/mod.ts` (the
composed-monorepo backend), so run at the git root it lints `server/`, never
`ui/`. From that lint root it classifies every file into {module, layer}
with the shared `classify` kernel, and runs every rule over every walked
entry — every directory plus every file. The walk hard-skips `.git`,
`node_modules`, and any dot-prefixed entry at every depth, and additionally
skips everything git ignores (the set from
`git ls-files --others --ignored --exclude-standard --directory`, run from
the lint root — empty outside a git repo), so tool caches, coverage output,
and other gitignored trees never reach the rules. A rule that judges an
aggregate anchors itself to one entry and returns `null` for all others, so
it reports once (`module-fragmentation` fires on the `src/<module>` folder
entry, `rune-fault-coverage` on the module's `.rune` spec entry); exit 1
on any violation, 0 clean. `--module <name>` scopes the report, not the
walk: every rule still runs over the whole lint root, then only findings
whose path starts with the literal prefix `src/<name>/` — trailing slash
included — are printed, get suggestions, and count toward the exit code,
so a `--module` run exits 0 even when violations exist elsewhere in the
tree. That strict prefix also drops any finding anchored on the `src/<name>`
folder entry itself (`"src/<name>"` does not start with `"src/<name>/"`) —
so a `--module` run never reports `module-fragmentation`.

Text output groups findings by rule — a `[rule] — N violation(s)` header,
then each finding's path with its violation bullets and any `→ suggestion`
inline — closing with the total violation count ("All clear — no violations
found." when clean). `--json` instead prints a flat array of
`{rule, path, line, message}` objects, one per violation message (`path` is
relative to the lint root, exactly as the walk produced it; `line` is
parsed from a "line N"/"L<n>" hint in the message, else 0), sorted by
rule → path → line → message so identical inputs give byte-identical output
(the L0 gate — a guarantee root-relative paths make possible: an absolute
`path` would bake the checkout location into the bytes); suggestions never
appear in JSON.

Deterministic per-rule suggestions always print inline in text output —
`--no-suggest` does not suppress them. They are hard-coded in the CLI, not
in rule bodies: fixed one-liners for `external-imports` (use a `#` alias),
`barrel-discipline` (move re-exports to `mod-root.ts`/`poly-mod.ts`),
`dto-validation` (add a Zod schema), and `fixture-promotion` (move to
`assets/`); message-derived lines for `import-aliases` (names the offending
specifier) and `structure`'s "Wrong extension"/"Missing required file"
findings (names the expected extension/filename); and, for
`layer-restrictions` and `module-isolation`, the first violation message
echoed as the suggestion. No other rule gets a deterministic suggestion.
`structure` "not allowed" placement
findings and `module-fragmentation` findings can additionally get LLM
suggestions from OpenAI (model `gpt-4.1-mini`, keyed by the `OPENAI_API_KEY`
env var); `--no-suggest`/`--json` skips only this LLM call. The LLM path is
best-effort by design: a missing key or a failed call prints a `[suggest]`
note to stderr, the finding prints without a suggestion, and the exit code is
unaffected.

Every lint run also writes a `[profile]` timing block to stderr — unconditional,
not env-gated, and emitted even under `--json`, since results go to stdout and
the two streams never mix. `runPipeline` prints `[profile] buildContext: Nms
(N files, N dirs)`, `[profile] LSP init: Nms`, `[profile] LSP shutdown: Nms`, a
per-rule `[profile] Rules (N entries):` breakdown sorted slowest-first, and a
closing `[profile] Total: Nms`. Like the `[suggest]` note this lives on stderr
and never reaches the L0/L4 goldens — both capture the results, not stderr.

Several rules sharpen their findings through an LSP session — the shipped
Rust `rune-lsp` ([08-language-tooling.md](08-language-tooling.md)), spawned
over stdio per `src/core/dto/lsp-config.ts`; every query is gated on the
server's advertised capabilities (`src/rune/domain/data/lsp/mod.ts` is the
client). The LSP is an enhancement, never a requirement: when
`SHAPE_NO_LSP=1` is set — or the binary is missing or fails to initialize —
`ctx.lsp` is `null` and every rule degrades to its static check (an LSP-only
rule like `poly-detection` goes silent; `layer-restrictions` stops tracing
re-exports, so violations hidden behind barrels go undetected). Golden
capture (L0/L4, `scripts/verify.ts`) neutralizes both nondeterminism
sources: `SHAPE_NO_LSP=1` — set process-wide, and in the env of the CLI
runs L0 spawns — makes output independent of whether `rune-lsp` is
installed, and both gates capture JSON, which the LLM path can never reach:
L0 lints via the real CLI with `--json` (skips the LLM call, omits
suggestions), and L4 calls `runPipeline` in-process and serializes the
results to the same sorted `{rule, path, line, message}` array, bypassing
the suggestion layer entirely — so a live `OPENAI_API_KEY` cannot leak an
LLM response into a golden.

## Rule families

### Generic architecture rules

Several rows below say **non-test source file**: a `.ts`/`.tsx`/`.js`/`.jsx`
file (`data-class-returns` narrows this to `.ts`/`.tsx`) whose path contains
no `.test.` or `.spec.` marker. `module-fragmentation` replaces that
predicate with its own: it excludes any basename containing the substring
`test.` — which catches the canonical bare `test.ts` (and, incidentally,
any name containing it, like `latest.ts`) but not `.spec.` files, which it
counts as source — and counts that same set everywhere it counts files:
its small-files signal, its coupling tally, and its fewer-than-2-files
skip.

| Rule | Enforces |
| --- | --- |
| `structure` | File/folder placement against the canonical layout tree in `keywords.json → canonicalPaths` — top-level slots `bootstrap/`, `src/`, `spec/`, `specs/`, `fixtures/`, `assets/`, `dist/`, `app/`; the full recursive tree (with its `$ignore` opt-outs) lives in that key and is not duplicated here. The ban lists are `$`-keys of that same object — `$forbiddenDirNames` (dir names: `lib`, `modules`, `internal`), `$looseFileNames` (vague name words `utils`, `helpers`, `common`, `shared`, `util`, `helper`, matched as whole word tokens, so `utilization` passes), `$rootFiles` (the only files allowed at the top level of the lint root: `deno`, `deno.lock`, `README`, `.gitignore`, `TODOS`, `serve`, `serve-dev` — matched by name with the last extension stripped or verbatim, so `deno.json`/`README.md` pass; the `.gitignore` entry is vestigial — the walk's dot-skip drops every dot-prefixed entry before any rule runs, so this rule never sees root dotfiles) — plus `core` anywhere but `src/core` |
| `layer-restrictions` | The dependency direction, as each layer's complete allowed-import set: business → {business, dto}; data → {data, dto}; coordinators → {coordinators, business, data, dto}; entrypoints → {entrypoints, coordinators, business, data, dto} — so entrypoints may import business and data directly, not only via coordinators; dto → {dto}; bootstrap → everything. The static check maps each `src/` import specifier to its layer; on files it already flagged, an LSP pass additionally traces every import's exported symbols to their defining files, catching violations hidden behind barrel re-exports in those files — deliberately scoped: a file whose only violations hide behind barrels has no static finding and is never traced (LSP-free runs keep only the specifier-level findings) |
| `module-isolation` | A module imports only itself + `core`; bootstrap reaches modules only via `mod-root.ts` |
| `poly-isolation` | `poly-mod.ts` is a poly structure's only public surface: importing any other file inside one from outside it is flagged; with the LSP up, a symbol re-exported by `poly-mod.ts` that resolves to a file outside the structure is flagged as a leak |
| `poly-detection` | 3+ sibling business features exporting the same name with compatible (same-arity) signatures should be one poly structure. Judged per export name: a single name exported from 3+ siblings' `mod.ts` whose signatures all share one arity triggers the finding — the siblings' full export sets need not match — reported on the `domain/business` folder (wholly LSP-based: silent without it) |
| `poly-stray` | A standalone business feature whose `mod.ts` shares 2+ of the common exports of a sibling poly structure's implementations belongs inside it as another variant. "Common exports" is the intersection: the names every implementation's `mod.*` exports (implementations without a `mod.*` are skipped from the computation); a poly whose intersection has fewer than 2 names is never a comparison base. Purely static: export names regexed from `export function`/`export const` declarations — name overlap only, no signature comparison, no LSP |
| `dto-validation` | Every non-test source file with a `dto` path segment must contain a runtime-validation marker. The check is file-level, not per-property — any one recognized marker passes it: a schema/validator call (zod `z.*`, valibot `v.*(`, TypeBox `Type.*`, `parse`/`safeParse`/`validate*`, `.refine(`, or the standalone word `schema`), a class-validator/class-transformer decorator or call (`@Is*`, `@Valid*`, `@Allow`, `@Transform`, `plainToInstance` & co.), or a `throw new`. Files whose exports are all type-only (`type`/`interface`) have no runtime surface and are exempt, via two independent paths — either alone suffices, never both required: a regex pass (some `export type`/`export interface`, no value export) exempts without consulting the LSP at all; failing that, with the LSP up, the file is exempt when every export the LSP reports is type-only (an LSP query failure flags the file, same as the static miss) |
| `data-class-returns` | Methods on data classes return validated class instances, judged by the return type in the class's LSP-rendered signature — a method whose rendering carries no return annotation is skipped, never flagged. A data class is any exported class in a non-test source file that carries class-validator decorators (`@Is*`/`@Valid*`) — path plays no part. Per method (constructors skipped), after unwrapping a top-level `Promise<>`, the only passing shapes are `void`, `this`, or a type whose head — the text before any `<` — is a single capitalized identifier (`Foo`, `Array<Foo>`, `Map<string, Foo>`); every other shape is flagged — primitives (`string`, `number`, `boolean`, `bigint`, `symbol`, `null`, `undefined`), `any`/`unknown`/`object`, inline `{…}` object types, literal types, and any head failing that test, so `Foo[]`, `Foo \| null`, and lowercase-named types flag where `Array<Foo>` passes (wholly LSP-based: silent without it) |
| `no-dto-cast` | A coordinator must not cast with `as XxxDto` — validate the seam with `assert(XxxDto, …)` instead. This is what keeps hand-written code from bypassing the generated seams |
| `barrel-discipline` | Re-exports (`export { … } from` / `export * from`) only in barrel files: a file whose extension-stripped basename is `mod-root` or `poly-mod` (at any path), or whose root-relative path starts with the literal prefix `src/bootstrap/` — a prefix the composed layout's top-level `bootstrap/` never matches. Any other source file containing a re-export is flagged |
| `import-aliases` | No parent-climbing imports: flags any static import, `export … from`, or dynamic `import()` whose specifier contains the substring `..` — only that. `./` specifiers pass at any depth (`./sub/file.ts` included, not just same-dir siblings), as do `@` aliases and every other `..`-free specifier |
| `external-imports` | No literal `npm:`/`jsr:` specifiers — external packages go through `#` aliases in the import map |
| `fixture-promotion` | A file under `fixtures/` that production code imports must be promoted to `assets/`; fixtures only tests touch stay put. "Production code" is any source file (`.ts`/`.tsx`/`.js`/`.jsx`) whose extension-stripped basename is exactly `mod`, plus any file whose root-relative path starts with the literal prefix `src/bootstrap/` — a prefix the composed layout's top-level `bootstrap/` never matches, so there only `mod.*` importers trigger the rule. An import counts when the specifier, after resolution, equals the fixture's root-relative path with either side's extension stripped — and resolution only touches relative specifiers: the shared import scanner resolves `./`/`../` specifiers against the importer's directory, but keeps every other specifier (including `@` aliases) verbatim, so an alias import like `@…/fixtures/foo` never matches. In practice the rule fires only on `../`-relative fixture imports (themselves already flagged by `import-aliases`) or verbatim root-relative specifiers — in an alias-clean tree it is effectively dormant |
| `module-fragmentation` | Flags fragmented modules, per `src/<module>` folder (`core`/`bootstrap` exempt; modules with fewer than 2 non-test source files skipped — the same count the small-files signal uses), on four signals: fewer than 5 non-test source files; a single business feature (fires only when the small-files or thin-layers signal corroborates it); fewer than 2 active layers — a layer is active iff its directory exists in the walked tree (`src/<module>/domain/{business,data,coordinators}`, `src/<module>/{entrypoints,dto}`), regardless of what it contains, so even an empty layer folder counts; and, on an already-flagged module, ≥50% of its cross-module imports going to one other module, with that target receiving at least 3 of them — the suggested merge target. The counting unit is the import statement: each `import …`/`export … from`/dynamic `import()` occurrence in a source file's text is one count against its resolved target module — not one per imported symbol, and not deduplicated to one per target file, so two statements naming the same target module count twice. Imports of `core` and of the module itself don't count as cross-module in this tally (neither in the ratio's numerator nor its denominator), so `core` can never dominate the ratio or be suggested as the target |

### Rune-derived rules (spec ↔ tree parity)

The family's spec input comes from the walk itself — there is no separate
discovery pass. A walked `.rune` entry counts as a project spec only when
the shared `isProjectSpec` gate
(`src/rune/domain/business/rune-bindings/mod.ts`) recognizes its
root-relative path: `<name>.rune` directly under a staging dir
(`spec/runes/`, `specs/runes/`, or the legacy flat `spec/`/`specs/` — files
nested deeper, like `spec/misc/` and `spec/ui/`, fall through), or a spec
moved into its module as `src/<module>/<module>.rune` or
`src/<module>/spec.rune`. Any other `.rune` file is ignored, and a
`.in-prog.rune` draft always fails the gate, so every rule here skips
drafts (`rune-heal-todo`, the family's one spec-free rule, instead keys on
the walked `heal-rules.json` entry — recognized by basename alone, at any
depth in the walked tree, deliberately dir-agnostic so a `KEEP_FIXTURES_DIR`
override location is still covered; a matching file whose contents don't
parse as a heal-rules document is silently skipped. See `--strict`). A recognized spec is
parsed with the shared `rune-parse` parser — a total parser that never
fails: malformed lines are recorded as parse errors and yield no AST
elements, and the rules never read those errors (surfacing them is
`rune check`'s job), so a broken spec produces no lint finding of its own —
its unparseable elements simply contribute no expectations, and the rules
check whatever did parse; the parser is pure, so this affects neither the
exit code nor the byte-identical `--json` output beyond the parity findings
that remain. The spec is then paired with its module — the
spec's `[MOD]` directive, else the name derived from the path (the staging
filename, or the `src/<module>/` segment) — and its expectations are
checked against `src/<module>/…` entries in the same walked tree, so a
staged spec whose module hasn't been generated yet fails the presence rules
like any other parity break. In the canonical composed layout the shared
`spec/` sits at the git root beside `server/` — outside the lint root — so
staged specs there are never walked; a module's spec is rune-linted once
sync moves it into `src/<module>/`.

These make the spec and the generated tree provably agree:

| Rule | Enforces |
| --- | --- |
| `rune-coordinator/business/adapter/entrypoint-presence` | Every spec element has its generated `mod.ts` **and its co-located test file** on disk — the slot directory existing without them still fails: `rune-coordinator-presence` checks `src/<module>/domain/coordinators/<process>/mod.ts` + `int.test.ts` for each `[REQ]`; `rune-business-presence` checks `src/<module>/domain/business/<noun>/mod.ts` + `test.ts` for each untagged step noun; for a `[PLY]` noun it checks only that the `src/<module>/domain/business/<noun>/` folder exists — the internal poly scaffold is `rune-poly-cases`'s job; `rune-adapter-presence` checks `src/<module>/domain/data/<noun>/mod.ts` + `smk.test.ts` for each boundary `service:noun.verb`; `rune-entrypoint-presence` checks `src/<module>/entrypoints/<surface>/mod.ts` + `e2e.test.ts` for each `[ENT]`/`[ENT:ws]` |
| `rune-service-presence` | Spec-internal, **not a disk check** — it inspects no filesystem slot. It parses the recognized spec, collects every used boundary call `service:noun.verb(...)`, and verifies each `service` prefix resolves to a `[SRV]` **declared in `core.rune`** (the core spec resolves against its own `[SRV]`s; every other spec resolves against `src/core/core.rune`). A used `service:` prefix that no `core.rune` declares is a spec error — no `src/core/data/…` path, and no `[SRV]` iteration, is involved |
| `rune-service-core-only` | `[SRV]` declared only in `src/core/core.rune` (mirrors the planner error — check-time and lint-time can't drift) |
| `rune-poly-cases` | Owns the internal scaffold of every `[PLY]` noun — `rune-business-presence` stops at the feature folder's existence. For each `[PLY]` this checks `src/<module>/domain/business/<noun>/base/mod.ts`, `base/test.ts`, and `poly-mod.ts`; for each of its `[CSE]`s, `implementations/<case>/mod.ts` and `implementations/<case>/test.ts` |
| `rune-dto-shape` / `rune-typ-shape` | Each `[DTO]`/`[TYP]` has its generated file at `src/<module>/dto/<name>.ts` (`src/core/dto/` under `:core`) — except when a `[TYP]`'s kebab-cased name collides with a same-dir `[DTO]`'s (`Dto`-suffix-stripped, kebab-cased) name: the `[DTO]` keeps `<name>.ts` and the `[TYP]` takes `<name>-type.ts` instead, so neither clobbers the other (`typFileName`, `src/rune/domain/business/rune-bindings/mod.ts`) — a missing file is flagged. On an existing file the check is a textual subset test, not structural equality: `rune-dto-shape` requires every rune-declared property name — normalized first (trailing `?` stripped, `url(s)` → `urls`) — to appear as a whole-word identifier anywhere in the file's text; `rune-typ-shape` requires only the `[TYP]`'s name itself as a whole word. Extra fields on disk never flag, and nothing beyond the names is compared — types and optionality markers are normalized away, not verified |
| `rune-fault-coverage` | **Every declared fault maps to a `Deno.test`** — the "each fault implies a test case" language rule, enforced. A fault always hangs off a step, and it double-routes to two fixed test files, not one: first to its own step's file — an untagged step's fault → `src/<module>/domain/business/<noun>/test.ts`, a boundary step's fault → `src/<module>/domain/data/<noun>/smk.test.ts`, a fault on a `[PLY]` noun's base step → `src/<module>/domain/business/<noun>/base/test.ts`, and a fault inside a `[CSE]` → that case's `src/<module>/domain/business/<noun>/implementations/<case>/test.ts` (the same slots `rune-poly-cases` scaffolds) — and second, because it is also a fault of the `[REQ]` that step belongs to, every fault in a `[REQ]` (poly cases included: a fault inside a `[CSE]` still bubbles up to its `[REQ]`) additionally routes to `src/<module>/domain/coordinators/<process>/int.test.ts`. So a fault on any step kind — untagged, boundary, or poly (base or case) — is checked in *both* its step-level test file and the process's `int.test.ts` — the coordinator's integration test covers the whole process's fault paths, on top of each step's own unit-level coverage. A fault counts as covered against a given routed file when that file contains a `Deno.test` whose name string equals the fault name exactly; the fault passes only when every one of its routed files that exists on disk contains that match. `rune-fault-coverage` only checks the *content* of a routed test file that already exists — a routed file that doesn't exist is skipped here, since `rune sync` scaffolds these create-once test files and the matching presence rule (`rune-business-presence` for `test.ts`, `rune-adapter-presence` for `smk.test.ts`, `rune-coordinator-presence` for `int.test.ts`) owns the missing file |
| `rune-extra-files` | No orphans squatting in rune-owned slots — the presence rules' inverse: they ask "the spec declared X, where is it on disk?", this asks "X is on disk, what declared it?". From every recognized spec it predicts the full set of declared slots — coordinator dirs (`src/<module>/domain/coordinators/<process>`), business-feature and adapter dirs (`src/<module>/domain/{business,data}/<noun>`, poly cases walked), entrypoint dirs (`src/<module>/entrypoints/<surface>`), and DTO/type files (`src/<module>/dto/<name>.ts`, with the same `-type` collision suffix for a colliding `[TYP]` — see `rune-typ-shape` above) — then flags any walked entry sitting in one of those five slot positions that no spec predicts, as an orphan to delete or re-declare. Scope is exactly the slot entries: `src/core/` is skipped, a module no spec declares is skipped entirely (hand-written modules are safe), and files *inside* a declared slot folder are outside this rule's reach |
| `rune-signature-parity` | Each `[REQ]`'s coordinator `mod.ts` and each `[ENT]`/`[ENT:ws]`'s entrypoint `mod.ts` references the spec's declared I/O DTOs — every `[ENT:ws]` topic is checked against its socket's entrypoint file exactly like an `[ENT]` route. "Reference" is textual, deliberately approximate: for each declared input/output whose name matches `<Name>Dto` (inline `{…}` shapes are skipped), the file's text must contain that identifier as a whole word anywhere — not an import trace or LSP signature check, so it catches wrong, missing, or typoed DTO names and nothing subtler. A coordinator/entrypoint file that doesn't exist is skipped — the presence rules own missing files |
| `rune-heal-todo` | (strict-gated) No un-enriched heal-rules entries |

## `--strict`

`--strict` sets `RUNE_LINT_STRICT=1`, which strict-gated rules read — the
`RUNE_STRICT` env var is honored as an alias, so either variable enables strict
mode. Rule bodies stay flag-free. Currently the only strict-gated rule is
`rune-heal-todo`: silent in a plain lint, but under `--strict` it fails on any
heal-rules entry still carrying `todo: true`. This is the CI/ship profile: a
module isn't done until every generated heal prompt has been enriched with a
real suggestion and reason ([04-codegen.md](04-codegen.md),
[09-claude-skills.md](09-claude-skills.md) — the `rune-build-linter` agent's
closing job).

## Governance (built, not yet wired)

`src/rune/domain/business/governance/` implements the ADR 0007 model — a
**locked org baseline + project overlay** with provenance on every change
("a linter you can edit to pass is not a linter"), alongside `migrate/`
(artifact `schemaVersion` migrations, ADR 0006) and `lint-config/`
(artifact-driven rule instances, ADR 0004). All three are implemented and
tested (the governance and L7 verify gates exercise them) but **not yet
reachable from the CLI** — forward-looking infrastructure for the fully
artifact-driven engine. See
[12-history-and-roadmap.md](12-history-and-roadmap.md).
