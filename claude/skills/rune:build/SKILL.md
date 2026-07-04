---
name: "rune:build"
description: >-
  The agentic factory that turns a finalized `.rune` spec into a fully
  implemented, tested, lint-clean Deno module by orchestrating a fleet of
  isolated agents: `rune sync` scaffolds (red by design), one agent learns the
  intent, one enumerates every unwritten test, a fleet writes real failing tests
  (TDD, one agent per test), a fleet fills the bodies (one agent per method),
  a fresh-agent loop validates each test against a pinned green baseline, then
  `rune lint --strict` + heal-rules enrichment closes it out green. Use whenever
  you have a `rune check`-clean spec and want it BUILT — "build this module",
  "implement the rune / fill in the bodies", "write the tests for X", "make it
  green", "generate and implement", "finalize and sync this spec", pointing at a
  `spec/runes/<m>.rune` (or a freshly synced `src/<module>/` full of `not implemented`
  throws) and asking to make it work. NOT writing or editing the spec itself
  (that's `rune:spec` — this skill STARTS from a clean spec); NOT real-data
  end-to-end via the cake (`/docs/<m>` walks, heal panel → `rune:cake`); NOT
  runtime internals like `bootstrapServer`/auth/`@Endpoint` semantics
  (→ `rune:framework`); NOT swagger example tuning (→ `rune:docs`).
user-invocable: true
argument-hint: "[path to the finalized spec/module to build]"
---

# rune:build — orchestration playbook

You are the **orchestrator**. Take a `rune check`-clean spec from
`spec/runes/<m>.rune` to "every test green, lint clean, run-all verdict green" by
driving a staged pipeline of focused, **isolated** specialists. You never write
tests or fill bodies yourself — you delegate each unit of work to the right
specialist, hand it only its slice, and gate each stage on evidence.

## When this skill applies

You have a `rune check`-clean spec (or a freshly synced `src/<module>/` full of `not
implemented` throws) and want it BUILT. NOT authoring/editing the spec (→ `rune:spec`,
the seam upstream); NOT real-data e2e via the cake (→ `rune:cake`, the handoff
downstream); NOT runtime internals — `bootstrapServer`/auth/`@Endpoint` semantics
(→ `rune:framework`); NOT swagger example tuning (→ `rune:docs`).

## Specialist roster

- **`rune-build-scaffold`** — finalize (`.in-prog`→`.rune`) + `rune sync` the
  red-by-design scaffold; returns the pinned baseline + run-all verdict + `inputs:`
  warnings.
- **`rune-build-analyst`** — read-only: the module map (intent per
  coordinator/method/adapter/DTO) AND the test inventory, in one pass.
- **`rune-build-test-author`** — one per test row: writes ONE real RED test (TDD).
- **`rune-build-method-impl`** — one per method: fills ONE minimal GREEN body
  (worktree-isolated).
- **`rune-build-validator`** — one FRESH agent per test: proves it correct + green
  vs the pinned baseline; never edits.
- **`rune-build-linter`** — `rune lint` fix-all + heal-rules enrichment + `rune lint
  --strict` gate.

## The pipeline

```
finalized spec ─▶ SCAFFOLD ─▶ ANALYST ─▶ WRITE TESTS ─▶ IMPLEMENT ─▶ VALIDATE ─▶ LINT ─▶ green
   (rune:spec)    scaffold     analyst     N test-author   M method-impl  N validator  linter  ─▶ rune:cake
                  (red by      (map +      (1/test, TDD,    (1/method,     (1/test,
                   design)      enumerate)  proves RED)      proves GREEN)  fresh: correct+green?)
                                              └──── loop WRITE→IMPLEMENT→VALIDATE until green ────┘
```

Each stage is a **different job**, so each gets its own agent and gates the next —
hunting intent, writing a test, filling a body, and proving the result are distinct
skills; running them as one agent gives you none of the isolation that makes the
result trustworthy.

## Orchestration policy (you own this)

- **Isolation is the point.** Each stage is a fresh agent that sees only the prior
  stage's handoff, never its reasoning. Never use `subagent_type: "fork"` (a fork
  inherits your context and defeats isolation). Run the WRITE-TESTS / IMPLEMENT /
  VALIDATE fleets one agent per unit, in one message, cap ~6–8 concurrent; cluster a
  noun's methods into one agent to avoid same-file collisions. Run the IMPLEMENT fleet
  with `isolation: "worktree"` so parallel body edits to a shared `mod.ts` don't
  collide; merge after. (Inside a `Workflow`, the fleets are `parallel()` stages and
  the loop is a `pipeline()`.)
- **Pin a green baseline before the loop.** `rune-build-scaffold` returns it (smoke
  skipped, all unit tests red/absent, spec clean, the verbatim run-all verdict). YOU
  hold it and pass it to every validator — that is what catches a body that fixed one
  test by breaking another. Agents communicate through JSON / written artifacts, never
  shared memory.
- **Run two watchers for the whole build (main session):** `rune dev <project>` (the
  live app + `/docs/<module>` cake: check→sync→restart on save) and `deno test --watch
  <project>/src/<module>` (YOUR green loop). **`rune dev` does NOT run `deno test`** —
  it only spawns the app (`deno run -A bootstrap/mod.ts`); evidence:
  `src/rune/entrypoints/dev/mod.ts` (`spawnChild()`/`runCycle()` never call `deno
  test`). So the unit-test loop is yours to drive. Smoke (`smk`) tests hit real
  boundaries — run them individually, never in `--watch`.
- **Evidence, not vibes.** A test is real only if it was RED first; IMPLEMENT proves
  green per method; VALIDATE confirms against the pinned baseline with run output.
  "Looks done" is not validation.
- **Think step by step** between stages (`mcp__sequential-thinking__sequentialthinking`);
  every specialist already carries the discipline.

## The flow

1. **Scaffold** → `rune-build-scaffold` (pass the clean spec path + project root). It
   returns the finalized spec, the scaffolded `src/<module>/`, the **pinned baseline**,
   the run-all verdict, and `inputs:` warnings. If it bounces `blocked: spec not clean`,
   route back to `rune:spec`. Hold the baseline.
2. **Map + enumerate** → `rune-build-analyst` (pass the finalized spec + the generated
   tree). It returns the module map + the test inventory (one row per test). Summarize
   the inventory as your work queue.
3. **Loop WRITE→IMPLEMENT→VALIDATE until every test is green and confirmed:**
   - **Write tests** → a `rune-build-test-author` per inventory row (pass the row + its
     module-map slice + the code under test). Each returns a RED proof.
   - **Implement** → a `rune-build-method-impl` per method whose tests are red (pass the
     failing test(s) + module-map slice), worktree-isolated. Each returns a GREEN proof.
   - **Validate** → a FRESH `rune-build-validator` per test (pass the test + its spec
     intent + the body + the pinned baseline). Each returns verdict JSON.
   - **Route bounces:** `bounce_to: "write-tests"` → re-spawn a test-author;
     `"implement"` → re-spawn a method-impl; a regression → re-open the true cause; an
     "intent unclear" report → re-run `rune-build-analyst` or ask the user. Cap retries;
     surface a stuck unit instead of thrashing.
4. **Lint + heal** → `rune-build-linter` (pass the project + module). It returns `rune
   lint --strict` clean + the enriched heal-rules.
5. **Exit gate** — the module is built when ALL hold: unit+int green under `deno test
   <project>/src/<module>`; smoke tests pass individually (real connectivity); `rune
   lint --strict` clean; the `rune sync`/`exerciseEndpoints` run-all verdict **green**.
   Then **hand to `rune:cake`** for real-data end-to-end.

## Hard rule

You orchestrate and gate; you never scaffold, write a test, fill a body, or run the
lint fix inline — every unit of work goes to its named specialist, and each stage gates
the next on evidence.

## What's no longer here

The per-stage how-to — the `rune sync`/artifact-ownership table + stale-controller trap,
the test-kind + fault-coverage rules, the TDD test-writing steps, the minimal-body
discipline, the validator's judge-correctness method, the lint catalog + heal
enrichment, and the `@/`-resolves-from-the-project pitfall — now lives in the six
specialists.
