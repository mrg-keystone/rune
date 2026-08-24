## Cross-boundary contracts

These are the seams that keep the pieces from drifting — most are
machine-checked (see [10-testing-and-verification.md](../10-testing-and-verification/00-overview.md));
each row's Guard column is authoritative for how, or whether, it's checked:

| Contract | Between | Guard |
| --- | --- | --- |
| **Decorator-stack lockstep** — the three-package decorator stack (`class-validator` / `class-transformer` / `reflect-metadata`) rune writes into generated projects (`REQUIRED_IMPORTS` in `src/rune/entrypoints/sync/mod.ts`; authoritative pin set: [03-cli.md § `rune sync` — semantics that matter, step 4](../03-cli/02-rune-sync-semantics-that-matter.md)) must byte-equal keep's own `keep/deno.json` ranges. Drift breaks the single-copy invariant (class-transformer's `@Type` store is per-copy) → nested validation silently degrades or `bootstrapServer()` throws at load. | src ↔ keep | `scripts/check-keep-lockstep.ts` (`deno task check:lockstep`) |
| **Framework + assert pins share a major** (`@^4` / `@^4/assert`) — retarget both on every keep major. *Not* covered by the lockstep guard; kept by hand (`docs/assert-runtime.md`). | generated projects ↔ keep | manual |
| **`x-keep-process`** — the OpenAPI vendor extension carrying the endpoint's process metadata (shape and per-field presence rules owned by [06-runtime.md § Emitted `x-keep-process`](../06-runtime/02-endpoint-endpointcontroller.md#emitted-x-keep-process)). Rune computes it from the spec; keep's self-verification surfaces consume it — the interactive cake docs page (`/docs/<module>`), the system map, and the headless runner (`exerciseEndpoints`), all runtime code under `keep/src/foundation/` ([07-cake.md](../07-cake/00-overview.md)). | src ↔ keep | `e2e/` acceptance suites |
| **Heal-rules shape** — the slug → suggestion JSON rune generates and keep executes. | src ↔ keep | e2e + `rune-heal-todo` lint |
| **Codegen templates** — the engine's `DEFAULT_TEMPLATES` is the canonical copy, mirrored byte-identically into `keywords.json → codegen.templates` — the one seam where authority flows *into* `keywords.json` (the language artifact). On drift, `scripts/gen-codegen-templates.ts` rewrites the keywords.json side from the engine (the engine side is the hand-edited one). | src ↔ lang | `scripts/gen-codegen-templates.ts` — manual regenerator (consistency checked by L3/L6/L7, *not* regenerated-and-diffed by the Drift gate) |
| **Grammar + highlights** — `lang/grammar/grammar.js` and `lang/queries/highlights.scm` generated from `keywords.json`. | lang internal | `scripts/generate.mjs` + Drift gate |
| **Artifact JSON schema** — `lang/artifact.schema.json` emitted from the engine's Zod `ArtifactSchema`. | src ↔ lang | `scripts/gen-artifact-schema.ts` — regenerable, *not* drift-gated (no gate regenerates or diffs it; L1 only validates `keywords.json` + fixtures against the Zod schema, and the Drift gate diffs only grammar + highlights) |
| **Canonical shape docs** — `docs/canonical-shape.md` generated from `keywords.json → canonicalPaths`. | lang ↔ docs | `scripts/gen-shape-docs.ts` — regenerable (run via `deno task setup`), not gated: no drift check verifies it against `keywords.json` |
| **Rust ↔ TS parser parity** — `rune-lsp` diagnostics must mirror exactly what the TS parser of record enforces (structure + shape, deliberately no scope rules). | lang ↔ src | corpus-parity tests in `lang/lsp/src/main.rs` |
| **Skill references** — `lang/docs/{spec,constraints,cookbook}.md` + `examples/todos/*.rune` copied into `claude/skills/rune:spec/references/`. | lang ↔ claude | `scripts/sync-spec-skill-refs.ts --check` |
| **Agent guardrail** — the shared "never crawl the filesystem" block injected into every `claude/agents/*.md`. | scripts ↔ claude | `scripts/sync-agent-guardrail.ts --check` |

