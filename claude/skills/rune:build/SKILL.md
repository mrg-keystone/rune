---
name: "rune:build"
description: >-
  The agentic factory that turns a finalized `.rune` spec into a fully
  implemented, tested, lint-clean Deno module by orchestrating a fleet of
  isolated agents: `rune sync` scaffolds (red by design), one agent maps intent
  + enumerates every unwritten test (persisted to disk artifacts), a fleet
  writes real failing tests (TDD, one agent per test FILE), a fleet fills the
  bodies (one agent per method/file), fresh judges validate in BATCHES of ~10
  tests against a pinned baseline (one suite run per batch), then `rune lint
  --strict` + heal-rules enrichment closes it out green. Use whenever
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
  red-by-design scaffold; WRITES the pinned baseline to
  `spec/misc/build/<m>/baseline.md` and returns its path + run-all verdict +
  `inputs:` warnings.
- **`rune-build-analyst`** — the module map (intent per coordinator/method/adapter/
  DTO) AND the test inventory, in one pass; WRITES the map to
  `spec/misc/build/<m>/module-map.md` (sectioned per targetFile) and returns only
  the inventory rows.
- **`rune-build-test-author`** — one per test FILE: writes that file's RED tests
  (TDD), reading only its module-map slice.
- **`rune-build-method-impl`** — one per method/file: fills the minimal GREEN body
  (worktree-isolated); no full-suite runs.
- **`rune-build-validator`** — one FRESH agent per BATCH of ≤10 tests (grouped by
  targetFile): proves each correct + green, ONE module-suite run per batch vs the
  pinned baseline; never edits.
- **`rune-build-linter`** — `rune lint` fix-all + heal-rules enrichment + `rune lint
  --strict` gate.

## The pipeline

```
finalized spec ─▶ SCAFFOLD ─▶ ANALYST ─▶ WRITE TESTS ─▶ IMPLEMENT ─▶ VALIDATE ─▶ LINT ─▶ green
   (rune:spec)    scaffold     analyst     test-authors    method-impl   validators   linter  ─▶ rune:cake
                  (baseline    (map to      (1/test FILE,   (1/method,    (1/BATCH of ≤10,
                   → disk)      disk +       proves RED)     proves GREEN, fresh: correct+green,
                                inventory)                   no suite run) 1 suite run/batch)
                                              └── loop WRITE→IMPLEMENT→VALIDATE until green ──┘
```

Each stage is a **different job**, so each gets its own agent and gates the next —
hunting intent, writing a test, filling a body, and proving the result are distinct
skills; running them as one agent gives you none of the isolation that makes the
result trustworthy.

## Orchestration policy (you own this)

- **Isolation is the point.** Each stage is a fresh agent that sees only the prior
  stage's handoff, never its reasoning. Never use `subagent_type: "fork"` (a fork
  inherits your context and defeats isolation). Run the IMPLEMENT fleet with
  `isolation: "worktree"` so parallel body edits to a shared `mod.ts` don't collide;
  merge after. (Inside a `Workflow`, the fleets are `parallel()` stages and the loop
  is a `pipeline()`.) **Worktree isolation requires the project to be a git repo** —
  if it isn't, `git init && git add -A && git commit -m scaffold` yourself before the
  IMPLEMENT fleet (measured: 2 impl spawns failed "not in a git repository" and
  silently retried un-isolated). When a repo is impossible, one-agent-per-file already
  guarantees disjoint writes — but say so in the impl prompts. **Brief worktree agents
  with the path CONVENTION, not just absolutes:** their cwd is a COPY of the project —
  tell them "your cwd is the project root; briefed paths re-anchor under it" (measured:
  impl agents briefed with `/work/...` absolutes inside a worktree burned turns and 3
  path errors reconciling the two roots).
- **Wait on notifications, never poll-sleep.** After spawning agents, END YOUR TURN —
  the harness re-invokes you the moment an agent finishes. Never `sleep`-loop between
  stages: each poll turn re-reads your whole context and adds dead wall-clock
  (measured: 270s of `sleep 30/60` = 32% of a build's wall time). Use waits to draft
  your plan/ledger, not to spin.
- **Never search the filesystem — you included.** Every skill reference lives at
  `~/.claude/skills/<skill>/references/<file>` — read it by its exact path. No
  `find /`, no `find ~`, no whole-disk or home-dir scans, ever (measured: the
  ORCHESTRATOR ran `find / -iname example-core.rune` for a file whose path it knew).
- **Keep the ledger cheap.** For fleets ≤ ~15 agents, track the queue in your plan
  text — don't burn an API turn per TaskCreate/TaskUpdate (measured: 20 bookkeeping
  turns for a 10-agent build). Task tools are for builds that span sessions.
- **Cap the fleets at 4–6 concurrent, in CHUNKED waves.** Measured on real builds:
  fan-outs of 10+ agents × 50K+ context/request saturate the org's tokens-per-minute
  quota → 429/529 storms → agents die mid-work and re-execute from scratch (one
  module: 620 executions for 490 units of work; one unit ran 6×; ~20-25% of all fleet
  tokens were re-spent on redone work). In a Workflow script, chunk:
  `for (const wave of chunks(items, 5)) await parallel(wave.map(…))`. If a wave still
  dies of rate limits, HALVE the chunk size before resuming — never relaunch the full
  fan-out into the same quota.
- **Artifacts on disk, paths in prompts.** The scaffold writes
  `spec/misc/build/<m>/baseline.md`; the analyst writes
  `spec/misc/build/<m>/module-map.md` (sectioned per targetFile) and
  `test-inventory.json`. Fleet prompts carry each agent's OWN rows + those absolute
  paths — never the map or baseline inline (the old broadcast cost ~20K chars × every
  author/impl and ~10K × every validator). Each agent Greps its own slice. Absolute
  paths also work from inside worktrees.
- **Brief completely — a specialist that searches was under-briefed.** Every path in a
  fleet prompt is ABSOLUTE and **copied verbatim from a stage return** (scaffold/analyst
  output, inventory rows) — never retyped by hand: one build shipped a hand-retyped
  parity path (`spec/parity/` for `spec/misc/parity/`) and its validators hit 122
  path-not-found errors, then went hunting. Pass the same way: the spec path, each row's
  test/target files, the artifact paths, and **RUNE_BIN** (the rune invocation — e.g.
  `/Users/<user>/.deno/bin/rune`, or `deno run -A src/bootstrap/mod.ts` in a repo with no
  binary) so no agent runs `which rune`/`rune --help` to rediscover it. A specialist that
  returns `blocked: missing path` got a wrong brief — fix the brief and re-delegate;
  never answer "search for it". (Measured: test-authors averaged 1.5 discovery calls each
  — 231 project-wide `find`s, 146 `cat deno.json` — all rediscovering facts the
  orchestrator held.)
- **Batch the validators.** Group the inventory by `targetFile`, pack into batches of
  ≤10 tests, ONE fresh validator per batch, ONE module-suite run per batch (that run
  is the regression gate — impl agents do not run the suite). Heal rounds re-validate
  ONLY the batches containing bounced tests. An agent DEATH is infrastructure, not a
  verdict: retry that one batch once; never blanket re-validate the module because
  agents died.
- **Run two watchers for the whole build (main session):** `rune dev <project>` (the
  live app + `/docs/<module>` cake: check→sync→restart on save) and `deno test --watch
  <project>/src/<module>` (YOUR green loop). **`rune dev` does NOT run `deno test`** —
  it only spawns the app (`deno run -A bootstrap/mod.ts`); evidence:
  `src/rune/entrypoints/dev/mod.ts` (`spawnChild()`/`runCycle()` never call `deno
  test`). So the unit-test loop is yours to drive. Smoke (`smk`) tests hit real
  boundaries — run them individually, never in `--watch`.
- **Evidence, not vibes.** A test is real only if it was RED first; IMPLEMENT proves
  green per method; VALIDATE confirms against the pinned baseline with run output
  (tails, ≤10 lines — full runner dumps bloat every downstream prompt).
- **Session hygiene.** Run each module build in a FRESH session; the workflow returns
  a compact summary (counts + stuck ids + artifact paths), which is all the session
  needs. Don't paste fleet outputs into the session, and don't stack module builds
  into one long-lived session — measured sessions idling at 400–570K tokens of
  context paid that context on every single turn.
- **Models are pinned in the agent defs** (authors/impl/validators/scaffold/linter =
  sonnet; analyst = opus). Don't override them to `inherit` — an earlier build ran
  444 validator executions on the most expensive tier for 7 real bounces. Fleet
  specialists reason inline; don't add sequential-thinking MCP calls to their runs
  (each thought is a full-context API request; measured 1,780 of them across one
  project's fleets).

## The flow

1. **Scaffold** → `rune-build-scaffold` (pass the clean spec path + project root + RUNE_BIN). It
   returns the finalized spec path — NOTE: the first `rune sync` RELOCATES the spec to
   `src/<m>/<m>.rune`; that is its permanent home from then on — the scaffolded
   `src/<module>/`, the **baseline path** (`spec/misc/build/<m>/baseline.md`), the
   **resolved_paths** facts (`spec`, `deno_json`, `heal_rules`, `artifacts_dir`,
   `runtime_src`, `smoke_posture` — the one `deno info` of the whole build), the run-all
   verdict, and `inputs:` warnings. If it bounces `blocked: spec not clean`, route back
   to `rune:spec`. Forward the baseline PATH, and inline the resolved_paths facts (≤7
   short lines) into EVERY fleet prompt — facts inline, bulk behind paths.
2. **Map + enumerate** → `rune-build-analyst` (pass the finalized spec + the generated
   tree). It writes `spec/misc/build/<m>/module-map.md` and returns the test inventory
   (one row per test, each with `targetFile`). The rows are your work queue; the map
   stays on disk.
3. **Loop WRITE→IMPLEMENT→VALIDATE until every test is green and confirmed** (chunked
   waves of 4–6 agents throughout):
   - **Write tests** → a `rune-build-test-author` per test FILE (pass that file's rows +
     the module-map path). Each returns RED proofs (tails).
   - **Implement** → a `rune-build-method-impl` per method/file whose tests are red
     (pass the failing test file(s) + the module-map path), worktree-isolated. Each
     returns a GREEN proof (tail); no suite runs here.
   - **Validate** → a FRESH `rune-build-validator` per BATCH of ≤10 tests grouped by
     targetFile (pass the batch rows + module-map path + baseline path). Each returns
     per-test verdict JSON + ONE suite-run regression check.
   - **Route bounces:** `bounce_to: "write-tests"` → re-spawn a test-author for that
     FILE; `"implement"` → re-spawn a method-impl; a regression → re-open the true
     cause; an "intent unclear" report → re-run `rune-build-analyst` or ask the user.
     Re-validate ONLY the affected batches. An agent death = retry once, not a verdict.
     Cap retries at 2 rounds; surface a stuck unit instead of thrashing.
4. **Lint + heal** → `rune-build-linter` (pass the project + module + SPEC path +
   RUNE_BIN). It returns `rune lint --strict` clean + the enriched heal-rules.
5. **Exit gate** — the module is built when ALL hold: unit+int green under `deno test
   <project>/src/<module>`; smoke tests pass individually (real connectivity); `rune
   lint --strict` clean; the `rune sync`/`exerciseEndpoints` run-all verdict **green**.
   Then **hand to `rune:cake`** for real-data end-to-end.

## Hard rule

You orchestrate and gate; you never scaffold, write a test, fill a body, run the lint
fix, or run `rune sync`/`deno test` inline — every unit of work goes to its named
specialist, and each stage gates the next on evidence. This includes after a mid-build
fix: re-verification goes back through the validator/linter, not your own shell
(measured: an orchestrator-run `deno test` exited 1 for environmental reasons and
polluted its judgment — the specialist knew the baseline; it didn't).

## What's no longer here

The per-stage how-to — the `rune sync`/artifact-ownership table + stale-controller trap,
the test-kind + fault-coverage rules, the TDD test-writing steps, the minimal-body
discipline, the validator's judge-correctness method, the lint catalog + heal
enrichment, and the `@/`-resolves-from-the-project pitfall — now lives in the six
specialists.
