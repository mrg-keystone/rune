## The grammar (`lang/grammar/`)

### What it is

A **tree-sitter** grammar, editor-only by decision (ADR 0003 — the TS engine
is the parser of record).

### Generation chain

`grammar.js` is generated from `keywords.json` by `scripts/generate.mjs`.
Most of the grammar falls out of the artifact's own data
([01-lang-keywords-json-the-artifact.md](01-lang-keywords-json-the-artifact.md));
a handful of constructs need hand-written recognition instead — five external
tokens via a C scanner, four of them keyed on indentation (`typ_desc`,
`dto_desc`, `non_desc`, `fault_line`) and the fifth, `service_prefix`, keyed
on a `::`-lookahead instead — plus four more whose shape defeats a plain
grammar rule:

| Token | Example | Why it needs special handling |
| --- | --- | --- |
| `typ_desc` | the description text under `[TYP] id: string` | indentation-keyed — no closing delimiter marks where it ends |
| `dto_desc` | the required description text under `[DTO] TaskDto: id, title` | indentation-keyed |
| `non_desc` | the description text under `[NON] task` | indentation-keyed |
| `fault_line` | `not-found timed-out invalid-id` | indentation-keyed — a fault sits 2 spaces deeper than its step: indent 6 at top level (the step sits at 4), indent 10 inside a poly case (the case's step sits at 8) |
| `service_prefix` | `db:` in `db:task.save(TaskDto)` | `::`-lookahead — the single-colon boundary prefix must be disambiguated from a `::` static call |
| `@ METHOD /template` clause | `@ GET /tasks/{id}` in `[ENT] http.getTask @ GET /tasks/{id}(...)` | anchored against `@docs`/`//` — without anchoring it collides with the `@docs` line or a `//` comment |
| `Dto`-suffixed references | `TaskDto` | suffix-classified — recognized by suffix rather than resolved like an ordinary `[TYP]`/builtin reference |
| `(s)`/`(es)` array suffixes | `url(s)` (→ `urls: string[]`, per [02-language/04](../02-language/04-types-dtos-and-constraint-modifiers.md)) | suffix-marked — the parenthesized suffix, not the bare word, is what marks a property as an array |
| string-literal enum types | `[TYP] verb: GET \| POST \| DELETE` | leniently parsed — a bare-word union body is recognized as a string-literal enum rather than as a type reference |

Full construct semantics live where each is defined: boundary prefixes and
faults in
[02-language/03-requirements-and-steps.md](../02-language/03-requirements-and-steps.md),
array suffixes and string-literal enums in
[02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md),
the route clause in
[02-language/05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md).
This table covers only what makes each one a grammar special case.

### Build & publish pipeline

`scripts/build-grammar.ts` is the full out-of-band pipeline: regenerate
`grammar.js` + `highlights.scm` → `tree-sitter generate` → WASM build → copy
into `rune-studio/static/` (`rune-tree-sitter.wasm` + `rune-highlights.scm`).

**Example — propagating a recolor.** Say the `noun` capture's color changes:

1. Edit `keywords.json`'s `tokens.noun` entry by hand — the `tokens` map has
   no Studio lens ([08/01](01-lang-keywords-json-the-artifact.md) owns the
   field). Recoloring a *tag* instead goes through the Studio's Constructs
   lens, which edits that tag's own `color` in `tags[]`
   ([08/04](04-rune-studio-rune-studio.md)) — a different field, but one
   `captureColors()` aggregates from the same way (see Highlighting and
   palette, below).
2. `scripts/generate.mjs` (through `captureColors()` in
   `scripts/generate-core.mjs`) regenerates `grammar.js` and
   `lang/queries/highlights.scm` with the new `@rune.noun` color baked in.
3. `scripts/build-grammar.ts` reruns `tree-sitter generate`, rebuilds the
   WASM, and copies both into `rune-studio/static/` — invisibly, today,
   since the Studio's editor doesn't consume tree-sitter (see the table
   below).
4. Nothing automates the rest: the VS Code extension's bundle — the only
   runtime reader that stays hand-copied and staleness-prone; the other five
   supported editors with tree-sitter highlighting instead get the grammar
   compiled into `RUNE_DATA` by `rune install`
   ([08/03](03-the-rust-workspace-lang-parser-lsp-cli.md)) — must be
   re-copied by hand, and `lang/palettes/mesa-vapor.json` / `.hex` must be
   hand-updated to match, or they go stale silently.

Adding a keyword instead of recoloring follows the same first three steps
against `keywords.json`'s `tags[]`/`boundaries`/`tokens`; step 4's hand-only
tail is unchanged.

### Consumers, drift, and hand-maintained copies

| Artifact | Origin | Runtime consumer | Drift-gated? |
| --- | --- | --- | --- |
| `grammar.js` | Generated from `keywords.json` by `scripts/generate.mjs` | None — feeds `tree-sitter generate` at build time | Yes — one of the two files `gateDrift` diffs ([01-lang-keywords-json-the-artifact.md](01-lang-keywords-json-the-artifact.md)) |
| `lang/queries/highlights.scm` (canonical) | Generated by `buildHighlights()` in `scripts/generate-core.mjs`, via the pipeline above | None directly — its copies below do the actual coloring | Yes — the other file `gateDrift` diffs |
| `rune-studio/static/` copy (`rune-tree-sitter.wasm` + `rune-highlights.scm`) | Copied by `scripts/build-grammar.ts`'s publish step | None — the Studio's editor is the registry-driven tokenizer, not tree-sitter ([04-rune-studio-rune-studio.md](04-rune-studio-rune-studio.md)) | Presence only — the verify `grammar` gate reruns the pipeline and asserts the WASM landed; it never diffs content |
| Extension bundle (`tree-sitter-rune.wasm` + `highlights.scm`, checked in at the extension root) | Hand-copied from the build output after a grammar rebuild — no script produces it | Yes — the VS Code extension's semantic-tokens provider loads it via web-tree-sitter at runtime ([03-the-rust-workspace-lang-parser-lsp-cli.md](03-the-rust-workspace-lang-parser-lsp-cli.md)) | No — neither this pipeline nor the extension's package scripts refresh it, and no gate drift-checks it |
| `keywords.json`'s per-construct color fields (`tags[].color`, `boundaries.color`, the `tokens` map) | Hand-edited in `keywords.json`; `tags[].color` also has a Studio lens (Constructs, [08/04](04-rune-studio-rune-studio.md)) — [08/01](01-lang-keywords-json-the-artifact.md) owns the fields | Yes — `captureColors()` (`scripts/generate-core.mjs` and its Studio sibling) aggregates them onto the `@rune.*` captures | Indirectly — they feed the `grammar.js`/`highlights.scm` regeneration that `gateDrift` checks |
| `lang/palettes/mesa-vapor.json` | Hand-maintained reference copy of the named Mesa Vapor palette | None | No — unlike the grammar and codegen-template mirrors, no script or gate syncs it; updated by hand when the palette changes |
| `lang/palettes/mesa-vapor.hex` | Hand-maintained raw-hex swatch list (one bare six-digit hex per line, no `#`) | None | No |
| `lang/palettes/catppuccin.json` | Hand-maintained second named scheme (`"name": "Catppuccin Mocha"`), same `{name, description, colors}` shape as `mesa-vapor.json` | None | No |

The `highlights.scm` header is hardcoded — `buildHighlights()` always writes
the same `new/keywords.json` header line — so it is not a freshness signal:
a byte-identical header proves nothing about when a copy was last refreshed.

### Highlighting and palette

`lang/queries/highlights.scm` maps grammar nodes to
`@rune.{tag,noun,verb,type,param,boundary,fault,comment,chrome}` captures —
the single source of every editor's coloring, painted with the **Mesa Vapor**
color scheme. There's no single shared palette object those colors live in;
[08/01](01-lang-keywords-json-the-artifact.md) is the artifact owner and
holds each construct's color on its own field — a tag's on that tag's entry
in `tags[]`, the boundary-prefix color on `boundaries.color`, and
`noun`/`verb`/`builtin`/`fault`/`comment` colors in the `tokens` map.
`captureColors()` (`scripts/generate-core.mjs` and its Studio sibling)
*aggregates* colors from those fields rather than reading them off a
unified key set, and applies the result to the matching `@rune.*` capture
when it regenerates `grammar.js`/`lang/queries/highlights.scm`. A recolor
through any of those fields — hand edit, or, for `tags[].color`, the
Studio's Constructs lens ([08/04](04-rune-studio-rune-studio.md)) —
propagates the same way (see the worked example above).

Most captures map one-to-one onto the field that colors them; `type` is the
one exception, splitting across two: the `builtin` `tokens` entry colors a
bare builtin name, and the `Dto`-suffix classification that recognizes a
`Dto`-suffixed reference (see the external-token table above) colors the
other. `param` and `chrome` are the two captures 08/01 defines no
per-construct field for — coloring them isn't something a construct edit
can reach today.

The two files beside `mesa-vapor.json` are orphan reference swatches, not
inputs to anything: `lang/palettes/mesa-vapor.hex` is the current construct
colors as a raw-hex swatch list (one bare six-digit hex per line, no `#`),
and `lang/palettes/catppuccin.json` is a *second* named scheme
(`"name": "Catppuccin Mocha"`) in the same `{name, description, colors}`
shape, its `colors` the eight token keys (`tag`, `noun`, `verb`, `dto`,
`builtin`, `boundary`, `fault`, `comment`). As with `mesa-vapor.json`,
nothing in the repo reads either — `keywords.json`'s own per-construct
fields are the source of truth, so both ship as orphan reference swatches
(table above).

