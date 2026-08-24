# spec — decomposed

> Split into one standalone file per concept by `piecemeal`. Every byte of spec
> content is preserved verbatim from the source; only `§` cross-references were
> rewritten as links. Run `deno run -A verify.ts /Users/raphaelcastro/Documents/programming/tooling/rune/refactor/spec-pieces` to confirm losslessness.

## 00-overview.md

- [Overview](00-overview/00-overview.md)
- [What rune is](00-overview/01-what-rune-is.md)
- [The two layers](00-overview/02-the-two-layers.md)
- [The core ideas](00-overview/03-the-core-ideas.md)
- [The loop, end to end](00-overview/04-the-loop-end-to-end.md)
- [Glossary](00-overview/05-glossary.md)

## 01-architecture.md

- [Overview](01-architecture/00-overview.md)
- [Top-level layout](01-architecture/01-top-level-layout.md)
- [The Deno workspace](01-architecture/02-the-deno-workspace.md)
- [Layering inside the engine (`src/`)](01-architecture/03-layering-inside-the-engine-src.md)
- [Cross-boundary contracts](01-architecture/04-cross-boundary-contracts.md)
- [The canonical generated-project shape](01-architecture/05-the-canonical-generated-project-shape.md)
- [The durability manifest — `spec/` as a portable artifact](01-architecture/06-the-durability-manifest-spec-as-a-portable-artifact.md)
- [Naming conventions](01-architecture/07-naming-conventions.md)

## 02-language.md

- [Overview](02-language/00-overview.md)
- [A complete example](02-language/01-a-complete-example.md)
- [Tags](02-language/02-tags.md)
- [Requirements and steps](02-language/03-requirements-and-steps.md)
- [Types, DTOs, and constraint modifiers](02-language/04-types-dtos-and-constraint-modifiers.md)
- [Entrypoints (`[ENT]`)](02-language/05-entrypoints-ent.md)
- [Validation summary](02-language/06-validation-summary.md)
- [Comments and file conventions](02-language/07-comments-and-file-conventions.md)

## 03-cli.md

- [Overview](03-cli/00-overview.md)
- [Command surface](03-cli/01-command-surface.md)
- [`rune sync` — semantics that matter](03-cli/02-rune-sync-semantics-that-matter.md)
- [`rune dev` — the live loop](03-cli/03-rune-dev-the-live-loop.md)
- [The authoring loop (end to end)](03-cli/04-the-authoring-loop-end-to-end.md)

## 04-codegen.md

- [Overview](04-codegen/00-overview.md)
- [Pipeline](04-codegen/01-pipeline.md)
- [The contract artifact — `spec/contract/`](04-codegen/02-the-contract-artifact-spec-contract.md)
- [Ghost stubs — the `[TYP:ext]` lifecycle](04-codegen/03-ghost-stubs-the-typ-ext-lifecycle.md)
- [Heal rules](04-codegen/04-heal-rules.md)
- [Validation & Swagger details worth knowing](04-codegen/05-validation-swagger-details-worth-knowing.md)
- [The run-all gate](04-codegen/06-the-run-all-gate.md)

## 05-linter.md

- [Overview](05-linter/00-overview.md)
- [Rule families](05-linter/01-rule-families.md)
- [`--strict`](05-linter/02-strict.md)
- [Governance (built, not yet wired)](05-linter/03-governance-built-not-yet-wired.md)

## 06-runtime.md

- [Overview](06-runtime/00-overview.md)
- [`bootstrapServer(appName, module, options?)`](06-runtime/01-bootstrapserver-appname-module-options.md)
- [`@Endpoint` / `@EndpointController`](06-runtime/02-endpoint-endpointcontroller.md)
- [The assert runtime (`#assert`)](06-runtime/03-the-assert-runtime-assert.md)
- [Logging, tracing, alerting](06-runtime/04-logging-tracing-alerting.md)
- [The docs surface — an addable module](06-runtime/05-the-docs-surface-an-addable-module.md)
- [Composition & serving](06-runtime/06-composition-serving.md)
- [Package hygiene](06-runtime/07-package-hygiene.md)

## 07-cake.md

- [Overview](07-cake/00-overview.md)
- [The docs module (`DocsModule`)](07-cake/01-the-docs-module-docsmodule.md)
- [The cake (`/docs/<module>`)](07-cake/02-the-cake-docs-module.md)
- [The system map (`/docs/_map`)](07-cake/03-the-system-map-docs-map.md)
- [The headless runner — `exerciseEndpoints(opts)`](07-cake/04-the-headless-runner-exerciseendpoints-opts.md)
- [Dev mode and tracing pages](07-cake/05-dev-mode-and-tracing-pages.md)

## 08-language-tooling.md

- [Overview](08-language-tooling/00-overview.md)
- [`lang/keywords.json` — the artifact](08-language-tooling/01-lang-keywords-json-the-artifact.md)
- [The grammar (`lang/grammar/`)](08-language-tooling/02-the-grammar-lang-grammar.md)
- [The Rust workspace (`lang/{parser,lsp,cli}`)](08-language-tooling/03-the-rust-workspace-lang-parser-lsp-cli.md)
- [Rune Studio (`rune-studio/`)](08-language-tooling/04-rune-studio-rune-studio.md)

## 09-claude-skills.md

- [Overview](09-claude-skills/00-overview.md)
- [The eight skills, in pipeline order](09-claude-skills/01-the-eight-skills-in-pipeline-order.md)
- [The agent fleet (`claude/agents/`)](09-claude-skills/02-the-agent-fleet-claude-agents.md)
- [Distribution](09-claude-skills/03-distribution.md)
- [Drift guards](09-claude-skills/04-drift-guards.md)

## 10-testing-and-verification.md

- [Overview](10-testing-and-verification/00-overview.md)
- [The verify ladder — `deno task verify`](10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)
- [The fixture corpus (`fixtures/`)](10-testing-and-verification/02-the-fixture-corpus-fixtures.md)
- [Acceptance suites (`e2e/`)](10-testing-and-verification/03-acceptance-suites-e2e.md)
- [Per-layer suites](10-testing-and-verification/04-per-layer-suites.md)
- [Drift guards (the other half of "testing")](10-testing-and-verification/05-drift-guards-the-other-half-of-testing.md)
- [Known state](10-testing-and-verification/06-known-state.md)

## 11-release-and-distribution.md

- [Overview](11-release-and-distribution/00-overview.md)
- [Train 1 — the rune toolchain (GitHub releases)](11-release-and-distribution/01-train-1-the-rune-toolchain-github-releases.md)
- [Train 2 — the runtime (JSR)](11-release-and-distribution/02-train-2-the-runtime-jsr.md)
- [Install / uninstall](11-release-and-distribution/03-install-uninstall.md)
- [Build from source](11-release-and-distribution/04-build-from-source.md)

## 12-history-and-roadmap.md

- [Overview](12-history-and-roadmap/00-overview.md)
- [Architecture Decision Records (`docs/adr/`)](12-history-and-roadmap/01-architecture-decision-records-docs-adr.md)
- [The rebuild (`docs/REBUILD-PROGRESS.md`)](12-history-and-roadmap/02-the-rebuild-docs-rebuild-progress-md.md)
- [The DX roadmap (`todos/`) — complete](12-history-and-roadmap/03-the-dx-roadmap-todos-complete.md)
- [The diamond (`upgrades.md`) — the strategic direction](12-history-and-roadmap/04-the-diamond-upgrades-md-the-strategic-direction.md)
- [Parked proposals (`maybe/`)](12-history-and-roadmap/05-parked-proposals-maybe.md)
- [Field feedback (`feedback/feedback.md`)](12-history-and-roadmap/06-field-feedback-feedback-feedback-md.md)
- [Current state, summarized](12-history-and-roadmap/07-current-state-summarized.md)

## 13-environment-variables.md

- [Overview](13-environment-variables/00-overview.md)
- [Substrate variables — moved to bedrock](13-environment-variables/01-substrate-variables-moved-to-bedrock.md)
- [keep runtime — serving & behavior](13-environment-variables/02-keep-runtime-serving-behavior.md)
- [rune CLI & engine](13-environment-variables/03-rune-cli-engine.md)
- [Install, release & versioning](13-environment-variables/04-install-release-versioning.md)
- [Test-only](13-environment-variables/05-test-only.md)

## README.md

- [Overview](README/00-overview.md)
- [The project in three sentences](README/01-the-project-in-three-sentences.md)

