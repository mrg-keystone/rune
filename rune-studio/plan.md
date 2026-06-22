# Plan: make the Studio the authoring surface and the engine an interpreter

_Execution plan derived from [`gaps.md`](./gaps.md). Audience: the agent (and
its reviewer) that will own the rebuild. Assumes you've read gaps.md — this is
the "what to do, in what order" layer. **"Done" for every build phase is defined
as a runnable gate in [`verification.md`](./verification.md), not as prose or
elapsed time.** Phases are ordered by dependency and gate, not schedule._

## The one-sentence goal

Collapse today's 3–4 parallel implementations of parse/codegen/lint into **one
versioned artifact** authored in the Studio and **one engine (shape-checker, TS)
that is a pure interpreter of it**, with the Studio preview running that same
interpreter so what-you-see equals what-the-engine-emits.

## Critical path

```
P0 decisions ─▶ P1 drift cleanup ─▶ P2 artifact contract ─▶ P3 interpreter ─▶ P4 shared preview
                                                  │                                    │
                                                  └────────▶ P5 tree-sitter build ◀─────┘
                                                                     │
                                                                     ▶ P6 UI authoring + governance
```

P2 is the linchpin (the UI↔engine interface). P3 is the bulk of the work and is
its own sub-project. P5 can run in parallel once P2 lands. Don't start P3 before
P0/P2 are signed off — you'll build on sand.

**The Verification foundation (VF) sits between P1 and P2 and gates everything
downstream.** It builds the corpus, the `--json` lint output, the determinism
check, and the captured goldens. Until VF exists there is no oracle, and an
agent cannot self-verify any later phase — see `verification.md`. Today the repo
has exactly **one** `.rune` spec, so this is real work, not a formality.

---

## P0 — Resolve the blocking decisions _(human gate)_

Closes the design ambiguity behind G6, G7, G11, G12, G13. **No code until these
are signed off.** Recommended resolutions below are grounded in `design.md` /
`new-product.md` — confirm or override, then record as ADRs in `docs/adr/`.

| # | Decision | Recommended (confirm) | Source |
| --- | --- | --- | --- |
| D1 | One engine? | **shape-checker (TS)** is the sole artifact-driven engine; Rust binary retired from generation, kept LSP-only. | design.md "drop the Rust parser from the runtime path" |
| D0 | Primary user? | **Spec authors** are the default surface; language-design is a separate **admin/expert mode**, not the landing page. | G11 |
| D2 | Parser of record? | Engine parses with a **TS parser generated from the artifact**; tree-sitter is **editor-only**, built separately. | G6 |
| D3 | Lint model? | **Declarative rule DSL** for the reducible rules + a **typed code escape-hatch** for the rest. | G3 |
| D4 | Layout source of truth? | **Codegen path templates** are canonical; generate `canonical-paths.json` from them (preserve `$forbiddenDirNames`/`$looseFileNames`/optional-`?`). | G5 |
| D5 | Versioning? | **Semver the artifact** (`schemaVersion`); ship migrations; stamp generated output with the version. | G8 |
| D6 | Governance? | **Locked org baseline** + project-level overlay; provenance on every change. | G12 |
| D7 | Artifact axes? | Split **target-independent language** from **N selectable codegen profiles**. | G13 |

**Done when:** seven ADRs merged. Everything below assumes the recommended set;
if you override D1 or D2, re-plan P3/P5.

---

## P1 — Kill the drift, single source the registry _(gate: Drift)_

Closes **G10**. Cheap, high-trust, and it stops the bleeding before you build on
top. Do this first regardless of P0 outcomes.

Tasks:
- Pick the one registry of record. Recommended: `rune/new/keywords.json`
  (the anti-drift original), and **generate** `studio/data/keywords.json` and
  `rune/grammar/grammar.js` from it via the existing `rune/new/generate.mjs`.
- Delete the hand-forked divergences: reconcile `[MOD]`/`[ENT]`, add `[CTR]` as
  the `[NEW]` synonym (matches `rune-parse/mod.ts:326`), model `:core` as a
  first-class modifier.
- Fold `lib/catalog.ts` (the competing "authoritative catalog") into the
  registry; derive the Reference page from the registry, not a hand list.
- Fix `studio/README.md` (island is `Reference.tsx`, not `Studio.tsx`) and the
  registry `description` (it omits codegen/lint/shape-checker).
- Add a CI check: regenerate from source and `git diff --exit-code` to prove no
  hand-edits to generated files.

**Gate (Drift):** one source file; `generate.mjs` reproduces every derived
artifact byte-for-byte; CI fails on drift; `grep` finds no second "authoritative"
construct list.

---

## VF — Verification foundation _(gate: Corpus health + L0; goldens captured)_

Closes the oracle gap. **Nothing downstream is verifiable without this**, and it
must be built against **today's** engine so it captures current behaviour as the
baseline. Full definition in [`verification.md`](./verification.md).

Tasks:
- Build `fixtures/corpus/` — a representative, tagged (`valid`/`invalid`) body of
  `.rune` specs covering every tag, boundary, `:core`, faults, polymorphism,
  scope edges, multi-module, and error paths. (Repo has 1 spec today.)
- Add `--json` to the lint path (`src/shape-checker/entrypoints/cli.ts`);
  `manifest` already has it. Stable, sorted `{rule,path,line,message}[]`.
- Wire `deno task verify [--gate Lx]` → single deterministic exit 0/1.
- Implement **L0 determinism** (run twice, byte-identical) and the **Drift** gate
  harness.
- Capture **L2/L3/L4 goldens** from the current engine into `fixtures/golden/`
  and commit them. These are the baseline P3 must preserve.

**Gate:** corpus verdicts match their tags; `deno task verify` runs green on the
current engine; goldens committed; `--json` lint output stable across two runs.

---

## P2 — Define the artifact contract + meta-validator _(gate: L1)_

Closes **G8**. This is the interface every other phase depends on. Get it right.

Tasks:
- Write `artifact.schema.json` (JSON Schema, versioned) covering the four
  concerns as **separable sections**: `language` (tags, `follows`, indent,
  boundaries, builtins, tokens — target-independent), `lint` (rules), `codegen`
  (per-profile templates), and top-level `schemaVersion` + `profiles[]` (D7).
- Generate TS types from the schema (single source for engine + Studio).
- Build a **meta-validator** (`lib/artifact/validate.ts`) that the engine runs
  on load: rejects templates referencing unknown tags, contradictory
  indent/`follows`, duplicate ids, profile gaps. Exit non-zero with line refs.
- Golden fixtures: `fixtures/artifact/{valid,invalid}/*.json` with expected
  validator verdicts.

**Acceptance:** meta-validator accepts the current registry and rejects each
crafted-bad fixture with a precise message; types compile against both the
engine and Studio; `schemaVersion` present and checked.

---

## P3 — Make shape-checker a pure interpreter _(gates: L2/L3/L4 + L6; own sub-project)_

Closes **G1, G2, G4** and the engine side of **G3**. This is effectively a
rewrite of the generation/lint core. Break into four shippable milestones; keep
the old hardcoded path behind a flag until each milestone reaches parity.

### P3a — Artifact-driven bindings
Replace the hardcoded `src/shape-checker/domain/business/rune-bindings/mod.ts`
map and the static `assets/canonical-paths.json` reads with values resolved from
the artifact's `codegen`/`language` sections.
**Acceptance:** `rune-bindings/test.ts` passes with bindings sourced from the
artifact; deleting a binding from the artifact changes the resolved path with no
code change.

### P3b — Artifact-driven codegen
Move template evaluation into the engine. Promote the cross-cutting concerns
gaps.md flagged out of code and into **interpreter features configured by the
artifact**: purity classification (boundary-driven), aggregated files
(`dto/_shared.ts`, `mod-root.ts` barrels), DTO→validation-schema generation, and
the `manifest`/`sync`/`prune` idempotency lifecycle
(`generate.rs:41` "skip if exists anywhere" → TS).
Rework `rune-manifest/mod.ts` + `rune-sync/mod.ts` to read templates from the
artifact.
**Acceptance:** editing a codegen template in the artifact changes
`shape-checker manifest <spec>` output with **no recompile**; existing
`rune-manifest` / `rune-sync` tests pass; a golden spec corpus generates
identical trees before/after the cutover.

### P3c — Artifact-driven parse
Generate the engine's parser from the artifact's `language.tags` table (per D2),
replacing the hand-maintained tag handling in
`src/shape-checker/domain/business/rune-parse/mod.ts`.
**Acceptance:** adding a tag to the artifact makes the engine parse it with no
parser edit; `rune-parse/test.ts` regenerated and green; round-trips the spec
corpus identically to the hand-port.

### P3d — Lint rule model
Build the declarative rule DSL + typed escape-hatch (D3). Port all **23**
registered rules (`src/shape-checker/mod-root.ts`) onto it; the reducible ones
become artifact data, the AST-heavy ones (e.g. `layer-restrictions` 95 L,
`barrel-discipline`) keep code but register through the same interface.
**Acceptance:** all 23 rules' existing tests pass under the new model; changing a
rule's `severity`/`params` in the artifact changes a real `shape-checker .` run;
no rule logic lives in two places.

---

## P4 — Share the interpreter with the Studio (WYSIWYG) _(gate: L5)_

Closes **G9** and the Studio side of **G2**. The whole product promise depends
on preview == output.

Tasks:
- Replace the Studio's reimplementations (`lib/parse.ts` 337 L, `lib/render.ts`
  353 L, `lib/lint.ts` 994 L) with thin wrappers over the P3 engine modules.
- Retire the `lib/runegen.ts` → Rust-binary bridge (per D1) and the
  "compare against real CLI" affordance — it diffs an incompatible layout.
- Add a **conformance test**: for a spec corpus, assert Studio preview output
  byte-equals engine output. Wire it into CI.

**Acceptance:** the three `lib/*` engines are gone (or are ≤1-screen wrappers);
the conformance test passes on the corpus and gates merges.

---

## P5 — tree-sitter build pipeline _(gate: grammar regenerates; parallel after P2)_

Closes **G6**. Editor highlighting only — keep it off the engine's hot path.

Tasks:
- Stand up a build step that compiles the artifact-generated `grammar.js` to a
  usable parser (tree-sitter CLI → WASM); the browser/UI consumes the WASM, it
  doesn't compile.
- Keep `rune/cli/src/commands/install.rs` (or its successor) as the editor
  distribution path; regenerate grammar+highlights from the artifact on build.

**Acceptance:** a tag/colour change in the artifact, after the build step,
recolours both the in-Studio editor and a target external editor; no hand edits
to generated grammar.

---

## P6 — UI authoring + governance + profiles _(gates: L6 end-to-end + L7; after P3/P4)_

Closes **G11, G12, G13**. Only here does end-to-end low-code editing produce real
engine behaviour change.

Tasks:
- Separate **spec-author mode** (default) from **language-design mode** (admin),
  per D0 — don't show the language registry editor to spec authors.
- Implement the **locked baseline + project overlay** governance model (D6):
  mark rules/layout as org-locked vs project-tunable; record provenance/author on
  every artifact change; surface an audit trail.
- Implement **codegen profile selection** (D7): one language, N selectable
  targets; UI to pick/clone a profile rather than editing baked `vars`.
- Add artifact **versioning + migrations** UX (D5): bump `schemaVersion`, run
  migrations over existing `.rune` specs and stamp generated output.

**Acceptance:** a spec author cannot weaken a locked rule; switching profiles
regenerates against a different target without touching the language; editing a
tunable rule in the UI changes a real `shape-checker .` result, attributed and
audited.

---

## Verification

Defined in full in [`verification.md`](./verification.md) — the gate ladder
(L0–L7 + Drift), the corpus prerequisite, and the agent-execution contract
(one deterministic command, binary pass/fail, no human-in-the-loop inside the
build loop). Two tactics worth restating here:

- **Capture goldens before P3, refactor to green.** P3 is behavior-preserving;
  the current engine's output _is_ the spec. Keep the legacy hardcoded path
  behind a flag through P3 so each milestone diffs against it before deletion.
- **L6 is the gate that proves the product.** Mutate the artifact, assert output
  changes and `src/` does not. If L6 can't pass, the engine isn't artifact-driven
  and nothing else matters.

## Non-goals (explicitly out)

- Keeping two generation engines. The Rust binary is LSP/editor-only after D1;
  do not dual-maintain codegen in Rust.
- LLM integration in the product (per `new-product.md`).
- A general-purpose grammar workbench. This authors **Rune**, not arbitrary
  languages.
- In-browser tree-sitter compilation (P5 builds WASM out-of-band).

## Sequencing summary

| Phase | Closes | Gate (done-when) | Depends on |
| --- | --- | --- | --- |
| P0 decisions | G6/G7/G11/G12/G13 framing | ADRs merged (human) | — |
| P1 drift | G10 | Drift | — |
| VF foundation | — (oracle) | Corpus health + L0 + goldens captured | P1 |
| P2 contract | G8 | L1 | P0, VF |
| P3 interpreter | G1/G2/G4/G3 | L2/L3/L4 + L6 | P0, P2, VF |
| P4 shared preview | G9, G2 | L5 | P3 |
| P5 tree-sitter | G6 | grammar regenerates | P2 (parallel) |
| P6 UI + governance | G11/G12/G13 | L6 e2e + L7 | P3, P4 |

Start P1 immediately (independent of P0). Build VF before anything downstream —
it's the oracle. Land P0 + P2 before committing to P3.
