## rune CLI & engine

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `RUNE_LINT_STRICT` | off | `rune lint --strict` sets it (`=1`); strict-gated rules read it — currently only `rune-heal-todo`, which fails on any `heal-rules.json` entry still carrying `todo: true` (that predicate, and nothing else). Strict-gate semantics owned by [05-linter/02-strict.md](../05-linter/02-strict.md). | `src/bootstrap/mod.ts`, `src/rune/domain/business/rules/rune-heal-todo/mod.ts` |
| `RUNE_STRICT` | off | Alias for `RUNE_LINT_STRICT` — either enables strict mode. Strict-gate semantics owned by [05-linter/02-strict.md](../05-linter/02-strict.md). | `src/rune/domain/business/rules/rune-heal-todo/mod.ts` |
| `SHAPE_NO_LSP` | off | Disable the linter's LSP semantic enrichment (some rules degrade to structural-only). LSP-degradation behavior, per rule, owned by [05-linter/00-overview.md § Determinism and goldens](../05-linter/00-overview.md). | `src/rune/domain/coordinators/pipeline/mod.ts` |
| `OPENAI_API_KEY` | — | Enables the linter's optional LLM fix suggestions (`gpt-4.1-mini`); absent → deterministic suggestions only. Which rules get an LLM suggestion, and the best-effort fallback, owned by [05-linter/00-overview.md § Suggestions](../05-linter/00-overview.md). | `src/rune/domain/data/llm/openai.ts` |
| `RUNE_E2E` | off | Run the generated `e2e.test.ts` files (they carry `ignore: !RUNE_E2E`, so `deno test` skips them unless this is set). Generated-`e2e.test.ts` emission owned by [04-codegen/01-pipeline.md § Generate](../04-codegen/01-pipeline.md). | `src/rune/domain/business/rune-manifest/mod.ts` |
| `RUNE_HOME` | `~/.rune` | Override the global rune state dir (the shared-dev-process registry `dev.json` + rotating logs). Dev registry owned by [03-cli/03-rune-dev-the-live-loop.md](../03-cli/03-rune-dev-the-live-loop.md). | `src/rune/entrypoints/dev/registry.ts` |
| `RUNE_BIN_DIR` | resolved | Where the front door looks for the `rune-lsp` / `rune-syntax` helper binaries — ordered lookup, first match wins: `RUNE_BIN_DIR` → the directory next to the installed `rune` binary → `lang/target/{release,debug}/` → `PATH`. | `src/bootstrap/mod.ts` |
| `HOME` / `USERPROFILE` | OS | Home-dir resolution for `RUNE_HOME`/`init` (standard OS vars). | `src/rune/entrypoints/dev/registry.ts`, `src/rune/entrypoints/init/mod.ts` |

