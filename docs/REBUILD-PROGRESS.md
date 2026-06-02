# Rune Studio rebuild — progress

Executes `rune/new/studio/instructions.md` (P0 + WO-1…WO-7). The done-signal is
the gate: `deno task verify [--gate Lx]` (exit 0/1).

## Gate roster — all green

```
deno task verify
[PASS] Drift       regeneration reproduces every derived artifact byte-for-byte
[PASS] corpus      13 valid + 9 invalid specs; every verdict matches its tag
[PASS] L1          contract + meta-validator; 8 crafted-invalid fixtures rejected
[PASS] L0          parse / manifest / lint --json byte-identical across two runs
[PASS] L2          parse goldens match
[PASS] L3          codegen (manifest) goldens match
[PASS] L4          lint goldens match
[PASS] L5          Studio interpreter == engine (preview byte-equals output)
[PASS] L6          binding + codegen-template + parse-recognition + lint-policy
                   + end-to-end UI-data-path mutations each change engine
                   behaviour with empty `git diff --stat src/`
[PASS] L7          N-1 artifact migrates and the corpus still parses + generates
[PASS] governance  locked rules cannot be weakened (disable/downgrade rejected)
[PASS] grammar     regenerated from artifact + compiled to WASM; all tags wired
verify: GREEN
```

Unit suite: 223 pass / 3 pre-existing failures (`data-class-returns` ×2 +
env-sensitive git-root smoke test — present before this work, untouched).

## Work orders

| WO | Gate | Branch(es) |
| --- | --- | --- |
| P0 — ADRs D0–D7 | recorded (`docs/adr/`) | `rebuild/p0-adrs` |
| WO-1 — single-source registry | Drift | `rebuild/wo1-single-source-registry` (rune) |
| WO-2 — verification foundation | corpus + L0 + L2/L3/L4 goldens | `rebuild/wo2-verification-foundation` |
| WO-3 — artifact contract + meta-validator | L1 | `rebuild/wo3-artifact-contract` (+ rune schemaVersion) |
| WO-4a — artifact-driven bindings | L3 + L6 (binding) | `rebuild/wo4a-artifact-bindings` |
| WO-4b — artifact-driven codegen templates | L3 + L6 (template) | `rebuild/wo4b-artifact-codegen` |
| WO-4c — artifact-driven parse recognition | L2 + L6 (synonym) | `rebuild/wo4c-artifact-parse` |
| WO-4d — artifact-driven lint policy | L4 + L6 (severity/enabled) | `rebuild/wo4d-artifact-lint` |
| WO-5 — share interpreter with Studio | L5 | `rebuild/wo5-shared-interpreter` |
| WO-6 — tree-sitter WASM build | grammar | `rebuild/wo6-tree-sitter` |
| WO-7 — governance + migrations + L6 e2e | L6 e2e + L7 + governance | `rebuild/wo7-governance-profiles` |

ADRs D0–D7 are committed. The Rust generation path is retired from the Studio
(`runegen.ts` deleted, `/api/generate` uses the shared engine). One engine drives
parse, codegen, lint, and the grammar — all from `rune/new/keywords.json`.

## Known follow-ups (scoped, not blocking any gate)

These deepen the cutovers the gates already prove on a representative slice:

- **Parser structural dispatch** (WO-4c): recognition is artifact-driven; the
  per-construct dispatch (`[REQ]` vs `[ENT]` both `follows: signature` yet emit
  different nodes) still lives in code. Generating it needs a novel-tag *role*
  field in the artifact's tag model.
- **rune-sig templating** (WO-4b): `sig.ts` + business/data `mod.ts` come from
  `rune-sig`, not yet expressed as artifact templates.
- **Studio island previews** (WO-5): `/api/generate` and the shared `lib/engine.ts`
  use the engine; `lib/parse.ts` / `lib/render.ts` / `lib/lint.ts` (the live
  in-browser lenses) are not yet reduced to wrappers over it.
- **Profiles UI** (WO-7/D7): `profiles[]` is in the schema and L1's profile-gap
  check; a pick/clone UI and per-profile template sets are not built.
- Close the nested-`[PLY]` engine gap (`fixtures/README.md`).

## Continuation seams

- `scripts/verify.ts` — add a gate to the `all` array; `--update-goldens`
  recaptures (review the diff); `SHAPE_NO_LSP=1` for deterministic lint.
- Goldens (`fixtures/golden/`) are the P3 baseline — keep them green.
- Artifact-driven pattern: an optional artifact input on the engine fn, a static
  default so the goldens hold, mutate-to-prove-L6 (`planManifest(...,{bindings,
  codegen})`, `parse(...,{tags})`, lint-config, governance overlay, migrate).
- Two repos: engine + fixtures + verify in the outer `shape-checker` repo; the
  registry + Studio + grammar in the nested `rune` repo. Source of truth:
  `rune/new/keywords.json`.
