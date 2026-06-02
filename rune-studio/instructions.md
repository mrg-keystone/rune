# Instructions: execute the Rune Studio rebuild (all of it)

_Operating manual for the agent doing the work. Read [`gaps.md`](./gaps.md)
(what's broken), [`plan.md`](./plan.md) (the sequence), and
[`verification.md`](./verification.md) (the oracle) first — this file tells you
how to execute them end to end._

## Mission

Turn the Studio into the authoring surface and shape-checker into a pure
interpreter of a single versioned artifact, with the Studio preview running that
same interpreter. End state: editing the Rune language in the UI changes real
generation and lint behaviour with no engine recompile, and every verification
gate (L0–L7 + Drift) is green.

## Scope mandate — do all of it

Execute **every** phase below, in order, to completion. Do not stop after the
"foundational" phases. Do not descope, defer, or substitute a partial solution
and call it done. Do not re-open the committed decisions to avoid work. The
project is finished when **all 13 gaps in `gaps.md` are closed and every gate in
`verification.md` is green** — not before. If a phase is large, break it into
commits, but keep going until its gate passes.

## How to work (the loop)

For each work order:

1. **Branch.** Work on `rebuild/<work-order>`; never on `main`/`dev` directly.
2. **Read the gate first.** Find the work order's gate (a `deno task verify`
   command). Run it. It should be **red** before you start — that's the target.
3. **Do the work.** Touch only the files the work order names plus what they
   require.
4. **Make the gate green.** The gate — not your own assessment — is the
   done-signal. "It looks correct" is not done. "`deno task verify --gate Lx`
   exits 0" is done.
5. **Commit** with the gate named in the message (e.g. `P3b: L3 green`).
6. **Move to the next work order.** Do not batch unrelated phases into one
   branch.

### Hard rules (violating these fails review)

- **Never declare done without the gate passing.** No exceptions.
- **Never edit a golden file without intent.** A golden diff means behaviour
  changed; it must be deliberate and called out in the commit. Unreviewed golden
  churn is the #1 failure mode — treat it as a red flag, not a fixup.
- **One engine.** All generation/lint logic lives in shape-checker (TS). Do not
  add a second copy, do not keep the Rust generation path alive, do not
  dual-maintain templates in Rust.
- **No LLM calls in the product.** The engine doesn't call, embed, or prompt
  LLMs (per `new-product.md`). The agent building it is not the product.
- **Keep the legacy path behind a flag through P3** so each milestone can be
  diffed against current behaviour, then delete it once its gate is green.
- **Determinism is sacred.** No timestamps, UUIDs, or unordered map/set
  serialization in any output path. L0 guards this; don't route around it.

---

## Committed decisions (do NOT re-litigate)

These were the P0 decisions. They are **made**. Write them as ADRs in
`docs/adr/` to record them, then execute against them. Do not turn them back
into open questions to avoid work.

- **D1 — One engine.** shape-checker (TS) is the sole artifact-driven engine.
  The Rust binary is retired from generation and kept LSP/editor-only.
- **D0 — Audience.** Spec-author mode is the default surface; language-design is
  a separate admin/expert mode. Build both; don't show the registry editor to
  spec authors.
- **D2 — Parser of record.** The engine parses with a TS parser generated from
  the artifact's tag table. tree-sitter is editor-only, built out-of-band (P5).
- **D3 — Lint model.** Declarative rule DSL for the reducible rules + a typed
  code escape-hatch for the AST-heavy ones; all rules register through one
  interface.
- **D4 — Layout.** Codegen path templates are canonical; `canonical-paths.json`
  is generated from them, preserving `$forbiddenDirNames` / `$looseFileNames` /
  optional-`?` semantics.
- **D5 — Versioning.** Artifact carries `schemaVersion` (semver); ship
  migrations; stamp generated output with the version.
- **D6 — Governance.** Locked org baseline + project overlay; provenance/author
  recorded on every artifact change.
- **D7 — Axes.** Target-independent `language` is separate from N selectable
  per-target `codegen` profiles.

---

## Execution order

### WO-1 — Single-source the registry (P1) · gate: **Drift**

Kill the three-way drift before building on it.

- **Touch:** `rune/new/keywords.json` (source of record), `rune/new/generate.mjs`,
  generated `rune/grammar/grammar.js`, `rune/new/studio/data/keywords.json`,
  `rune/new/studio/lib/catalog.ts`, `studio/README.md`.
- **Steps:** make `rune/new/keywords.json` the only hand-edited registry; generate
  `studio/data/keywords.json` + grammar from it. Add `[CTR]` as `[NEW]` synonym
  (`rune-parse/mod.ts:326`), model `:core` as a first-class modifier, reconcile
  `[MOD]`/`[ENT]`. Fold `catalog.ts` into the registry (derive the Reference page
  from it). Fix README (island is `Reference.tsx`) and the registry `description`.
- **Gate:** regenerate-from-source + `git diff --exit-code` is clean; `grep` finds
  no second "authoritative" construct list.

### WO-2 — Verification foundation (VF) · gate: **Corpus health + L0; goldens captured**

Build the oracle against **today's** engine. Nothing downstream is verifiable
without this.

- **Touch:** `fixtures/corpus/`, `fixtures/golden/`, `fixtures/artifact/{valid,invalid}/`,
  `src/shape-checker/entrypoints/cli.ts`, `deno.json` (add `verify` task).
- **Steps:**
  1. Write `fixtures/corpus/` — one+ spec per construct, tagged `valid`/`invalid`,
     covering every tag, boundary, `:core`, faults (0/1/many), polymorphism
     (single/many/disallowed-nested), scope edges, multi-module, error paths,
     plus 2–3 realistic end-to-end specs. (Repo has 1 spec today — this is real
     work.)
  2. Add `--json` to the lint path in `cli.ts`: stable, sorted
     `{rule,path,line,message}[]`.
  3. Implement `deno task verify [--gate Lx]` → single deterministic exit 0/1.
  4. Implement **L0** (run twice, byte-identical) and the **Drift** gate.
  5. Capture **L2/L3/L4 goldens** from the current engine into `fixtures/golden/`
     and commit them. This is the baseline P3 must preserve.
- **Gate:** corpus verdicts match tags; `deno task verify` green on current
  engine; goldens committed; `--json` lint stable across two runs.

### WO-3 — Artifact contract + meta-validator (P2) · gate: **L1**

- **Touch:** `artifact.schema.json`, generated TS types, `lib/artifact/validate.ts`,
  `fixtures/artifact/{valid,invalid}/`.
- **Steps:** write the versioned JSON Schema with separable sections —
  `language` (tags/follows/indent/boundaries/builtins/tokens, target-independent),
  `lint`, `codegen` (per-profile), `schemaVersion`, `profiles[]` (D7). Generate TS
  types (one source for engine + Studio). Build a meta-validator the engine runs
  on load: reject unknown-tag references, contradictory indent/follows, duplicate
  ids, profile gaps — with line refs and non-zero exit.
- **Gate:** **L1** — validator accepts the current registry, rejects every crafted
  `invalid/` fixture with a precise message; types compile against engine + Studio.

### WO-4 — Make shape-checker a pure interpreter (P3) · gates: **L2/L3/L4 + L6**

The bulk. Four sub-orders; legacy path stays flag-gated until each is green.

- **WO-4a — bindings.** Replace hardcoded `rune-bindings/mod.ts` map + static
  `canonical-paths.json` reads with artifact-resolved values.
  **Gate:** L3 holds; **L6** passes for a binding mutation.
- **WO-4b — codegen.** Move template eval into the engine; promote purity
  classification, aggregated files (`dto/_shared.ts`, `mod-root.ts` barrels),
  DTO→schema generation, and the `manifest`/`sync`/`prune` idempotency lifecycle
  (`generate.rs:41` "skip if exists" → TS) into interpreter features configured by
  the artifact. Rework `rune-manifest/mod.ts` + `rune-sync/mod.ts`.
  **Gate:** **L3** + **L6** for a template mutation.
- **WO-4c — parse.** Generate the engine parser from `language.tags` (D2),
  replacing hand-maintained tag handling in `rune-parse/mod.ts`.
  **Gate:** **L2**; adding a tag to the artifact parses with no parser edit.
- **WO-4d — lint model.** Build the DSL + typed escape-hatch (D3); port all **23**
  rules registered in `src/shape-checker/mod-root.ts` onto it.
  **Gate:** **L4** (all rule tests green under the new model) + **L6** for a
  severity mutation; no rule logic in two places.

### WO-5 — Share the interpreter with the Studio (P4) · gate: **L5**

- **Touch:** `lib/parse.ts`, `lib/render.ts`, `lib/lint.ts`, `lib/runegen.ts`,
  `routes/api/{generate,check}.ts`.
- **Steps:** replace the Studio's reimplementations with thin wrappers over the
  WO-4 engine modules. Retire the `runegen.ts` Rust-binary bridge and the
  "compare against real CLI" affordance (per D1). Add the conformance test.
- **Gate:** **L5** — Studio preview output byte-equals engine output across the
  corpus; the three `lib/*` engines are gone or ≤1-screen wrappers.

### WO-6 — tree-sitter build pipeline (P5) · gate: **grammar regenerates**

Runnable in parallel after WO-3.

- **Steps:** stand up an out-of-band build that compiles the artifact-generated
  `grammar.js` to WASM for the editor; keep `cli/.../install.rs`'s successor as the
  external-editor distribution; regenerate grammar+highlights from the artifact on
  build.
- **Gate:** a tag/colour mutation in the artifact, after build, recolours both the
  in-Studio editor and a target external editor; no hand edits to generated grammar.

### WO-7 — UI authoring + governance + profiles (P6) · gates: **L6 e2e + L7**

- **Steps:** separate spec-author mode from language-design admin mode (D0);
  implement locked-baseline + project-overlay governance with provenance/audit
  (D6); implement codegen-profile selection (D7); implement `schemaVersion` bump +
  migrations over existing specs and stamped output (D5).
- **Gate:** **L6 end-to-end from the UI** (edit artifact in UI → real
  `shape-checker .` result changes, `src/` unchanged); **L7** (N-1 specs migrate
  and still work); a spec author provably cannot weaken a locked rule.

---

## Definition of done (whole project)

- All 13 gaps in `gaps.md` (G1–G13) closed.
- `deno task verify` green across **L0–L7 + Drift**.
- One engine; the Rust generation path deleted; the Studio `lib/*` reimplementations
  deleted.
- L6 passes from the UI: editing the artifact changes engine behaviour with an empty
  `git diff --stat src/`.
- ADRs for D0–D7 committed.

Stop only when the above is all true. If you reach an apparent blocker, fix it and
continue — do not narrow the goal to make it reachable.
