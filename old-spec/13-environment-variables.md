# Environment Variables — the complete reference

> Part of the [project spec series](README.md). The single authoritative list of
> every environment variable the backend framework (keep) and the rune toolchain
> read, enumerated from the source (`Deno.env` reads in `keep/src`, `src`,
> `scripts`; `std::env` in `lang/cli`). The layer-neutral substrate's variables
> — observability and `PORT`, plus the removed auth vars (keep is
> **auth-agnostic**, [06-runtime.md](06-runtime.md)) — are bedrock's, listed
> in bedrock's own reference, not here.

A variable is "truthy" when set to a non-empty value unless a specific form is
noted (e.g. `=1`, `=off`). This table is the kind of derived fact that should be
**generated from the code's env reads and drift-gated** (see the config-plane
ideal in [12-history-and-roadmap.md](12-history-and-roadmap.md)); until then it is
kept by hand against the source paths cited in each section.

---

## Substrate variables — moved to bedrock

Of the three-part runtime design in [06-runtime.md](06-runtime.md), Parts 1–2 —
request/response logging and the structured logger — are bedrock substrate now;
Part 3, the docs module (`KEEP_DOCS` below), stays here. The substrate
variables — request/response logging, Datadog, tracing, Postmark/alerting,
`PORT`, and the removed auth vars — are bedrock's, in its own reference.

## keep runtime — serving & behavior

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `KEEP_DOCS` | **off** | Part 3 — serve the addable docs/cake module (`/docs/*`). Off by default; set it (or add the `DocsModule`) to expose the cake. Fully open, no auth ([07-cake.md](07-cake.md)). | `bootstrap-server/mod.ts` |
| `KEEP_DEV` | — | The `rune dev` status/reload channel (`/docs/_dev`); set by `rune dev`, not by hand. Orthogonal to `KEEP_DOCS`. | `bootstrap-server/mod.ts` |
| `KEEP_FIXTURES_DIR` | resolved (see below) | Override the directory for cake/heal fixtures (`cake.json`, scenarios, heal rules). Otherwise resolved: the shared `spec/misc` when a `spec/` exists, else legacy `fixtures/`. | `fixtures-store/mod.ts`, `src/rune/entrypoints/sync/mod.ts` |
| `RUNE_ASSERT` | on | The `#assert` runtime. `=off` makes every seam assertion a passthrough (validation disabled — a loud, committed choice, surfaced in prod). | `keep/src/assert/mod.ts` |
| `DENO_ENV` | — | `=production` excludes ghost-stub endpoints from the module registry. Independent of `DENO_DEPLOY` (the substrate's Datadog `env:production` tag) — a Deno Deploy run does not imply `DENO_ENV=production`. A production deploy must set `DENO_ENV=production` explicitly to exclude ghost stubs. | `src/rune/entrypoints/sync/mod.ts` |
| `PRIVATE_CLAUDE_URL` | — | The private-Claude heal service the cake's Ask-Claude tier calls (`/docs/_heal`). Its own service, unrelated to keep auth. | `keep/.../heal/mod.ts` |
| `PRIVATE_CLAUDE_TOKEN` | — | Optional `Bearer` token for that heal service. | `keep/.../heal/mod.ts` |

## rune CLI & engine

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `RUNE_LINT_STRICT` | off | `rune lint --strict` sets it (`=1`); strict-gated rules (`rune-heal-todo`) fail on un-enriched entries. | `src/bootstrap/mod.ts`, `rune-heal-todo/mod.ts` |
| `RUNE_STRICT` | off | Alias for `RUNE_LINT_STRICT` — either enables strict mode. | `rune-heal-todo/mod.ts` |
| `RUNE_E2E` | off | Run the generated `e2e.test.ts` files (they carry `ignore: !RUNE_E2E`, so `deno test` skips them unless this is set). | `rune-manifest/mod.ts` |
| `RUNE_HOME` | `~/.rune` | Override the global rune state dir (the shared-dev-process registry `dev.json` + rotating logs). | `src/rune/entrypoints/dev/registry.ts` |
| `RUNE_BIN_DIR` | resolved | Where the front door looks for the `rune-lsp` / `rune-syntax` helper binaries (before next-to-binary, `lang/target`, PATH). | `src/bootstrap/mod.ts` |
| `SHAPE_NO_LSP` | off | Disable the linter's LSP semantic enrichment (some rules degrade to structural-only). | `pipeline/mod.ts` |
| `OPENAI_API_KEY` | — | Enables the linter's optional LLM fix suggestions (`gpt-4.1-mini`); absent → deterministic suggestions only. | `src/rune/domain/data/llm/openai.ts` |
| `HOME` / `USERPROFILE` | OS | Home-dir resolution for `RUNE_HOME`/`init` (standard OS vars). | `dev/registry.ts`, `init/mod.ts` |

## Install, release & versioning

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `RUNE_INSTALL` | `~/.deno` area | Install prefix for the `rune` binaries (`install.sh` / `rune update`). | `install.sh`, `uninstall.sh`, `update/mod.ts` |
| `RUNE_REF` | `main` | Git ref `install.sh` fetches the skills/`MANIFEST.txt` fallback from. | `install.sh` |
| `RUNE_VERSION` | latest | Pin the release `install.sh` installs. | `install.sh` |
| `RUNE_VERSION_OVERRIDE` | — | Build-time: stamp an explicit version into `version.gen.ts` (the `v` prefix is stripped). | `scripts/gen-version.ts` |
| `RUNE_BUILT_AT_OVERRIDE` | — | Build-time: stamp an explicit build timestamp. | `scripts/gen-version.ts` |
| `GITHUB_SHA` | — | CI-provided commit SHA baked into the version metadata. | `scripts/gen-version.ts` |
| `RUNE_BIN` | `~/.local/bin` | The Rust `rune-syntax install`'s target bin dir. | `lang/cli/src/commands/install.rs` |
| `RUNE_DATA` | platform data dir + `/rune` | The Rust `rune-syntax install`'s data dir (parsers, configs). | `lang/cli/src/commands/install.rs` |

## Test-only

Not product configuration — used only by the test suites.

| Variable | Purpose | Read at |
| --- | --- | --- |
| `KEEP_BROWSER` | Gate the Playwright browser suites (emulator-ui, map-ui, e2e). | `emulator-ui/browser.test.ts`, `e2e/**` |
| `KEEP_HEADED` | Run those browser tests headed. | `e2e/**` |
| `KEEP_PLAYWRIGHT_SMOKE` | Gate the exercise-harness Playwright smoke. | `exercise-harness/smk.test.ts` |
| `CI` | Skip environment-dependent smoke tests (LLM/LSP) in CI. | `llm/smk.test.ts`, `lsp/smk.test.ts` |
