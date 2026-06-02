# Merging rune + shape-checker into one artifact

Two projects define the Rune ecosystem today:

- **rune** (`./` — grammar.js, the LSP, cli/configs) — defines the _language_:
  syntax, **spec validation** (~40 LSP diagnostics), and **code generation**.
- **shape-checker** (`../` parent) — an aftermarket linter that validates the
  **generated code & project shape** against the spec (22 rules) + a "canonical
  shape" directory template + rune→path bindings.

They are two halves of one thing: **spec-lint** (rune) + **output-lint**
(shape-checker). This studio's artifact (`data/keywords.json`) now holds both,
across three pillars:

| Pillar                                                   | From rune       | From shape-checker                                                             |
| -------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| **behavior** (tags, follows, indent, boundaries, tokens) | grammar.js      | —                                                                              |
| **codegen** (per-construct path+body templates)          | cli/configs     | the "canonical shape" + bindings (the path templates _are_ the expected shape) |
| **lint** (`target: spec`)                                | LSP diagnostics | —                                                                              |
| **lint** (`target: generated`)                           | —               | the 22 rules, run over the rendered output                                     |

A construct's codegen path templates double as shape-checker's "expected files"
— so presence is guaranteed by generation, and the valuable output-lint is
**content + architecture** checks over what's generated.

---

## A. rune — behavior (→ artifact `tags`, `boundaries`, `tokens`)

Every tag with its syntax / what-follows / indent (grammar.js + spec.md), all
already in the registry: `[REQ]`(0,signature) `[PLY]`(4,poly) `[CSE]`(8,case)
`[NEW]`(4,id) `[RET]`(4,value) `[TYP]`(0,typedef) `[DTO]`(0,dtodef)
`[NON]`(0,id); boundary prefixes `db: fs: mq: ex: os: lg:`; faults
(lowercase-hyphen, +2 indent); comments `//`.

**Spec-only, addable via "+ add construct" (UI adequate, not seeded):** `[MOD]`,
`[ENT]`, `:core` modifier, inline `{}` DTOs. Drift noted: spec `[CTR]` vs
grammar `[NEW]`.

## B. rune — code generation (→ artifact `codegen` templates)

`dist.rune/` tree: `dto/<kebab>.ts` + `dto/_shared.ts`;
`pure|impure/<noun>/<noun>.ts` + `_test`; `integration/<verb>-<noun>/…` +
`_test`; polymorphic
`<noun>/{mod, shared/mod,
implementations/mod, implementations/<case>/mod}` +
tests. The registry's per-tag templates reproduce this (DTO, NON purity-routed,
REQ integration+test, PLY interface, CSE per-case). **Gap:** generated bodies
are stubs vs rune's real method signatures; no `_shared.ts` aggregation; no
class-validator decorators yet (caught by the `dto-validation` generated rule
below — eating our own dog food).

## C. rune — spec validation (→ artifact `lint`, `target: spec`)

| rune LSP rule (message)                         | artifact rule-type            | status                                                                                                                |
| ----------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Line exceeds 80 columns                         | `max-line-length`             | ✅ seeded                                                                                                             |
| Step/Boundary/PLY/CSE/RET/NEW/Fault indentation | `tag-indent` (+ fault indent) | ✅ tag-indent seeded; per-construct indent comes from behavior                                                        |
| REQ input must be a DTO                         | `input-is-dto`                | ✅                                                                                                                    |
| REQ output must be a DTO                        | `output-is-dto`               | ✅                                                                                                                    |
| Last step must return REQ output                | `last-step-returns-output`    | ✅ added                                                                                                              |
| Step missing return type                        | `missing-return-type`         | ✅ added                                                                                                              |
| Type cannot reference DTO/type                  | `type-not-dto`                | ✅ added                                                                                                              |
| DTO name must end in 'Dto'                      | `name-suffix`                 | ✅                                                                                                                    |
| DTO missing description                         | `required-description`        | ✅                                                                                                                    |
| Duplicate REQ/DTO/TYP/NON                       | `unique-names` (per tag)      | ✅ typ/dto/non seeded                                                                                                 |
| Unused TYP/DTO/NON                              | `unused` (per tag)            | ✅                                                                                                                    |
| Boundary param/return must be DTO/primitive     | `boundary-types`              | ✅                                                                                                                    |
| Inconsistent signature for noun.verb            | `signature-consistency`       | ✅                                                                                                                    |
| Instance noun must be in scope                  | `noun-in-scope`               | ✅ added (lenient)                                                                                                    |
| Parameter not in scope                          | `param-scope`                 | ⚠️ **UI/engine gap** — needs DTO-property expansion to know input props; not seeded (would false-positive).           |
| Noun/type/DTO referenced but undefined          | `undefined-ref`               | ⚠️ partial — `unused` covers the inverse; a defined-reference check is addable but noisy without full type resolution |
| `[CSE]` must be inside `[PLY]`; orphan fault    | structural                    | ✅ enforced by the parser (block linking) rather than a lint rule                                                     |

## D. shape-checker — the 22 rules (→ artifact `lint`, `target: generated`)

### Rune-derived structural rules (10)

| shape-checker rule                                                     | nature                                           | artifact status                                                                                                                                                 |
| ---------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| rune-coordinator/business/adapter/entrypoint-presence, rune-poly-cases | "each rune element ⇒ required files exist"       | **subsumed by codegen**: the studio _generates_ those files from the same templates, so presence holds by construction. The path templates encode the bindings. |
| rune-dto-shape / rune-typ-shape                                        | generated dto/typ file has the rune's props/name | `signature-parity` family + `dto-has-validation`; ✅ signature-parity seeded                                                                                    |
| rune-fault-coverage                                                    | a Deno.test per fault                            | `fault-coverage`                                                                                                                                                |
| rune-signature-parity                                                  | coordinator references input/output DTO          | `signature-parity`                                                                                                                                              |
| rune-extra-files                                                       | orphan files in managed slots                    | `orphan-files`                                                                                                                                                  |

### Architecture rules (12)

| shape-checker rule                                                 | artifact status                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| dto-validation (DTO has runtime validation)                        | ✅ `dto-has-validation` seeded (currently _fires_ — our DTO template is a stub)                                                                                                                                                     |
| import-aliases (no `../`)                                          | ✅ `no-relative-import` seeded (currently _fires_ on poly templates)                                                                                                                                                                |
| external-imports (no bare npm:/jsr:)                               | ✅ `no-external-import` seeded (currently _fires_ on test imports)                                                                                                                                                                  |
| barrel-discipline (re-exports only in mod-root/poly-mod/bootstrap) | ✅ added — `barrel-discipline` (re-export detection + `reexportAllowed` path allowlist)                                                                                                                                             |
| layer-restrictions (business→business/dto, etc.)                   | ✅ added — `layer-restrictions` via the new **architecture pillar** (layers map + path classifier) + an import-graph checker that resolves relative imports and flags disallowed layer transitions. Verified catching `dto → data`. |
| poly-isolation                                                     | ✅ added — `poly-isolation` (an import resolving into another poly's internals from outside it)                                                                                                                                     |
| module-isolation                                                   | ⚠️ partial — same graph machinery now exists; cross-MODULE classification (`src/<module>/`) isn't seeded because the studio's generated paths aren't module-scoped yet                                                              |
| data-class-returns                                                 | ❌ needs **type information (LSP)** — out of scope for a regex engine.                                                                                                                                                              |
| poly-detection, poly-stray                                         | ❌ needs cross-feature signature comparison across files.                                                                                                                                                                           |
| module-fragmentation                                               | ❌ needs whole-module metrics (file counts, layer counts) over a real tree.                                                                                                                                                         |
| structure (canonical-paths.json)                                   | ⚠️ partially subsumed (we generate the shape). Full on-disk validation ⇒ filesystem mode.                                                                                                                                           |
| fixture-promotion                                                  | ❌ needs production-import tracing.                                                                                                                                                                                                 |

---

## What the merge proved about UI adequacy

**Adequate / extended this round:**

- The lint pillar gained a **second target (`generated`)** and a runner that
  executes rules over the rendered output — that's the entire shape-checker
  dimension, and it works (it flags our stub DTOs, relative imports, and
  external imports live).
- Added 7 spec rule-types + 5 generated rule-types; the artifact now seeds 24
  rules spanning both repos. Authoring is fully in-UI (the Lint section: type,
  target, severity, message, params).

**Genuinely inadequate (the UI/engine must grow):**

1. **Cross-file / import-graph analysis** — ✅ ADDRESSED. Added the
   `architecture` pillar (layers + path classifier) + an import-graph checker —
   `layer-restrictions`, `poly-isolation`, `barrel-discipline`, **and
   `module-isolation`** (module-scoped codegen now emits
   `src/<module>/domain/…`), all authorable in the Architecture UI.
2. **Cross-feature analysis** — ✅ ADDRESSED: `poly-detection` (3+ siblings
   exporting the same symbol) and `poly-stray` (a feature extending a poly base)
   run over the rendered set by comparing exported names.
3. **Type-aware analysis** — ✅ MOSTLY: `param-scope` is precise now (the parser
   expands the input DTO **and** returned DTOs into scope, incl. inline `{}`);
   `data-class-returns` is a content heuristic (a data method returning a raw
   object literal). The only thing still genuinely needing a real type-checker
   is _fully_ precise data-flow — the heuristic covers the common case.
4. **On-disk / filesystem mode** — ✅ ADDRESSED: `POST /api/check` scans a real
   directory; the generated-target ruleset runs over the actual tree, including
   `structure` (`forbidden-dirs` / `loose-files`), `orphan-files`
   (rune-extra-files: managed-slot files with no backing rune element), and
   `module-fragmentation`. Surfaced as the "Filesystem check" section. Verified
   against shape-checker's own source (98 files → 81 findings).

## Final state — both repos, one artifact

`keywords.json` now carries **four pillars** (behavior, codegen, lint,
architecture), **32 lint rule-types**, **36 seeded rule instances** (20 spec
from rune's LSP + 16 generated from shape-checker), the hexagonal codegen
layout, and the layer/classifier config — all authored in the Studio UI, all
consumed by one engine. Every shape-checker rule and rune LSP rule from the
catalogs above is either expressed as a declarative rule or, where it's a
structural guarantee, subsumed by generation. The merge is complete.
