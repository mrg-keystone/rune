## The Rust workspace (`lang/{parser,lsp,cli}`)

Three crates, edition 2024; built by `deno task build:rust` and shipped as
prebuilt binaries in every release (`scripts/install.sh` installs the three
binaries — `rune`, `rune-lsp`, and `rune-syntax` — from the release tarball):

- **`rune-parser`** (library) — a fast line-based parser classifying each line
  into a `LineKind` (Req, Mod, Srv, SrvDocs, Ent, WsSocket, WsTopic, Step,
  BoundaryStep, Fault, Ply, Cse, DtoDef, TypDef, NonDef, Ret, New, …). It
  deliberately **mirrors the TS engine's parser** — same comment stripping
  (preserving `https://` and `@docs` URLs), same multiline handling, UTF-8-safe
  camelCase splitting. Shared core for both binaries.
- **`rune-lsp`** (binary) — a `tower-lsp` server over stdio; its capability
  table is under Capabilities below, and diagnostic membership is governed
  by the check × surface matrix under Diagnostics below. It resolves shared
  `[SRV]`s from "the project's" `core.rune`, derived from the open file's
  own path per Project-root derivation below, so cross-file boundary
  prefixes validate. Corpus-parity tests drive its diagnostics against
  `fixtures/corpus/{valid,invalid}` — the mechanism keeping the Rust and TS
  surfaces aligned on the checks they share (the LSP's additional shape
  checks, below, have no TS-side equivalent to stay in parity with).
- **`rune-cli`** → binary **`rune-syntax`** — the CI-friendly, non-interactive
  syntax surface: `validate` (per-file: parse errors — lines the parser
  classifies `Unknown` — plus the char-counted 80-column limit, and nothing
  else: none of the @docs/duplicate-name/undeclared-service/shape checks the
  LSP runs, and distinct from `rune validate`, the artifact meta-validator),
  `format [--check]` (the indentation normalizer, incl. `[PLY]` blocks and
  `[ENT:ws]` topics), `completions <shell>`, and `install`/`uninstall`
  (editor integration — see the install walkthrough below). The `rune` CLI's
  `fmt`/`format`/`install`/`uninstall`/`completions` commands are a verbatim
  passthrough to this binary
  ([→03-cli § Command surface](../03-cli/01-command-surface.md)), but
  `validate` has no such passthrough — that command list does not include it
  — so a CI author invokes the per-file syntax check by calling the
  `rune-syntax` binary directly: `rune-syntax validate <file.rune>`.

### Capabilities

| Capability | Trigger | What it surfaces | Data source |
| --- | --- | --- | --- |
| Diagnostics | full document sync, on every change | parse/semantic findings — see Diagnostics below | the parsed document + the check × surface matrix below |
| Hover | cursor over a token | types, DTO shapes, boundary blurbs | the parsed document + the resolved core `[SRV]`s |
| Completion | `:` | boundary prefixes | the resolved core `[SRV]`s |
| Completion | `.` | document-extracted nouns/verbs | the parsed document |
| Completion | `{` | tags, primitives, and document-extracted DTOs/faults | `keywords.json` tags/builtins + the parsed document |
| Go-to-definition | invoked on a `[TYP]`/`[DTO]`/`[NON]` reference | the declaring line | the parsed document |
| Find-references | invoked on a declared name | every usage site | the parsed document |

### Diagnostics: check × surface

Which surface catches which problem — `rune-lsp` is a **stricter superset**
of the TS engine's `check`/`sync` path, never a mirror of it: every check the
TS engine enforces, the LSP enforces too (the "both" rows), plus the shape
rules `rune check`/`rune sync` let pass — they exit 0 on all of them (the
"LSP-only" rows). `rune-syntax validate` is narrower than either side —
parse errors and the 80-column limit only. The "Enforced by" column states
only that TS-engine-vs-LSP axis (whether `rune check`/`rune sync` enforce the
check too, or only the LSP does); it says nothing about the `rune-syntax
validate` column to its right, which is a third, orthogonal surface — so a
row can read "LSP-only" and still carry a ✓ in the `rune-syntax validate`
column, as the 80-column row below does: of the TS-engine/LSP pair, only the
LSP enforces line length, and `rune-syntax validate` happens to enforce it
independently:

| Check | Enforced by (TS engine vs LSP) | `rune-lsp` | `rune-syntax validate` |
| --- | --- | --- | --- |
| Parse errors (lines the parser classifies `Unknown`) | both | ✓ | ✓ |
| `[TYP]` modifier validation | both | ✓ | |
| Duplicate `[TYP]`/`[DTO]` names | both | ✓ | |
| Ambiguous property collision (a property resolving under both a declared `[TYP]` and a `Dto`-suffixed name at once) | both | ✓ | |
| Missing `@docs`† | both | ✓ | |
| Undeclared services | both | ✓ | |
| Entrypoint validation (verb, dispatch resolution, `[PLY]`-requires-`[CSE]`, HTTP-vs-WS exclusivity, WS topic rules) | both | ✓ | |
| 80-column limit | LSP-only | ✓ | ✓ |
| Indentation | LSP-only | ✓ | |
| Duplicate names (`[REQ]` header uniqueness) | LSP-only | ✓ | |
| `Dto` suffix / required descriptions | LSP-only | ✓ | |
| DTO in/out (`[REQ]`/`[ENT]` input and output must each be a DTO) | LSP-only | ✓ | |
| Boundary type-safety | LSP-only | ✓ | |
| Scope/usage rules (`lang/docs/constraints.md`) | neither | | |

This is the parser/check surface, not the artifact's `lint[]` rules (defined
in [→01](01-lang-keywords-json-the-artifact.md), enforced separately by
`rune lint`, [05-linter.md](../05-linter/00-overview.md)); see
[→02-language § Validation summary](../02-language/06-validation-summary.md)
for the authoritative "both" vs "LSP-only" breakdown with `main.rs` line
references. The scope/usage row is enforced by *neither* side, so the LSP
omits it too — enforcing it LSP-only would reject specs the generator
accepts (the design note in `lang/lsp/src/main.rs`;
[02-language.md](../02-language/00-overview.md)).

† Missing `@docs` is a "hard parse error" in 02-language/06's terminology,
but it is not a line the parser classifies `Unknown` — there is no malformed
line to flag, only an absent required one on an existing `[SRV]` block — so
it falls outside `rune-syntax validate`'s narrower parse-errors-only scope
(`Unknown`-classified lines plus the 80-column limit, nothing else); the TS
engine and the LSP catch it structurally, `rune-syntax validate` does not.

`rune-lsp` itself reports parse errors — lines the parser classifies
`Unknown` — as diagnostics, alongside the other checks above: `rune-syntax
validate` already treats an `Unknown` line as a first-class finding, and an
editor session that stays silent on unparseable lines would be a worse gap
than one that stays silent on a semantic issue.

### Project-root derivation

"The project" is derived from the open file's own path — best-effort,
filesystem-based; the LSP workspace root is ignored (`initialize` discards
its params). This is the LSP's own single-root, best-effort derivation —
distinct from `spec-root.ts`'s dual git-root/codegen-root probe
([01-architecture.md § The canonical generated-project shape](../01-architecture/05-the-canonical-generated-project-shape.md)),
which the LSP does not run (it has no git-root concept; the root is always
computed from the one open file). The path-pattern matching below parallels
the spec-root family `resolveRoot` recognizes
([03-cli.md § `rune sync` semantics that matter](../03-cli/02-rune-sync-semantics-that-matter.md)),
the two derivations agree on two of the four rows below — `src/<module>/<file>`
and anything else both land on the same directory either way — and diverge
only on the two `spec/` rows (`spec/runes/<file>` and a flat `spec/`
directory): there, `resolveRoot` maps to the *sibling* `<dir>/server/`
codegen root that `rune sync` generates into, while the LSP instead needs
`<dir>` itself — the project/git root — to locate the durable `spec/runes/`
specs and `core.rune`:

| Open-file path pattern | Derived root |
| --- | --- |
| `spec/runes/<file>` | two directories up from the file |
| a file directly under a flat `spec/` directory | that `spec/` directory's parent |
| `src/<module>/<file>` | the directory above that `src/` |
| anything else | the file's own directory |

Against that derived root, the first readable of the following supplies the
service set (order-significant, first match wins):

1. `spec/runes/core.rune` — the durable home (see
   [01-architecture.md § The canonical generated-project shape](../01-architecture/05-the-canonical-generated-project-shape.md));
   `rune sync` reads it in place and never relocates it into `src/`
2. `specs/runes/core.rune`
3. `spec/core.rune`
4. `specs/core.rune`
5. `src/core/core.rune` — a legacy layout, not a `rune sync` output
6. flat `core.rune`
7. the `.in-prog.rune` draft variant of candidates 1–6, re-probed in the same order

The service set is empty when no core spec exists.

### Golden path: opening a spec file

Reusing the `tasks` module spec from
[05-linter.md § Rule families, the `task.update` example](../05-linter/01-rule-families.md)
— `[REQ] task.update` calling `db:task.load`/`db:task.save`/`mail:task.notify`,
and `TaskDto: id, title, done` — with a `core.rune` declaring the `[SRV] db`
and `[SRV] mail` those calls need:

1. The editor opens `spec/runes/tasks.rune`.
2. `initialize` fires; the LSP discards its `rootUri`/`workspaceFolders`
   params.
3. Root derivation (the table above): the path matches `spec/runes/<file>`,
   so the root is two directories up — the git root.
4. Core-spec candidate probe (the list above): `spec/runes/core.rune` — the
   durable home, candidate 1 — is the first readable file, so it wins
   directly; no `rune sync` needs to have run first, since sync reads specs
   from `spec/runes/` and never relocates them into `src/`.
5. That `core.rune`'s `[SRV]` set loads: `db`, `mail`.
6. Back in `tasks.rune`, the user types `db:` — the `:` trigger offers the
   declared boundary prefixes, confirming `db` (and `mail`) are legal.
7. The user continues typing `.` — the `.` trigger offers document-extracted
   nouns/verbs (`task.load`, `task.save`, …) for completion.
8. A line 81 columns wide raises the 80-column diagnostic (see Diagnostics
   above).
9. Hovering `TaskDto` shows its declared shape — `id, title, done`.

### `install` — the editor-integration installer

> **Prerequisites:** a C compiler, the Rust toolchain, and a run from
> inside the repo checkout — `install` builds `rune-lsp` from source rather
> than locating the shipped prebuilts.

This is the **editor-integration** installer — distinct from
`scripts/install.sh`
([11-release-and-distribution.md § Install/uninstall](../11-release-and-distribution/03-install-uninstall.md)),
which installs the `rune`/`rune-lsp`/`rune-syntax` binaries themselves from
prebuilt release tarballs. The flow is interactive by default (`inquire`);
`--yes` skips every prompt below and takes the defaults (Neovim, zsh, yazi
icons):

1. Prompt for editors — `MultiSelect` (`prompt_editors`).
2. Prompt for shell — `Select` (`prompt_shell`).
3. Prompt for file-manager icons — `MultiSelect` (`prompt_icons`).
4. Compile the embedded grammar C sources with `cc` into the data dir
   (`RUNE_DATA`, default the platform-local data dir + `/rune`).
5. Rebuild `rune-lsp` via `cargo build --release`, in the checkout found by
   walking up from cwd.
6. Install the binary to `~/.local/bin` (`RUNE_BIN` overrides).
7. Write per-editor config for each selected editor.
8. Wire shell completions for the chosen shell (`setup_shell_completions`
   shells out to `rune completions <shell>` and installs the generated
   file — printing the `.zshrc` `fpath` line for zsh, writing straight into
   place for bash/fish).

**Editor integrations** (`lang/supported-software/`) map `.rune` to the ᚱ
glyph across six editors and six file managers. Editors get the same two
layers everywhere — tree-sitter for highlighting, `rune-lsp` for
intelligence; file managers get an icon config only, and the `install` flow
does *not* wire all six of those up evenly:

| Editor / file manager | tree-sitter highlight | `rune-lsp` | icon installer exists? |
| --- | --- | --- | --- |
| Neovim | ✓ | ✓ | — |
| Helix | ✓ | ✓ | — |
| VS Code | ✓ | ✓ | — |
| Zed | ✓ | ✓ | — |
| Sublime | ✓ | ✓ | — |
| Emacs | ✓ | ✓ | — |
| yazi | — | — | ✓ (`setup_yazi_icons`) |
| lf | — | — | ✓ (`setup_lf_icons`) |
| eza | — | — | ✓ (`setup_eza_icons`) |
| lsd | — | — | ✓ (`setup_lsd_icons`) |
| broot | — | — | ✗ — copy-by-hand |
| ranger | — | — | ✗ — copy-by-hand |

Icon installers exist only for the four `prompt_icons` offers
(yazi/lf/eza/lsd); `broot` and `ranger` ship icon configs
(`supported-software/{broot,ranger}/`) that no installer path ever wires
up.

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

