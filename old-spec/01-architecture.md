# Repository Architecture

> Part of the [project spec series](README.md). How this monorepo is laid out,
> how the pieces depend on each other, and the invariants that hold them
> together.

## Top-level layout

```
refactor/                      # the rune monorepo (branch: refactor)
├── deno.json                  # rune's config + the Deno workspace root
├── src/                       # the CLI engine (shaping layer) — Deno TS
│   ├── bootstrap/             #   CLI front door + build-time config
│   ├── core/                  #   shared kernel (pipeline contracts, path classifier)
│   └── rune/                  #   the domain engine (parser, codegen, lint rules, entrypoints)
├── lang/                      # the language layer — grammar, keywords.json, Rust workspace
│   ├── keywords.json          #   THE single source of truth for the language (sole exception: codegen.templates mirrors the engine)
│   ├── grammar/               #   tree-sitter grammar (generated from keywords.json)
│   ├── parser/ lsp/ cli/      #   Rust crates → rune-lsp, rune-syntax binaries
│   ├── queries/ palettes/     #   highlights.scm, Mesa Vapor palette
│   ├── supported-software/    #   per-editor + file-manager integration recipes
│   └── docs/                  #   spec.md, constraints.md, cookbook.md, example.rune
├── keep/                      # the runtime layer — publishable JSR package ONLY
│   └── src/                   #   bootstrap/, assert/, foundation/ (the framework)
├── rune-studio/               # visual editor for the language (standalone Fresh 2 + Vite app)
├── claude/                    # Claude Code assets: skills/ (rune:*) + agents/
├── examples/                  # spec→code demos (todos, shop, cake) + runnable backends
├── e2e/                       # spec→runtime acceptance suites (cake, checkout)
├── fixtures/                  # verification corpus, goldens, artifact fixtures, projects
├── scripts/                   # installers, generators, drift/lockstep guards, verify.ts
├── docs/                      # ADRs, canonical shape, assert runtime, runbooks, history
├── spec/                      # the project spec series — these docs
├── todos/  upgrades.md  maybe/  feedback/   # roadmap and history
└── .github/                   # release-rune.yml + publish-keep.yml
```

## The Deno workspace

The root `deno.json` is rune's own config; its `workspace` members are the
self-contained sub-projects: `keep` (the runtime library), `e2e/cake`,
`e2e/checkout`, and `examples/in-process-client`. Members resolve the runtime
from the **in-tree source** (`keep/`), so rune can be tested against an
unreleased runtime. Generated *user* projects (outside this repo) still pin
`jsr:@mrg-keystone/rune@^4` — intentional and unchanged. The in-repo
`examples/` spec→code demos (`todos`, `shop`, `cake`) are *not* members —
absent from the `workspace` list and under the root config's `exclude` — and
none of them resolves the runtime in-tree. `todos`, the only demo whose
generated tree is committed, resolves like the user projects it models:
`examples/todos/deno.json` (written by `rune sync`) pins
`jsr:@mrg-keystone/rune@^4` and `@^4/assert`. `shop` and `cake` commit no
generated output — just their `.rune` specs — so they carry no `deno.json`
and have nothing to type-resolve; running `rune sync` on them writes the
same JSR-pinned config (cake's README shows how to repoint
`@mrg-keystone/rune` at a local keep checkout). `rune-studio/` is a
standalone Vite app with its own lockfile (excluded from the workspace tasks,
run via `deno task studio`); `fixtures/` has its own `deno.json` too.

Key root import aliases: `@/` → `src/`, `@core/` → `src/core/`, `@rune/` →
`src/rune/`, `@keywords` → `lang/keywords.json`, `#assert` →
`keep/src/assert/mod.ts` (in-tree; generated projects get
`jsr:@mrg-keystone/rune@^4/assert`).

## Layering inside the engine (`src/`)

The engine practices the architecture it enforces (hexagonal, the same rules
`rune lint` applies to generated projects):

- `src/bootstrap/` — composition root: arg dispatch, the `rune lint` verb's
  driver (inlined here rather than under `entrypoints/`: bootstrap calls the
  flag parser and printers that `src/rune/entrypoints/cli.ts` defines, then
  runs the coordinators' `runPipeline` over the 27 rules),
  Rust-helper resolution. `config.ts` is a build-time script that writes
  `src/core/dto/lsp-config.ts`.
- `src/core/` — shared kernel: `dto/types.ts` (pipeline/rule contracts, Zod
  schemas) and `business/classify/` (the pure path → {module, layer}
  classifier every lint rule shares).
- `src/rune/` — the domain engine:
  - `entrypoints/` — one folder per CLI verb (`sync`, `check`, `manifest`,
    `dev`, `init`, `update`, `version`, `validate`; `stop` lives in `dev/`,
    and `lint` has no folder — bootstrap dispatches it inline) plus `cli.ts`
    (the lint verb's arg parsing and printers) and `spec-root.ts`
    (root/core-spec resolution).
  - `domain/business/` — pure logic, no I/O: `rune-parse` (the parser of
    record), `rune-manifest` (the code generator), `rune-sync` (the
    reconcile planner), `rune-sig`, `rune-modifiers`, `rune-bindings`,
    `rune-stubs` (ghost stubs), `rune-heal` (heal rules), the 27 lint
    `rules/`, and the artifact contract (`artifact/`, `governance/`,
    `migrate/`, `lint-config/`).
  - `domain/data/` — the I/O adapters: `filesystem`, `lsp`, `llm` (OpenAI
    lint suggestions), `project`.
  - `domain/coordinators/pipeline/` — `runPipeline`, wiring rules over the
    filesystem context.

Layer direction (enforced by the `layer-restrictions` rule on itself and on
generated projects). Each arrow lists a layer's complete allowed import set —
importing any layer outside it is a violation: `business → {business, dto}`,
`data → {data, dto}`, `coordinators → {coordinators, business, data, dto}`,
`entrypoints → {entrypoints, coordinators, business, data, dto}`,
`dto → {dto}`, `bootstrap → everything`. `mod-root.ts` belongs to none of
these layers: it sits at the module root, outside the layer directories, so
the shared classifier returns `layer: "unknown"` for it (with a separate
`isModRoot` flag), and `layer-restrictions` skips `unknown` on both ends — a
layer-less file's own imports are never layer-judged, and an import that maps
to no layer (another module's `mod-root.ts`) passes the layer rule.
Cross-module traffic, `mod-root.ts` included, is the separate
`module-isolation` rule's jurisdiction ([05-linter.md](05-linter.md)).

## Cross-boundary contracts

These are the seams that keep the pieces from drifting — most are
machine-checked (see [10-testing-and-verification.md](10-testing-and-verification.md));
each row's Guard column is authoritative for how, or whether, it's checked:

| Contract | Between | Guard |
| --- | --- | --- |
| **Decorator-stack lockstep** — the `class-validator` / `class-transformer` / `reflect-metadata` / `@danet/swagger` ranges rune writes into generated projects (`REQUIRED_IMPORTS` in `src/rune/entrypoints/sync/mod.ts`) must byte-equal keep's own `keep/deno.json` ranges. Drift breaks the single-copy invariant (class-transformer's `@Type` store is per-copy) → nested validation silently degrades or `bootstrapServer()` throws at load. | src ↔ keep | `scripts/check-keep-lockstep.ts` (`deno task check:lockstep`) |
| **Framework + assert pins share a major** (`@^4` / `@^4/assert`) — retarget both on every keep major. *Not* covered by the lockstep guard; kept by hand (`docs/assert-runtime.md`). | generated projects ↔ keep | manual |
| **`x-keep-process`** — the OpenAPI vendor extension carrying `order`/`dependsOn`/`bind`/`flows`/`optional`/`stub`. Rune computes it from the spec; keep's self-verification surfaces consume it — the interactive cake docs page (`/docs/<module>`), the system map, and the headless runner (`exerciseEndpoints`), all runtime code under `keep/src/foundation/` ([07-cake.md](07-cake.md)). | src ↔ keep | `e2e/` acceptance suites |
| **Heal-rules shape** — the slug → suggestion JSON rune generates and keep executes. | src ↔ keep | e2e + `rune-heal-todo` lint |
| **Codegen templates** — the engine's `DEFAULT_TEMPLATES` is the canonical copy, mirrored byte-identically into `keywords.json → codegen.templates` — the one seam where authority flows *into* `keywords.json` (the language artifact). On drift, `scripts/gen-codegen-templates.ts` rewrites the keywords.json side from the engine (the engine side is the hand-edited one). | src ↔ lang | `scripts/gen-codegen-templates.ts` — manual regenerator (consistency checked by L3/L6/L7, *not* regenerated-and-diffed by the Drift gate) |
| **Grammar + highlights** — `lang/grammar/grammar.js` and `lang/queries/highlights.scm` generated from `keywords.json`. | lang internal | `scripts/generate.mjs` + Drift gate |
| **Artifact JSON schema** — `lang/artifact.schema.json` emitted from the engine's Zod `ArtifactSchema`. | src ↔ lang | `scripts/gen-artifact-schema.ts` — regenerable, *not* drift-gated (no gate regenerates or diffs it; L1 only validates `keywords.json` + fixtures against the Zod schema, and the Drift gate diffs only grammar + highlights) |
| **Canonical shape docs** — `docs/canonical-shape.md` generated from `keywords.json → canonicalPaths`. | lang ↔ docs | `scripts/gen-shape-docs.ts` — regenerable (run via `deno task setup`), not gated: no drift check verifies it against `keywords.json` |
| **Rust ↔ TS parser parity** — `rune-lsp` diagnostics must mirror exactly what the TS parser of record enforces (structure + shape, deliberately no scope rules). | lang ↔ src | corpus-parity tests in `lang/lsp/src/main.rs` |
| **Skill references** — `lang/docs/{spec,constraints,cookbook}.md` + `examples/todos/*.rune` copied into `claude/skills/rune:spec/references/`. | lang ↔ claude | `scripts/sync-spec-skill-refs.ts --check` |
| **Agent guardrail** — the shared "never crawl the filesystem" block injected into every `claude/agents/*.md`. | scripts ↔ claude | `scripts/sync-agent-guardrail.ts --check` |

## The canonical generated-project shape

What rune generates *into user projects* is itself specified —
`docs/canonical-shape.md`, auto-generated from `keywords.json → canonicalPaths`.
The composed monorepo (pinned by `rune init`, recorded per-project in
`spec/misc/layout.md`):

```
<git-root>/
  deno.json     # Deno workspace ["./ui", "./server"]
  serve.ts      # Deno.serve(Backend(Frontend)) — Backend from ./server/bootstrap/mod.ts
  ui/           # the sprig UI package
  server/       # THE CODEGEN ROOT
    bootstrap/  #   mod.ts + config.ts (create-once), modules.ts (regenerated), stubs.ts (ghost)
    src/
      core/     #   shared kernel generated from core.rune (see spec/runes/ below — never relocated here): business/, data/<service>/, dto/
      <module>/ #   mod-root.ts + domain/{business,data,coordinators}/ + entrypoints/ + dto/
  spec/         # shared authoring at the git root — the durable artifact
    manifest.json # self-describing artifact manifest — formatVersion + per-subtree {class, owner, producer} (see durability manifest below)
    runes/      #   DURABLE home of the .rune specs — one per module, + core.rune (seeded by rune init); sync reads here, never relocates
    misc/       #   data.json, cake.json, scenarios/, layout.md (heal-rules.json's location is undecided — see durability manifest below)
    ui/         #   sprig prototype + design system
    product/    #   spec.md + user-stories.md (rune:scope output)
    contract/   #   the ratified contract: durable hand-authored binding.md + machine faces (OpenAPI + typed client)
```

`spec/runes/` is the **durable home** of the `.rune` specs — they are
authored and *kept* there. `rune sync` **reads** them in place and generates
code into `<pkg>/src/`; it **never relocates a spec out of `spec/`**. The
generated `src/<module>/` tree is a *projection* of the spec — regenerable,
spec-owned — while `spec/runes/` is the durable source of record. This
supersedes any earlier "staging dir" framing in which sync moved
`spec/runes/<m>.rune` into `src/`: the spec now stays put, and after a build
`spec/runes/` is never emptied.

`core.rune`'s durable home is `spec/runes/core.rune` at the git root — where
`rune init` seeds it and where it stays (like every other spec, it is never
relocated into `src/`). Core-spec resolution (`spec-root.ts`) is one ordered
candidate list, first existing file wins. The numbered list below is
authoritative. The durable home (#1) is probed at the git root only — it is
never nested under the codegen root — and the last-resort bare file (#10) is
probed at the codegen root only. The four legacy layouts in between (#2-#9)
each get a git-root probe immediately followed by a codegen-root probe
before the next layout is tried:

1. `spec/runes/core.rune` at the git root (the durable home)
2. `specs/runes/core.rune` at the git root
3. `specs/runes/core.rune` under the codegen root (the legacy nesting old fixtures use)
4. `spec/core.rune` at the git root
5. `spec/core.rune` under the codegen root
6. `specs/core.rune` at the git root
7. `specs/core.rune` under the codegen root
8. `src/core/core.rune` at the git root
9. `src/core/core.rune` under the codegen root
10. bare `core.rune` at the codegen root (last resort)

So the durable git-root copy beats every legacy copy, and within any one
legacy layout the git-root copy beats the copy nested under the codegen root
— and a legacy layout earlier in the list beats every probe (git-root or
codegen-root) of a later layout. The whole chain is then re-probed in the
same order for `.in-prog.rune` drafts — a finalized core always beats a
draft.

Structural rules enforced by the linter: forbidden directory names anywhere
(`lib`, `modules`, `internal`); flagged loose-file names (`utils`, `helpers`,
`common`, `shared`, …); `mod-root.ts` is a module's only external import
surface; `./` imports for same-directory, `@` aliases cross-directory, `#`
aliases for external packages. Test naming: exact filenames, one co-located
test file per generated *code* folder (`test.ts` beside a business `mod.ts`,
`int.test.ts` in a coordinator folder, `smk.test.ts` in a data-adapter folder,
`e2e.test.ts` in an entrypoint folder) — literal names, not
`<stem>.int.test.ts`-style suffix patterns. `dto/` and `bootstrap/` are
generated folders that carry no co-located test file
([04-codegen.md](04-codegen.md)).

Note: this repo's own `spec/` directory (where this document lives) is
documentation about the rune project — the `spec/` convention above describes
*generated user projects*.

## The durability manifest — `spec/` as a portable artifact

A generated project's `spec/` is not a scratch area rune and sprig happen to
share — it is a **self-describing, versioned artifact** that either toolchain
(or a future third) can read and build against *without importing the other's
repo*. A durable, hand-editable **`spec/manifest.json`** at the artifact root
makes it self-describing: it declares a `formatVersion` and, per subtree, a
`{ class, owner, producer }` triple, where **class** is one of `durable`,
`merge`, or `derived`. Both repos read the manifest to learn the layout +
version and fail loud on an out-of-range artifact.

The three classes define exactly what a build may do to a path:

| Class | Contract — what a build may do to it |
| --- | --- |
| **durable** | Hand/agent-authored source. A build may **read** it and may **append additively + idempotently** (a re-run on unchanged input produces no diff), but must **never rewrite, rename, move, or delete** it as a build side effect. |
| **merge** | Machine-scaffolded, hand-enriched, **additive-only**. A build **adds** entries and **never clobbers** hand enrichments. |
| **derived** | Regenerable from `durable` + `merge`; **never a source of truth**; safe to delete and rebuild. Every `derived` artifact carries a **provenance hash** of its source — a universal, class-wide mechanism that makes staleness mechanically detectable, not a property of select paths; `.gitignore`-eligible. |

The classification below is the **on-disk expression of the shared artifact
contract** — a bedrock rule, owned by neither toolchain:

| Class | Paths under `spec/` |
| --- | --- |
| **durable** | `manifest.json`; `product/spec.md` + `user-stories.md`; `runes/*.rune` + `core.rune`; `ui/**` (design-system canonical `theme.css`, `<app>-prototype/` presentation + `objects/` + `commands.json`, `breakdown/`) **except the derived twins listed below**; `contract/binding.md`; `misc/cake.json` + `scenarios/`; `misc/<m>.data.notes.json` |
| **merge** | `misc/data.json`; `misc/heal-rules.json` (location under coordination — may live in `spec/misc/` or `server/fixtures/`; **[DECIDE]**) |
| **derived** | `contract/draft/`, `contract/openapi.json` (hash-stamped), `contract/client/` (hash-stamped); design-system twins `ui/design-system/theme.cdn.css`, `ui/design-system/css-variables.json`, `ui/design-system/manifest.json`; `misc/data.review.html`; `misc/layout.md`; build scratch (`misc/build/**`, relocated **out of `spec/`**) — the "(hash-stamped)" tag on `openapi.json`/`client/` is emphasis, not a two-path special case: every path in this row carries the class's provenance hash per the `derived` contract above; those two are called out because their staleness crosses the repo boundary (they're what sprig builds against) |

Precedence when paths overlap: the manifest carries one `class` per subtree,
and the **most specific path wins** — a named `derived` entry (e.g. the
design-system twins) overrides the broader `durable ui/**` glob that would
otherwise cover it. A builder resolving a path's class always matches the
longest applicable entry before falling back to a shorter one.

The rule stated plainly: **a build never destructively mutates a `durable`
path.** You can `git clean` every `derived` path and rebuild to byte-identical
output; you can hand-edit any `durable` path and a rebuild preserves it;
`merge` paths only ever grow. This rule, plus `spec/manifest.json`, is what
makes `spec/` a **portable artifact**: it is the basis for a cohesive shared
spec with **no cross-repo code dependency** — the frontend and backend
toolchains meet only at the durable `spec/` artifact, each reading the
manifest to know what it may touch, and neither invoking (or knowing) the
other at build time.

This contract — the class table, the never-mutate rule, the manifest format —
is defined once in bedrock's artifact spec, outside both toolchains; each
conforms to it.

## Naming conventions

- Modules are kebab-case directories (`[MOD] my-feature` → `src/my-feature/`).
- Coordinators: `<noun>-<verb>/` (from `[REQ] noun.verb`).
- DTO files strip the `Dto` suffix and kebab-case; a `[TYP]` colliding with a
  DTO stem takes a `-type` suffix.
- Generated file banners mark ownership: DO-NOT-EDIT (spec-owned, regenerated)
  vs "Edit the body" (dev-owned, create-once). One further lifecycle exists —
  **ghost** (`bootstrap/stubs.ts` only): it carries the DO-NOT-EDIT banner and
  regenerates like a spec-owned file, but sync also deletes it once every
  `[TYP:ext]` input has a real producer. The banner doubles as the
  delete-guard: a hand-written `stubs.ts` without it is neither overwritten
  nor deleted — it disables ghost stubs instead.
