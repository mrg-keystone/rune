# Rune — Project Spec Series

Rune builds a backend by shaping it: a `.rune` module spec in, a typed,
validated, lint-clean, self-verifying TypeScript service out. For the full
pitch in three sentences, start with
[The Project in Three Sentences](01-the-project-in-three-sentences.md).

This series is the depth version of that pitch: what rune is, how each layer
works, and why it's built the way it is. Written from a deep read of the
codebase (branch `refactor`, July 2026). Each file stands alone but
cross-links the others.

This file is the overview of the README section — the reading-path guide and
section index for the series. The top-level index that every section's
header ("Part of the project spec series") links back to is
[`spec/README.md`](../README.md); that piecemeal-generated file is the
series' canonical front door, while this page is its curated map.

## Reading paths

Fourteen sections is a lot to read linearly. Pick the path that matches why
you're here:

- **Evaluating rune** — is this the right tool? Read Overview (00) →
  Architecture (01) → History & Roadmap (12).
- **Authoring a module** — writing `.rune` specs day to day. Read Language
  (02) → CLI (03) → Codegen (04) → Linter (05).
- **Hacking the engine** — contributing to the CLI, codegen, or linter. Read
  Architecture (01) → Codegen (04) → Linter (05) → Testing & Verification
  (10).
- **Understanding the runtime** — what generated code runs on, and how it
  proves itself. Read Runtime (06) → Cake & Runner (07) → Environment
  Variables (13).

## Section index

> Rune's backend runtime (06) and its env vars (13) both sit on **bedrock**
> — the separate foundation framework keep builds on and conforms to, which
> owns composition/serving and observability. Bedrock has its own reference
> and is out of scope for this series; both rows below cover only the
> rune-specific concretion.

| # | File | Covers |
| --- | --- | --- |
| 00 | [Overview](../00-overview/00-overview.md) | What rune is, the two layers, the core ideas, the end-to-end loop, glossary |
| 01 | [Architecture](../01-architecture/00-overview.md) | Repo layout, the Deno workspace, engine layering, cross-boundary contracts, the canonical generated-project shape |
| 02 | [Language](../02-language/00-overview.md) | The `.rune` DSL: tags, requirements/steps, boundaries + `[SRV]`, types/DTOs/modifiers, entrypoints, process derivation, validation rules |
| 03 | [CLI](../03-cli/00-overview.md) | Every `rune` command; `sync` semantics; the `rune dev` live loop; the authoring loop |
| 04 | [Codegen](../04-codegen/00-overview.md) | Parse → validate → generate → reconcile; the generated tree; regenerate vs create-once; ghost stubs; heal rules; the run-all gate |
| 05 | [Linter](../05-linter/00-overview.md) | The 27 architecture rules, spec↔tree parity rules, `--strict`, the dormant governance layer |
| 06 | [Runtime](../06-runtime/00-overview.md) | keep / `@mrg-keystone/rune`: `bootstrapServer`, the auth-agnostic runtime, `@Endpoint`, the assert runtime, the docs module |
| 07 | [Cake & Runner](../07-cake/00-overview.md) | The interactive cake, expectations, scenarios, heal, the system map, `exerciseEndpoints` + `/docs/_run`, dev mode |
| 08 | [Language Tooling](../08-language-tooling/00-overview.md) | `keywords.json` (the artifact), the tree-sitter grammar, the Rust LSP/CLI, editor integrations, Rune Studio |
| 09 | [Claude Skills](../09-claude-skills/00-overview.md) | The eight `rune:*` skills, the 15-agent fleet, installation, drift guards |
| 10 | [Testing & Verification](../10-testing-and-verification/00-overview.md) | The L0–L7 verify ladder, the fixture corpus and goldens, the e2e acceptance suites, drift guards |
| 11 | [Release & Distribution](../11-release-and-distribution/00-overview.md) | The two publish trains (GitHub releases + JSR), versioning/stamping, install/uninstall |
| 12 | [History & Roadmap](../12-history-and-roadmap/00-overview.md) | The ADRs, the rebuild, the completed DX roadmap, the diamond, parked proposals, field feedback, current state |
| 13 | [Environment Variables](../13-environment-variables/00-overview.md) | The env-var reference for the backend framework + toolchain — keep serving & behavior, rune CLI/engine, install/release, test-only |

