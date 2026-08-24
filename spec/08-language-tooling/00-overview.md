# Language Tooling — the Artifact, Grammar, Rust Helpers, and Rune Studio

> Part of the [project spec series](../README.md). Sources: `lang/` (the language
> distribution), `rune-studio/` (the visual editor),
> `src/rune/domain/business/artifact/` (the artifact contract in the engine).

`lang/keywords.json` is this section's single source of truth: the
tree-sitter grammar, the syntax highlighter, Rune Studio's registry, and the
canonical generated-project layout are all **derived** from it live today.
The lint rule set (`lint[]` instances) is meant to derive the same way, but
that path is only **built, not yet wired**: the pipeline still runs its 27
rules hard-coded from `src/rune/mod-root.ts`, so editing a rule's severity or
params in `keywords.json` has no effect on a lint run until the
registration swap lands (see the lint[] row below and
[05-linter/03](../05-linter/03-governance-built-not-yet-wired.md)). Codegen
templates are the one flow that runs the *other* way — authored
engine-side and mirrored into the artifact, not out of it. Treat every edit
to `keywords.json` (by hand or through Rune Studio) as authoritative; treat
everything derived from it as generated output — regenerate it, never
hand-edit it.

| Source | Derived | Owning sibling |
| --- | --- | --- |
| `lang/keywords.json` | `lang/grammar/grammar.js`, `lang/queries/highlights.scm`, the WASM build | [→02](02-the-grammar-lang-grammar.md) |
| `lang/keywords.json` | Rune Studio's registry (Constructs/Lint/Architecture lenses) | [→04](04-rune-studio-rune-studio.md) |
| `lang/keywords.json` | the canonical generated-project layout (`canonicalPaths`) | [→01](01-lang-keywords-json-the-artifact.md), [01-architecture.md](../01-architecture/00-overview.md) |
| `lang/keywords.json` | the lint rule set (`lint[]` instances) — **built, not yet wired** to the CLI; today's lint run ignores this and uses the 27 rules hard-coded in `mod-root.ts` | [→01](01-lang-keywords-json-the-artifact.md), [05-linter/03](../05-linter/03-governance-built-not-yet-wired.md) |
| engine `DEFAULT_TEMPLATES` (`rune-manifest`) | `keywords.json`'s `codegen.templates`/`codegen.policies` — the one reverse flow | [→01](01-lang-keywords-json-the-artifact.md) |

Consumers read the derived artifacts, not the reverse: the TS engine imports
`keywords.json` directly via the `@keywords` alias for parsing and
generation; lint does not consume it yet — the pipeline's rule set is still
hard-coded in `mod-root.ts`, and only takes its rules from the artifact once
the built-not-yet-wired registration swap lands (see the lint[] row above).
The Rust workspace's `rune-syntax install` path embeds the generated
tree-sitter grammar; the VS Code extension bundles its own hand-copied WASM
grammar; Rune Studio edits the artifact directly, and its Export modal
produces the same `grammar.js`/`highlights.scm` a build would. Per-gate
mechanics (what regenerates when, what's drift-gated, what isn't) live in the
owning sibling named above.

The section's content lives in its sibling files:

- [`lang/keywords.json` — the artifact](01-lang-keywords-json-the-artifact.md)
  — the artifact contract: every top-level key, schema, and consumer; read
  this to add or change a language construct.
- [The grammar (`lang/grammar/`)](02-the-grammar-lang-grammar.md) — the
  tree-sitter grammar and its WASM build pipeline; read this to trace how a
  keyword becomes editor highlighting.
- [The Rust workspace (`lang/{parser,lsp,cli}`)](03-the-rust-workspace-lang-parser-lsp-cli.md)
  — `rune-parser`, `rune-lsp`, and `rune-syntax`, plus editor integrations;
  read this to work on hover, go-to-definition, or `rune install`.
- [Rune Studio (`rune-studio/`)](04-rune-studio-rune-studio.md) — the visual
  workbench for editing the artifact and previewing every downstream effect;
  read this to change the Studio UI or trace its known relocation drift.

Alongside the machine artifacts above, `lang/docs/` carries the canonical
language prose the rest of the series cites (and rune:spec's skill mirrors):
`spec.md`, `constraints.md`, `cookbook.md`, and `example.rune`.

