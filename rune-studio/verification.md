# Verification: the oracle an agent builds against

_Companion to [`plan.md`](./plan.md). This defines what "done" means as runnable
pass/fail, because the work is being done by an LLM agent that has no judgment to
fall back on and will declare plausible-but-wrong output as finished unless an
external oracle says otherwise._

## The rule

Every build phase is gated by **one deterministic command that exits 0 or 1**.
No "looks right," no human spot-check inside the build loop. If a phase's gate
isn't a command an agent can run, the phase isn't ready to start.

```
deno task verify            # runs the whole ladder, exit 0/1
deno task verify --gate L3  # runs one gate
```

## Why characterization-first (this is the crux)

P3 is a **behavior-preserving refactor**: hardcoded engine → artifact-driven
engine. The only trustworthy oracle for that is the **current engine's own
output, frozen before you touch it**. The agent's success signal is "the
captured goldens still match," not "the new output looks plausible." You cannot
capture this baseline after refactoring — so capturing it is the first task, not
a later one.

For the *new* behavior (artifact-driven, governance), the oracle is a **property
test**: mutate only the artifact, assert the output changed _and_ engine source
did not (see L6 — this is the gate that actually proves "low-code").

---

## Prerequisite 0 — The corpus _(blocks everything; build first)_

There is **one** `.rune` file in the repo today (`rune/docs/example.rune`).
Golden and conformance gates are meaningless without a representative body of
specs. Build `fixtures/corpus/` covering, at minimum:

- every tag: `[REQ] [MOD] [ENT] [PLY] [CSE] [NEW]/[CTR] [RET] [TYP] [DTO] [NON]`
- `:core` variants of `[DTO]`/`[TYP]`
- every boundary prefix: `db: fs: mq: ex: os: lg:`
- faults: a step with 0, 1, and many
- polymorphism: one case, many cases, and the disallowed nested-`[PLY]`
- scope: in-scope, out-of-scope param, static `::` vs instance `.`
- DTO shapes: inline `{}` vs reference, the `Dto` suffix rule
- multi-module specs (for module-isolation)
- **invalid specs** — the parser/validator error paths are behavior too
- 2–3 realistic end-to-end module specs

**Gate (corpus health):** every spec is either tagged `valid` or `invalid`, and
the current engine's verdict matches the tag. Without this, the ladder below has
nothing to stand on.

---

## Prerequisite 1 — Machine-readable engine output

`shape-checker .` prints ANSI text (`src/shape-checker/entrypoints/cli.ts`); only
`manifest` has `--json`. Add `--json` to the lint path emitting a stable,
sorted `{rule, path, line, message}[]`. Agents assert on JSON, not on coloured
text. Small task, hard blocker for L4+.

---

## The ladder

Each rung is independently runnable and ordered by what it depends on.

| Gate | Proves | Mechanism | Blocks |
| --- | --- | --- | --- |
| **L0 Determinism** | Output is stable enough to golden | Run any pipeline twice on the corpus; byte-identical | all goldens |
| **L1 Meta-validation** | The artifact contract holds | `valid/` and `invalid/` artifact fixtures → expected verdict + message | P2 |
| **L2 Parse golden** | Spec → AST unchanged | corpus → AST JSON, diffed against captured goldens | P3c |
| **L3 Codegen golden** | Spec + artifact → file tree unchanged | corpus → generated tree, diffed against captured goldens | P3b |
| **L4 Lint golden** | Project → violations unchanged | fixture projects → `--json` violations, diffed | P3d |
| **L5 Conformance** | Studio preview ≡ engine | `preview(spec) === engine(spec)` across corpus, byte-exact | P4 |
| **L6 Artifact-driven property** | "Low-code" is real, not asserted | mutate only the artifact → output delta matches expectation **AND** `git diff --stat src/` is empty | P3, P6 |
| **L7 Migration** | Language edits don't orphan old specs | corpus at `schemaVersion N-1` → migrates and still parses/generates under `N` | P6 |
| **Drift** | Generated files aren't hand-edited | regenerate from source + `git diff --exit-code` | P1 |

### L0 — Determinism (do this with the corpus)
Ordering is already deterministic (`rune-manifest/mod.ts:91-93` sorts the plan;
no timestamps/UUIDs in the codegen path). L0 locks that in: any nondeterminism
introduced later (map iteration order, set serialization) fails here before it
poisons every golden.

### L3/L4 — Capturing goldens
Capture from **today's** engine into `fixtures/golden/<spec>/` and commit them
**before** P3 starts. During P3 the agent runs `--update-goldens` only when a
change is *intended*, and a human reviews the golden diff in the PR. An
unreviewed golden change is the failure mode to guard against — treat golden
diffs as the most scrutinized part of review.

### L6 — The differentiator gate
This is the one that proves the entire thesis. Shape:
```
1. snapshot output A = engine.generate(corpus, artifact)
2. apply a fixture mutation to the ARTIFACT only
   (e.g. change a [DTO] template; flip a lint severity)
3. output B = engine.generate(corpus, artifact')
4. assert B differs from A in exactly the expected way
5. assert `git diff --stat src/` is empty — no engine code changed
```
If L6 can't be made to pass, the engine isn't artifact-driven and the product
doesn't exist yet — no amount of green on L2–L4 substitutes for it.

---

## Gate → phase map

| Phase | Must pass to be "done" |
| --- | --- |
| P0 decisions | (human) ADRs merged — the only non-machine gate |
| P1 drift | **Drift** |
| **Verification foundation** | **Corpus health + Prereq-1 JSON + L0 + goldens captured** |
| P2 contract | **L1** |
| P3a bindings | L3 holds; L6 passes for a binding mutation |
| P3b codegen | **L3** + L6 for a template mutation |
| P3c parse | **L2** |
| P3d lint | **L4** + L6 for a severity mutation |
| P4 shared preview | **L5** |
| P5 tree-sitter | grammar regenerates from artifact; editor highlight changes on a tag/colour mutation |
| P6 UI + governance | **L6** end-to-end from the UI + **L7** + locked-rule-cannot-be-weakened test |

## What this changes about the plan

- **Insert "Verification foundation" between P1 and P2** — corpus, `--json`,
  L0, and captured goldens. Nothing downstream is verifiable until it lands.
- **Replace time estimates with gates.** Progress = "L3 now green," not "week 4."
- The agent loop becomes: pick the next phase → run its gate (red) → work →
  gate green → stop. The gate, not the agent's self-report, is the done-signal.
