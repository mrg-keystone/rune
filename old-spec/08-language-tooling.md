# Language Tooling — the Artifact, Grammar, Rust Helpers, and Rune Studio

> Part of the [project spec series](README.md). Sources: `lang/` (the language
> distribution), `rune-studio/` (the visual editor),
> `src/rune/domain/business/artifact/` (the artifact contract in the engine).

Alongside the machine artifacts below, the distribution ships prose docs under
`lang/docs/`: `spec.md`, `constraints.md`, `cookbook.md`, and `example.rune` —
the set the rest of the series cites (and rune:spec's skill mirrors). Two
siblings sit there unreferenced by any spec doc: `lang/docs/syntax-highlighting.md`
(the Mesa-Vapor palette + DuoTone highlighting philosophy) and
`lang/docs/codegen-enrichment.md` (the codegen JSDoc/`@ApiProperty` enrichment
spec) — shipped all the same.

## `lang/keywords.json` — the artifact

The machine-readable definition of the language and **the single source of
truth**: the tree-sitter grammar, the syntax highlighter, the Studio's
registry, the canonical project layout, and the lint rule set are all derived
from this one file (edited by hand or visually in Rune Studio). The codegen
templates it carries flow the *other* way — authored in the engine, mirrored
in, and authoritative over the engine defaults whenever an artifact is
supplied (see the `codegen.templates` bullet).

Top-level shape (validated by the engine's Zod `ArtifactSchema`;
`lang/artifact.schema.json` is a derived JSON-Schema export of it for
editors/tooling, regenerable but ungated): `name`,
`schemaVersion` (semver, currently `1.0.0`), and `description` — identity
prose; `palette` — the Mesa Vapor color map (see the grammar section);
`architecture` — the layer→allowed-imports map and the path→layer
classifier (the two pieces the Studio's Architecture lens edits), plus
`reexportAllowed`, the re-export allow-list the `barrel-discipline` rule
reads (no lens edits it — hand-edit only); and,
each defined below: `tags[]`, `boundaries`, `builtins[]`, `tokens`,
`modifiers[]`, `lint[]`, `bindings`, `codegen`, `canonicalPaths`, optional
`profiles`.

- **`tags[]`** — one entry per language tag (`[REQ]`, `[MOD]`, `[ENT]`,
  `[PLY]`, `[CSE]`, `[NEW]`, `[RET]`, `[TYP]`, `[DTO]`, `[NON]`, `[SRV]`),
  each with `id`, `tag`, `label`, `indent`, `follows` (the syntactic shape
  after the tag), `group`, `syntax`, `summary`, `rules[]`, `color`, and an
  optional `synonyms[]` of alternate literals recognized as the same
  construct — only `[NEW]` declares one (`[CTR]`; `[NEW]` is canonical,
  [02-language.md](02-language.md)).
- **`boundaries`** — the boundary-prefix block: a shared `color`/`description`
  plus `prefixes[]`, the well-known single-colon service prefixes (`db:`,
  `fs:`, `mq:`, `ex:`, `os:`, `lg:`) editors and the Studio tokenizer paint
  as boundaries. The *legal* prefix set at check time is whatever `[SRV]`s
  declare ([02-language.md](02-language.md)).
- **`builtins[]`** — the built-in type names: the primitives (`string`,
  `number`, `boolean`, `void`, `Uint8Array`, `Class`), the `Primitive` alias,
  and the generic/utility containers (`Array`, `Record`, `Map`, `Set`,
  `Promise`, `Partial`, `Required`, `Pick`, `Omit`, `ReturnType`) —
  highlighted as builtins rather than resolved as `[TYP]`/DTO references.
- **`tokens`** — the non-tag token style map (`comment`, `dtoSuffix`, `noun`,
  `verb`, `builtin`, `fault`, `string`): a `color` + `description` each, plus
  `suffix: "Dto"` on `dtoSuffix` and `italic` on `comment` — what the Studio's
  registry-driven tokenizer paints with.
- **`modifiers[]`** — the `[TYP]` bracket modifiers (`core`, `ext`, `uuid`,
  `email`, `url`, `nonempty`, `json`, `int`, `min`, `max`, `positive`,
  `example`, `from`), each with `appliesTo` and, where applicable, a `kind`
  and the class-validator `decorator` it emits. Not every modifier carries
  both: the constraint modifiers (`uuid`…`example`) have `kind` + `decorator`,
  but the routing/source modifiers emit no class-validator decorator — `from`
  has a `kind` but no `decorator`, and `core`/`ext` have neither.
- **`lint[]`** — 39 rule instances split by `target: "spec" | "generated"`
  (21 `spec` + 18 `generated`), each with `type`, `severity`, `enabled`,
  `params`, `message` (rule *logic* lives in code; rule *instances* live
  here — ADR 0004).
- **`bindings`** — spec element → path-slot mappings (case style, suffix
  stripping) that place generated files.
- **`codegen.templates` / `codegen.policies`** — the scaffolding templates
  and the regenerate/create-once/prunable lifecycle per role. Template bodies
  are authored engine-side (`DEFAULT_TEMPLATES` in `rune-manifest`) and
  byte-mirrored into this copy by `scripts/gen-codegen-templates.ts` — re-run
  it after an engine template edit; L6 asserts the unmutated copy reproduces
  engine-default output. At generation time the artifact wins: `planManifest`
  merges a supplied artifact's `templates`/`policies` over the engine defaults
  (partial maps allowed), which is how `--artifact` and the Studio change
  generated bodies with zero engine change (the L6 property).
- **`canonicalPaths`** — the full generated-project directory contract
  ([01-architecture.md](01-architecture.md)); `docs/canonical-shape.md` is
  generated from it.
- **`profiles[]`** — optional per-target codegen profiles (ADR 0008's second
  axis), `{id, label?, vars}` each. When declared they must be gap-free —
  every profile defines the same var keys (a meta-validator check, pinned by
  L1's profile-gap fixture). Schema + check exist; nothing consumes them yet —
  the pick/clone UI is a scoped follow-up
  ([12-history-and-roadmap.md](12-history-and-roadmap.md)). The live
  `lang/keywords.json` declares none.

The engine consumes it via the `@keywords` import alias; `rune sync/manifest
--artifact <file>` and `parse(text, {tags})` let an edited artifact drive
recognition, generation, and lint without an engine change. `rune validate`
meta-validates an artifact; the JSON schema (`lang/artifact.schema.json`) is
itself **derived** from the engine's Zod `ArtifactSchema` by
`scripts/gen-artifact-schema.ts` — regenerable but **not** drift-gated. No
verify gate detects a stale copy: `gateL1` only validates `keywords.json` +
fixtures against the Zod schema (it never regenerates or diffs the JSON
schema), and `gateDrift` diffs only `grammar.js` + `highlights.scm`. (The
script's own header claims L1 regenerates and diffs it; that claim is wrong,
and the doc previously inherited it.)

## The grammar (`lang/grammar/`)

A **tree-sitter** grammar, editor-only by decision (ADR 0003 — the TS engine
is the parser of record). `grammar.js` is generated from `keywords.json` by
`scripts/generate.mjs`; five external tokens are handled by a hand-written C
scanner keyed on indentation (`typ_desc`, `dto_desc`, `non_desc`,
`fault_line`, `service_prefix` — the single-colon boundary prefix
disambiguated from `::` static calls by lookahead). Notable tokens: the
`@ METHOD /template` route clause (anchored so it never collides with `@docs`
or `//`), `Dto`-suffixed references, `(s)`/`(es)` array suffixes,
string-literal enum types.

`scripts/build-grammar.ts` is the full out-of-band pipeline: regenerate
`grammar.js` + `highlights.scm` → `tree-sitter generate` → WASM build → copy
into `rune-studio/static/` (`rune-tree-sitter.wasm` + `rune-highlights.scm`).
That copy is a publish step with no runtime consumer today: the Studio's
editor is the registry-driven tokenizer, not tree-sitter, and the VS Code
extension bundles its own WASM inside the extension — the copy's only reader
is the verify `grammar` gate, which runs this pipeline and asserts the WASM
landed. The extension's bundle (`tree-sitter-rune.wasm` + `highlights.scm`,
checked in at the extension root and loaded from there at runtime) has no
sync story: neither this pipeline nor the extension's package scripts
refresh it, and no gate drift-checks it — it is re-copied by hand after a
grammar rebuild. (The `highlights.scm` header is no evidence either way here:
`buildHighlights()` in `scripts/generate-core.mjs` hardcodes the
`new/keywords.json` header line, so both the canonical
`lang/queries/highlights.scm` and any extension copy carry it byte-for-byte
regardless of when the copy was last refreshed.)
`lang/queries/highlights.scm` maps grammar nodes
to `@rune.{tag,noun,verb,type,param,boundary,fault,comment,chrome}` captures —
the single source of every editor's coloring, painted with the **Mesa Vapor**
palette. The palette's editable copy is `keywords.json.palette` —
`captureColors()` (`scripts/generate-core.mjs` and its Studio sibling) maps it
onto the `@rune.*` captures, so a recolor is a registry edit like any other.
`lang/palettes/mesa-vapor.json` is a hand-maintained reference copy of the
named palette; no script or drift gate syncs the pair (unlike the
grammar and codegen-template mirrors), so it is updated by hand when the palette
changes. Beside it sit two more hand-maintained, consumer-less files:
`lang/palettes/mesa-vapor.hex` is the palette as a raw-hex swatch list (one
bare six-digit hex per line, no `#`), and `lang/palettes/catppuccin.json` is a
*second* named scheme (`"name": "Catppuccin Mocha"`) in the same
`{name, description, colors}` shape, its `colors` the eight token keys
(`tag`, `noun`, `verb`, `dto`, `builtin`, `boundary`, `fault`, `comment`). As
with `mesa-vapor.json`, nothing in the repo reads either — the artifact's live
`palette` is the source of truth, so both ship as orphan reference swatches.

## The Rust workspace (`lang/{parser,lsp,cli}`)

Three crates, edition 2024; built by `deno task build:rust` and shipped as
prebuilt binaries in every release (`scripts/install.sh` installs the two
binaries, `rune-lsp` + `rune-syntax`, from the release tarball alongside the
`rune` CLI):

- **`rune-parser`** (library) — a fast line-based parser classifying each line
  into a `LineKind` (Req, Mod, Srv, SrvDocs, Ent, WsSocket, WsTopic, Step,
  BoundaryStep, Fault, Ply, Cse, DtoDef, TypDef, NonDef, Ret, New, …). It
  deliberately **mirrors the TS engine's parser** — same comment stripping
  (preserving `https://` and `@docs` URLs), same multiline handling, UTF-8-safe
  camelCase splitting. Shared core for both binaries.
- **`rune-lsp`** (binary) — a `tower-lsp` server over stdio. Capabilities:
  full-sync diagnostics (membership rule below), hover (types, DTO shapes,
  boundary blurbs), completion (trigger `:` `.` `{`: tags, prefixes,
  primitives, document-extracted nouns/DTOs/faults), go-to-definition
  (`[TYP]`/`[DTO]`/`[NON]`), find-references. Diagnostic membership has one
  rule: a check ships in the LSP exactly when the TS engine's `check`/`sync`
  path enforces it (undeclared services, the 80-column limit, missing
  `@docs`, duplicate names, DTO/type shape — the parser/check surface, not
  the artifact's `lint[]` rules). The scope/usage rules
  `lang/docs/constraints.md` documents are enforced by *neither* side, so
  the LSP omits them too — enforcing them LSP-only would reject specs the
  generator accepts (the design note in `lang/lsp/src/main.rs`;
  [02-language.md](02-language.md)). It resolves shared `[SRV]`s from the
  project's `core.rune` so cross-file boundary prefixes validate. "The
  project" is derived from the open file's own path — best-effort,
  filesystem-based; the LSP workspace root is ignored (`initialize`
  discards its params). Mirroring the engine's `resolveRoot`, a file in
  `spec/runes/` roots two dirs up, one in a `spec/` dir at its parent, one
  in `src/<module>/` above that `src/`, anything else in its own dir; the
  first readable of `src/core/core.rune`, the `spec[s]/runes/` and flat
  `spec[s]/` locations, and flat `core.rune` — then the `.in-prog.rune`
  draft variants of each — supplies the service set (empty when no core
  spec exists). Corpus-parity tests drive its diagnostics against
  `fixtures/corpus/{valid,invalid}` — the mechanism keeping Rust and
  TS byte-identical.
- **`rune-cli`** → binary **`rune-syntax`** — an internal helper the `rune`
  CLI shells out to: `validate` (per-file: parse errors — lines the parser
  classifies `Unknown` — plus the char-counted 80-column limit, and nothing
  else: none of the @docs/duplicate-name/undeclared-service/shape checks the
  LSP runs, and distinct from `rune validate`, the artifact meta-validator),
  `format [--check]` (the indentation normalizer, incl. `[PLY]` blocks and
  `[ENT:ws]` topics), `install`/`uninstall` (editor integration),
  `completions <shell>`. `install` builds from source rather than locating
  the shipped prebuilts: it compiles the embedded grammar C sources with
  `cc` into the data dir (`RUNE_DATA`, default the platform-local data dir
  + `/rune`), rebuilds `rune-lsp` via `cargo build --release` in a checkout
  found by walking up from cwd — so it requires a C compiler and the Rust
  toolchain and must run inside the repo — installs the binary to
  `~/.local/bin` (`RUNE_BIN` overrides), and writes per-editor config. The
  flow is interactive (`inquire`): a `MultiSelect` of editors
  (`prompt_editors`), a `Select` of shell (`prompt_shell`), and a `MultiSelect`
  of file-manager icons (`prompt_icons`); the chosen shell gets completions
  (`setup_shell_completions` shells out to `rune completions <shell>` and
  installs the generated file — printing the `.zshrc` `fpath` line for zsh,
  writing straight into place for bash/fish). `--yes` skips the prompts and
  takes the defaults (Neovim, zsh, yazi icons).

**Editor integrations** (`lang/supported-software/`): Neovim, Helix, VS Code,
Zed, Sublime, Emacs — plus file-manager icon configs (yazi, lf, broot, eza,
lsd, ranger) mapping `.rune` to the ᚱ glyph. Everywhere the model is the same
two layers: tree-sitter for highlighting, `rune-lsp` for intelligence. But the
`install` flow does *not* cover all six file managers evenly: icon installers
exist only for yazi/lf/eza/lsd (`setup_yazi_icons`/`setup_lf_icons`/
`setup_eza_icons`/`setup_lsd_icons`, the four `prompt_icons` offers), so
`broot` and `ranger` ship icon configs (`supported-software/{broot,ranger}/`)
that no installer path ever wires up — they are copy-by-hand.

The VS Code extension is the fullest of these. It delivers highlighting through
a **semantic-tokens provider** — a `RuneSemanticTokensProvider implements
vscode.DocumentSemanticTokensProvider`, registered via
`registerDocumentSemanticTokensProvider` with a `SemanticTokensLegend` and
driven by web-tree-sitter over the extension's bundled WASM grammar — mapping
the `@rune.*` captures onto VS Code's standard token types; neither TextMate
nor the LSP colors the buffer. Its `package.json` `contributes` the rest: a
`configurationDefaults` block that switches on `editor.semanticHighlighting`
and injects the Mesa-Vapor `semanticTokenColorCustomizations`, a `.rune` file
`icon` (light/dark SVG), and a `language-configuration.json`. It also launches
`rune-lsp` for the intelligence layer.

## Rune Studio (`rune-studio/`)

A standalone **Fresh 2** (Deno + Preact + Vite) single-page workbench for
*designing the language itself* — edit the language definition and watch every
downstream effect live. Run with `deno task studio` from the repo root.

Layout: a two-pane workbench. Left — a live `.rune` editor (CodeMirror,
registry-driven tokenizer) with a diagnostics strip. Right — switchable
lenses:

- **output**: *Code* (the generated hexagonal file tree, click-to-view — backed
  by the **real shared engine**: `lib/engine.ts` imports `parse`/`planManifest`
  from `src/rune/domain/business/`, so the preview is exactly what the CLI
  emits) and *Diagnostics* (spec lint + generated-code lint).
- **language**: *Constructs* (edit each tag: literal, color, summary, follows
  shape, indent, rules; add/delete), *Lint* (declarative rule instances with a
  live "firing now" strip), *Architecture* (import-graph layer rules + the
  path→layer classifier; the artifact's `reexportAllowed` list has no edit
  UI here).
- **tools**: *Check* — point at a real directory on disk and run the
  generated-code ruleset over actual files.

Plus a 16-step guided tour (`?tutorial=true`), an **Export** modal producing
`keywords.json` / `grammar.js` / `highlights.scm`, and **Save** persisting the
edited language back to `keywords.json`. The Rust generation path was retired
per ADR 0001 — one TS engine drives parse, codegen, lint, and the grammar.

### Known drift (as of this writing)

The `ln/` → `rune-studio/` relocation is not fully propagated:

- The registry path is **broken**: the studio (routes, API, test) reads
  `../keywords.json` → `<repo>/keywords.json`, which doesn't exist — the file
  lives at `lang/keywords.json`.
- The studio README describes files that no longer exist
  (`data/keywords.json`, `lib/render.ts`).
- Stale Vite aliases point at a retired deeper layout (`src/shape-checker`).
- The studio still carries its own second parser (`lib/parse.ts`) for
  lint/UI modeling — the engine backs codegen, but lint/UI can in principle
  diverge (the residual G2/G9 risk from the rebuild's gap analysis; the L5
  verify gate pins engine parity for the generation path).
- Tests: 14 Deno unit tests over parse/engine/lint; no committed
  browser/e2e suite.

See `docs/REBUILD-PROGRESS.md` and
[12-history-and-roadmap.md](12-history-and-roadmap.md) for the rebuild
work-orders that produced this state and the scoped follow-ups.
