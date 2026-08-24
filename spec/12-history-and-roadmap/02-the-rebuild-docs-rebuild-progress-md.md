## The rebuild (`docs/REBUILD-PROGRESS.md`)

`docs/REBUILD-PROGRESS.md` is a point-in-time record captured at the
rebuild's completion, not a live status. For what's green today and the
current counts, see [Current state, summarized](07-current-state-summarized.md)
and [Known state](../10-testing-and-verification/06-known-state.md)'s
Provenance note, which pins this record to 223 unit-suite passes / 3
pre-existing failures against a corpus that has since grown past what this
record's gate roster covered.

Seven work orders took the engine from hand-wired to artifact-driven, each
gated by the verify ladder ([10-testing-and-verification.md](../10-testing-and-verification/00-overview.md)):

| Work order | What it delivered | Gate(s) that lock it |
| --- | --- | --- |
| WO-1 | single-source registry | [Drift](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) |
| WO-2 | verification foundation — the corpus, plus the golden-baseline mechanism L2–L4 verify against | [corpus](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) |
| WO-3 | artifact contract + meta-validator | [L1](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) |
| WO-4a | artifact-driven bindings | [L6](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s binding facet, reflected in [L3](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s manifest golden |
| WO-4b | artifact-driven codegen templates | [L6](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s codegen-template facet, reflected in [L3](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s manifest golden |
| WO-4c | artifact-driven parse recognition | [L6](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s parse-recognition facet, reflected in [L2](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s parse golden |
| WO-4d | artifact-driven lint policy | [L6](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s lint-policy facet, reflected in [L4](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)'s lint golden |
| WO-5 | shared interpreter with the Studio | [L5](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) |
| WO-6 | tree-sitter WASM build | [grammar](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) |
| WO-7 | governance + migrations | [L6](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) (end-to-end lint-policy check), [L7](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md), [governance](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md) |

All gates were green at that snapshot.

**Scoped follow-ups (open):**

| Follow-up | Already in place | What's missing | Tracked in |
| --- | --- | --- | --- |
| Parser structural dispatch | Per-construct dispatch, hardcoded in the engine | A tag *role* field in the artifact, to drive dispatch generically | — |
| `rune-sig` templating | The sig/business/data split, hand-authored in the engine | Not yet expressed as artifact templates | — |
| Studio island previews | The shared engine (`lib/engine.ts`) backs the Code lens | `lib/parse.ts` isn't yet a wrapper over the engine — the Studio's own second parser still drives lint/UI modeling | [08-language-tooling/04](../08-language-tooling/04-rune-studio-rune-studio.md) |
| The profiles UI | The `profiles[]` schema + the L1 profile-gap check | No pick/clone UI | [08-language-tooling/01](../08-language-tooling/01-lang-keywords-json-the-artifact.md) |
| Nested-`[PLY]` lenient-parse gap | The lenient parse itself — normative for now, golden-pinned | Rejection — deferred to the artifact-driven parser/lint work | [02-language/03](../02-language/03-requirements-and-steps.md) |
| Post-relocation studio drift | — | Broken `keywords.json` registry path, stale README/aliases | [08-language-tooling/04](../08-language-tooling/04-rune-studio-rune-studio.md) |

