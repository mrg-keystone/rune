# Rune — Project Spec Series

A series of markdown documents describing the rune project in depth: what it
is, how each layer works, and why it's built the way it is. Written from a
deep read of the codebase (branch `refactor`, July 2026). Each file stands
alone but cross-links the others.

| # | File | Covers |
| --- | --- | --- |
| 00 | [Overview](00-overview.md) | What rune is, the two layers, the core ideas, the end-to-end loop, glossary |
| 01 | [Architecture](01-architecture.md) | Repo layout, the Deno workspace, engine layering, cross-boundary contracts, the canonical generated-project shape |
| 02 | [Language](02-language.md) | The `.rune` DSL: tags, requirements/steps, boundaries + `[SRV]`, types/DTOs/modifiers, entrypoints, process derivation, validation rules |
| 03 | [CLI](03-cli.md) | Every `rune` command; `sync` semantics; the `rune dev` live loop; the authoring loop |
| 04 | [Codegen](04-codegen.md) | Parse → validate → generate → reconcile; the generated tree; regenerate vs create-once; ghost stubs; heal rules; the run-all gate |
| 05 | [Linter](05-linter.md) | The 27 architecture rules, spec↔tree parity rules, `--strict`, the dormant governance layer |
| 06 | [Runtime](06-runtime.md) | keep / `@mrg-keystone/rune`: `bootstrapServer`, the auth-agnostic runtime, `@Endpoint`, the assert runtime, the docs module — composition/serving and observability are **bedrock** substrate (the separate foundation framework keep builds on and conforms to; bedrock has its own reference, out of scope for this series); 06 keeps only the backend-specific concretion |
| 07 | [Cake & Runner](07-cake.md) | The interactive cake, expectations, scenarios, heal, the system map, `exerciseEndpoints` + `/docs/_run`, dev mode |
| 08 | [Language Tooling](08-language-tooling.md) | `keywords.json` (the artifact), the tree-sitter grammar, the Rust LSP/CLI, editor integrations, Rune Studio |
| 09 | [Claude Skills](09-claude-skills.md) | The eight `rune:*` skills, the 15-agent fleet, installation, drift guards |
| 10 | [Testing & Verification](10-testing-and-verification.md) | The L0–L7 verify ladder, the fixture corpus and goldens, the e2e acceptance suites, drift guards |
| 11 | [Release & Distribution](11-release-and-distribution.md) | The two publish trains (GitHub releases + JSR), versioning/stamping, install/uninstall |
| 12 | [History & Roadmap](12-history-and-roadmap.md) | The ADRs, the rebuild, the completed DX roadmap, the diamond, parked proposals, field feedback, current state |
| 13 | [Environment Variables](13-environment-variables.md) | The env-var reference for the backend framework + toolchain — keep serving & behavior, rune CLI/engine, install/release, test-only; the substrate vars (observability, `PORT`, removed auth) are bedrock's |

## The project in three sentences

Rune builds a backend by **shaping** it: a tiny `.rune` spec per module
(endpoints, contracts, seams, faults) from which the `rune` CLI generates a
typed, validated, lint-clean TypeScript tree — regenerated from the spec, never
hand-edited structurally. The generated code runs on **rune's runtime**
(`keep/`, published as `@mrg-keystone/rune` on JSR): a Deno backend framework
built on **bedrock** (the separate substrate framework that owns
composition/serving and observability); keep itself adds `bootstrapServer`,
`@Endpoint`, auto Swagger/docs, the assert runtime, and self-verification
surfaces — the interactive **cake**, the live system map, and a headless
runner — all driven by process metadata derived from the spec (keep is
auth-agnostic: it neither provides nor assumes authentication — an app brings
its own).
Around the two layers sit a machine-readable language definition
(`lang/keywords.json`) that everything else is derived from and drift-gated
against, a Rust LSP + editor toolchain, a visual language workbench (Rune
Studio), eight Claude Code skills that automate the whole lifecycle, and an
L0–L7 golden verification ladder.
