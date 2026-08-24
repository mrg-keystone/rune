## `lang/keywords.json` — the artifact

The machine-readable definition of the language and **the single source of
truth**: the tree-sitter grammar, the syntax highlighter, the Studio's
registry, the canonical project layout, and the lint rule set are all derived
from this one file (edited by hand or visually in Rune Studio). The codegen
templates it carries flow the *other* way — authored in the engine, mirrored
in, and authoritative over the engine defaults whenever an artifact is
supplied (the reverse-flow row below).

Top-level shape, validated by the engine's Zod `ArtifactSchema`
(`lang/artifact.schema.json` is a derived JSON-Schema export of it for
editors/tooling, regenerable but ungated):

| Field | Shape | Edited by | Consumed by / delegated owner |
| --- | --- | --- | --- |
| `name`, `schemaVersion`, `description` | strings; `schemaVersion` is semver, currently `1.0.0` — identity prose | hand | `rune validate` and the engine at boot |
| `palette` | the Mesa Vapor color map | hand | grammar/highlighter — `captureColors()` maps it onto the `@rune.*` captures ([the grammar](02-the-grammar-lang-grammar.md)) |
| `architecture` | the layer→allowed-imports map, the path→layer classifier, and a nested `architecture.reexportAllowed` re-export allow-list | Studio lens (Architecture) — `reexportAllowed` itself has no lens edit UI, hand-only | the intended source for the `layer-restrictions` and `barrel-discipline` lint rules once artifact-driven rule instantiation is wired ([governance, built not yet wired](../05-linter/03-governance-built-not-yet-wired.md)); today those rules hardcode their own logic instead — `layer-restrictions`' adjacency table (no external config) and `barrel-discipline`'s barrel criteria (`mod-root`/`poly-mod`/the `src/bootstrap/` prefix) ([rule families](../05-linter/01-rule-families.md)) |
| `tags[]` | one entry per language tag (`[REQ]`, `[MOD]`, `[ENT]`, `[PLY]`, `[CSE]`, `[NEW]`, `[RET]`, `[TYP]`, `[DTO]`, `[NON]`, `[SRV]`), each with `id`, `tag`, `label`, `indent`, `follows` (the syntactic shape after the tag), `group`, `syntax`, `summary`, `rules[]`, `color`, and an optional `synonyms[]` of alternate literals recognized as the same construct | hand or Studio lens (Constructs) | grammar generation, the parser, the highlighter ([tags](../02-language/02-tags.md)) |
| `boundaries` | a shared `color`/`description` plus `prefixes[]`, the well-known single-colon service prefixes (`db:`, `fs:`, `mq:`, `ex:`, `os:`, `lg:`) | hand | editors/Studio tokenizer, for painting only |
| `builtins[]` | the built-in type names: the primitives (`string`, `number`, `boolean`, `void`, `Uint8Array`, `Class`), the `Primitive` alias, and the generic/utility containers (`Array`, `Record`, `Map`, `Set`, `Promise`, `Partial`, `Required`, `Pick`, `Omit`, `ReturnType`) | hand | the highlighter — painted as builtins rather than resolved as `[TYP]`/DTO references |
| `tokens` | the non-tag token style map (`comment`, `dtoSuffix`, `noun`, `verb`, `builtin`, `fault`, `string`): a `color` + `description` each, plus `suffix: "Dto"` on `dtoSuffix` and `italic` on `comment` | hand | the Studio's registry-driven tokenizer ([Rune Studio](04-rune-studio-rune-studio.md)) |
| `modifiers[]` | the `[TYP]` bracket modifiers (`core`, `ext`, `uuid`, `email`, `url`, `nonempty`, `json`, `int`, `min`, `max`, `positive`, `example`, `from`), each with `appliesTo` and, where applicable, a `kind` and the `decorator` it emits — the string/number-typed constraint modifiers (`uuid`…`positive`) carry both, `kind: "constraint"` and the class-validator decorator; `from` carries `kind: "source"` but no `decorator`; `core`/`ext` carry neither; `example` is the type-agnostic (`Requires: any`) exception — it carries no class-validator `kind`/`decorator` and instead emits the swagger `@ApiProperty({ example })` decorator | hand | codegen's class-validator/swagger decorator emission ([types, DTOs, and constraint modifiers](../02-language/04-types-dtos-and-constraint-modifiers.md)) |
| `lint[]` | 39 rule instances split by `target: "spec" \| "generated"` (21 `spec` + 18 `generated`), each with `type`, `severity`, `enabled`, `params`, `message` | hand or Studio lens (Lint) | the linter ([rule families](../05-linter/01-rule-families.md)) |
| `bindings` | spec element → path-slot mappings (case style, suffix stripping) | hand | codegen file placement — fills the placeholder path-slots in `canonicalPaths` ([the canonical generated-project shape](../01-architecture/05-the-canonical-generated-project-shape.md)) |
| **`codegen.templates` / `codegen.policies`** *(reverse flow: engine → artifact)* | the scaffolding templates and the regenerate/create-once/prunable lifecycle per role | **engine-mirrored** — authored engine-side (`DEFAULT_TEMPLATES` in `rune-manifest`), byte-mirrored in by `scripts/gen-codegen-templates.ts` (re-run after an engine template edit); the mirrored copy is itself hand-editable and overridable via `--artifact`/the Studio | `planManifest`, which merges a supplied artifact's copy over the engine defaults at generation time (partial maps allowed) — the L6 property ([the verify ladder](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)) |
| `canonicalPaths` | the full generated-project directory contract | hand | `docs/canonical-shape.md` generation ([01-architecture.md](../01-architecture/00-overview.md)) |
| `profiles[]` | optional array of `{id, label?, vars}` — per-target codegen profiles (ADR 0008's second axis); when declared, must be gap-free — every profile defines the same var keys (a meta-validator check, pinned by L1's profile-gap fixture) | hand | nothing yet — schema + check exist; the pick/clone UI is a scoped follow-up ([12-history-and-roadmap.md](../12-history-and-roadmap/00-overview.md)). The live `lang/keywords.json` declares none |

Rationale worth keeping alongside the shapes above:

- **`tags[]`** — only `[NEW]` declares a synonym (`[CTR]`); `[NEW]` is
  canonical, so the alias exists without every tag needing one
  ([02-language.md](../02-language/00-overview.md)).
- **`boundaries`** — the block only paints; it doesn't gate. The *legal*
  prefix set at check time is whatever `[SRV]`s declare, not this list
  ([02-language.md](../02-language/00-overview.md)).
- **`lint[]`** — rule *logic* lives in code; rule *instances* live here.
  Artifact-driven rule instantiation is built but **not yet wired** to the
  CLI — the pipeline runs its 27 rules hard-coded from `mod-root.ts` today
  ([governance, built not yet wired](../05-linter/03-governance-built-not-yet-wired.md)).
  Once the rule-registration swap lands, an artifact will be able to retune
  severities/params without an engine change (ADR 0004).
- **`codegen.templates`/`codegen.policies`** — the artifact wins at
  generation time so `--artifact` and the Studio can change generated
  bodies with zero engine change (the L6 property).

One entry per shape-bearing collection, straight from the live
`lang/keywords.json`:

`tags[]` — `[NEW]`, the only tag carrying a `synonyms[]` entry:

```json
{
  "id": "new",
  "tag": "[NEW]",
  "label": "Constructor",
  "indent": 4,
  "follows": "identifier",
  "color": "#89babf",
  "group": "Flow & modifiers",
  "syntax": "[NEW] class",
  "summary": "Constructor shorthand — instantiates a class and adds it to scope. No parentheses, no return type; construction details are an implementation concern.",
  "rules": [],
  "synonyms": ["[CTR]"]
}
```

`modifiers[]` — a constraint entry (`kind` + `decorator`) beside the two
routing/source entries that don't share its shape:

```json
{
  "id": "uuid",
  "token": ":uuid",
  "label": "UUID",
  "appliesTo": ["typ"],
  "kind": "constraint",
  "decorator": "IsUUID",
  "param": "none",
  "syntax": "[TYP:uuid]",
  "description": "Constrains a string [TYP] to UUID format (class-validator @IsUUID)."
}
```

```json
{
  "id": "from",
  "token": ":from",
  "label": "From",
  "appliesTo": ["typ"],
  "kind": "source",
  "param": "text",
  "syntax": "[TYP:from=path]",
  "description": "Field-source binding (OpenAPI's parameter model): where this field is populated from at the HTTP boundary — path | path* | query | header."
}
```

```json
{
  "id": "core",
  "token": ":core",
  "label": "Core",
  "appliesTo": ["dto", "typ"],
  "syntax": "[DTO:core] / [TYP:core]",
  "description": "Routes an element to the shared kernel (src/core/…) instead of the current module."
}
```

`lint[]` — one instance:

```json
{
  "id": "barrel-discipline",
  "type": "barrel-discipline",
  "target": "generated",
  "severity": "warning",
  "enabled": true,
  "params": {},
  "message": "re-exports are only allowed in mod-root / poly-mod / bootstrap files"
}
```

The engine consumes the whole file via the `@keywords` import alias; `rune
sync/manifest --artifact <file>` and `parse(text, {tags})` let an edited
artifact drive recognition and generation without an engine change. Lint is
not yet part of that swap: artifact-driven lint instances are built but not
yet reachable from the CLI, and take effect only once the rule-registration
swap lands
([governance, built not yet wired](../05-linter/03-governance-built-not-yet-wired.md)).
`rune validate` meta-validates an artifact against the JSON schema. This file
is the catalogue owner for every artifact regenerated from `lang/keywords.json`
(or from the engine, in the codegen templates' reverse-flow case) but left
outside `deno task verify`'s drift gate — the complete set, three entries,
each ships stale silently until someone re-runs its generator by hand:

| Regenerable artifact | Generated by | Gating |
| --- | --- | --- |
| `lang/artifact.schema.json` — a JSON-Schema export of the engine's Zod `ArtifactSchema` | `scripts/gen-artifact-schema.ts` | ungated |
| the `codegen.templates`/`codegen.policies` mirror in this file | `scripts/gen-codegen-templates.ts` | ungated |
| `docs/canonical-shape.md`, generated from this file's `canonicalPaths` | `scripts/gen-shape-docs.ts` ([→11-release-and-distribution § 04](../11-release-and-distribution/04-build-from-source.md)) | ungated |

Only `scripts/generate.mjs`'s output — `lang/grammar/grammar.js` +
`lang/queries/highlights.scm` — is drift-gated: byte-diffed against
regeneration by
[the verify ladder](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s
Drift gate, which is the authority on what that gate checks and how; this
file owns only the catalogue above, not the gate mechanics.

