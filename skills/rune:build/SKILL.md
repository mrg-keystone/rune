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
  `spec/<m>.rune` (or a freshly synced `src/<module>/` full of `not implemented`
  throws) and asking to make it work. NOT writing or editing the spec itself
  (that's `rune:spec` — this skill STARTS from a clean spec); NOT real-data
  end-to-end via the cake (`/docs/<m>` walks, heal panel → `rune:cake`); NOT
  runtime internals like `bootstrapServer`/auth/`@Endpoint` semantics
  (→ `rune:framework`); NOT swagger example tuning (→ `rune:docs`).
user-invocable: true
argument-hint: "[path to the finalized spec/module to build]"
---

# rune:build — the spec-to-green factory

You are the **orchestrator**. You take a `rune check`-clean spec from
"`spec/<m>.rune`" to "every test green, lint clean, run-all verdict green" by
driving a staged pipeline of focused, **isolated** agents — generate, learn,
enumerate, write tests (TDD), implement, validate, lint+heal — then hand the
working module to `rune:cake` for real-data end-to-end. You don't write tests or
fill bodies yourself; you **spawn an agent per unit of work**, hand it the right
brief, and gate each stage on evidence.

## This skill vs its siblings

- **`rune:spec`** — authors and edits the `.rune` DSL and gets it `rune check`-clean
  as `spec/<m>.in-prog.rune`. **The seam:** spec ends at a clean draft; *build owns
  everything from finalize onward* — dropping the `.in-prog` infix, `rune sync`,
  filling bodies, the test fleet, `rune lint`, the green run-all. If the work is
  changing what the module *should do*, go back to `rune:spec`.
- **`rune:build` (here)** — generate → implement → test → lint → green.
- **`rune:framework`** — the runtime the generated code runs on: `bootstrapServer`,
  `@Endpoint`/`@EndpointController` `order`/`dependsOn`/`bind` *semantics*, auth
  (401/403, `@Public`/`@Roles`, tokens), the `exerciseEndpoints` runner surface,
  deploy/embed. Build *runs* the app; defer the why-it-behaves-that-way to framework.
- **`rune:cake`** — proves the app does what it's supposed to end-to-end with real
  data and no mocks, through the cake at `/docs/<module>`; owns the heal-rules
  **schema** and the heal panel. Build hands off here once it's green.
- **`rune:docs`** — the Swagger/Danet doc surface (`@ApiProperty`, `example=`,
  `/docs/<m>/swagger`). Defer per-endpoint example tuning there.

## The pipeline

```
finalized spec ─▶ GENERATE ─▶ LEARN ─▶ ENUMERATE ─▶ WRITE TESTS ─▶ IMPLEMENT ─▶ VALIDATE ─▶ LINT ─▶ green
   (rune:spec)    rune sync    1 agent   1 agent       N agents       M agents      N agents    rune    ─▶ rune:cake
                  (red by      (read     (list every    (1 per test,   (1 per        (1 per     lint
                   design)     code +    unwritten      intent-aware,  method,       test:      --strict
                              intent)    test)          TDD, fails)    make pass)    correct +  + heal
                                                                                     green?)
                                                          └──── loop WRITE→IMPLEMENT→VALIDATE until green ────┘
```

Each stage is a **different job**, so each gets its own agent and gates the next.
Hunting intent, writing a test, filling a body, and proving the result are distinct
skills; running them as one agent narrating five hats gives you none of the
isolation that makes the result trustworthy.

## Think step by step — you and every agent

This work fails when an agent jumps to a conclusion: a body written to silence a
test instead of to satisfy the spec, a test that "passes" because it asserts the
stub's throw, a green run that was never actually run. So **reason sequentially**
and require it of every agent. Use the **sequential-thinking MCP**
(`mcp__sequential-thinking__sequentialthinking`) for your own planning between
stages, and end every agent brief with the instruction to think step by step
(the briefs in `agents/` already carry it).

## The one rule every stage serves: evidence, not vibes

- **GENERATE proves the scaffold exists and is red** — `rune sync` exits 0, the
  run-all verdict is captured, the bodies throw `not implemented`. A red-by-design
  baseline, not a hope.
- **A test is real only if it was RED first.** TDD: the test author runs the new
  test and pastes the failing output before any body is filled. A test that passed
  against the stub asserts nothing.
- **IMPLEMENT proves green per method**, by running that method's tests.
- **VALIDATE confirms with a runnable check against a pinned baseline** — the test
  is correct (pins the spec's intent, not gamed) AND green. "Looks done" is not
  validation; `deno test <file>` output is.

## The fact that shapes this skill: `rune dev` does NOT run your tests

`rune dev` is the **app hot-reloader**, not a test runner. On a spec save it does
`check → sync → restart`; on a source save it restarts; the child it spawns is the
**app** — `deno run -A bootstrap/mod.ts`. It calls `deno test` **zero** times.

> Evidence: `src/rune/entrypoints/dev/mod.ts`. `spawnChild()` runs
> `new Deno.Command("deno", { args: ["run", "-A", "bootstrap/mod.ts"], … })`; the
> watch targets are `src/`, `spec/`, `bootstrap/`, `deno.json`; `runCycle()` only
> ever checks/syncs the spec and restarts the child. There is no `deno test` call
> anywhere in the file.

**Therefore the build skill drives the unit-test loop itself.** Run two watchers
side by side for the duration of the build:

```sh
rune dev <project>                     # the live app: check → sync → restart on save
deno test --watch <project>/src/<module>   # YOUR green loop: reruns unit tests on save
```

`rune dev` gives you a live `/docs/<module>` cake to eyeball; `deno test --watch`
is the loop that actually tells WRITE→IMPLEMENT whether it's green. They are
different instruments — keep both running.

**Smoke (`smk`) tests are different and deliberate.** The `smk.test.ts` files
exercise a *real* service boundary for connectivity — they hit the actual service,
**never a mock**. They are slow and side-effectful, so they are **run individually
and on purpose** (`deno test <path>/smk.test.ts`), not in the fast `--watch` loop.
This real-connectivity discipline is shared with `rune:cake` (the e2e tier).

## Orchestration — two ways, isolation is the point

Each stage must be a **separate agent** that sees only the handoff from the prior
stage, never its reasoning. A VALIDATE agent that shares context with the test/impl
agent it checks just ratifies that agent's mistakes. Run it one of two ways:

- **Inside a `Workflow`** (preferred for the fleets): the fleets are one
  `parallel()` each (one `agent()` per test in WRITE TESTS, per method in
  IMPLEMENT, per test in VALIDATE); the script holds the running state — the module
  map, the test inventory, the pinned baseline — and passes each agent only its
  slice. The WRITE→IMPLEMENT→VALIDATE loop is a `pipeline()` you repeat until every
  test is green and confirmed.
- **With the `Agent` tool** (no workflow): launch each stage as a *fresh* agent —
  `Explore` for read-only LEARN/ENUMERATE/VALIDATE tracing, `general-purpose` for
  the writers. Never `subagent_type: "fork"` — a fork inherits your context and
  defeats isolation. Run the IMPLEMENT fleet with `isolation: "worktree"` so
  parallel body edits don't collide on the same files (two methods in one `mod.ts`
  is the common collision — give each its own worktree and merge, or serialize
  same-file methods into one agent).

**Pin a green baseline before the loop.** Capture the exact passing set the moment
GENERATE finishes (it is: smoke tests skipped, all unit tests red/absent, the spec
clean). The VALIDATE agents compare against *that* — which is what catches a body
that fixed one test by breaking another. Agents communicate through JSON / written
artifacts, never shared memory.

---

## Stage 0 — Finalize (the seam from `rune:spec`)

Build owns the finalize step. Take the clean draft `spec/<m>.in-prog.rune` and:

1. `rune check spec/<m>.in-prog.rune` — must exit 0. A non-clean spec is `rune:spec`'s
   job; bounce it back. (In the repo without an installed binary, prefix every `rune`
   command with `deno run -A src/bootstrap/mod.ts`.)
2. **Drop the `.in-prog` infix** — rename to `spec/<m>.rune`. That graduation is what
   makes auto-discovery (the `rune dev` watch, the composed-app run-all) pick the
   module up. The spec stays in `spec/`; it never moves out.

## Stage 1 — GENERATE (`rune sync`, red by design)

```sh
rune sync spec/<m>.rune              # scaffolds src/<module>/, writes deno.json, runs the walk
rune sync spec/<m>.rune --no-run     # … but skip the composed-app run-all gate at the end
rune sync spec/<m>.rune --force      # … and prune orphans (see below); otherwise held back
rune manifest spec/<m>.rune          # one-shot generate, NO prune — see the import-map caveat
```

`rune sync` is the **only** generator you should use. It scaffolds, then **executes the
composed app's walk** and prints a run-all verdict as its last block (`--no-run` skips
that gate). **`rune manifest` is the lower-level one-shot generate (no prune) — and it
does NOT write the project's `deno.json` import map**, so the `#assert` alias is unmapped
and the generated coordinators won't resolve. Prefer `rune sync` (which maps it); reach
for `manifest` only when you deliberately want codegen without touching `deno.json`.
What `sync` writes:

| Artifact | Ownership |
| --- | --- |
| `dto/*.ts` — class-validator/class-transformer DTOs, fields typed from `[TYP]`s | **regenerated** every sync — never hand-edit |
| `mod-root.ts` — the `[REQ]` re-export surface | **regenerated** every sync |
| `[PLY]` `base/mod.ts` — abstract `sig` for polymorphic nouns | **regenerated** every sync |
| business/adapter `mod.ts` — plain concrete classes, methods `throw new Error("not implemented")` | **create-once / dev-owned** — you fill these |
| coordinators `mod.ts` — imperative shell + pure `<verb>Core`, every seam `assert`ed | **create-once / dev-owned** |
| `test.ts` / `int.test.ts` / `smk.test.ts` — one stub per method/coordinator/adapter | **create-once / dev-owned** |
| `entrypoints/<surface>/mod.ts` — `@Endpoint` controller (one per `[ENT]`) | **create-once / dev-owned** |
| `bootstrap/modules.ts` | **regenerated** every sync — never edit |
| `bootstrap/mod.ts` + `config.ts` | **create-once / dev-owned** |
| `fixtures/heal-rules.json` — one entry per fault slug | **merge-owned** — new slugs added, your edits kept |

**A fresh scaffold's run-all is RED by design** — the bodies throw, so every step
fails. That red is your pinned baseline, not a problem. Read the verdict and the
`inputs:` warnings above it (unproducible/unfillable required fields cause most
*other* red walks). If you change the spec later and re-sync, remember create-once
files do **not** auto-update: to pull a changed signature, `rune sync --regen <file>`
writes a `.new` sibling to diff/merge — it never clobbers a body.

**The classic stale-controller trap:** a spec change that alters the derived
`order`/`dependsOn`/`bind` (e.g. flipping a `[TYP]` to `ext`) does NOT update an
existing `entrypoints/<surface>/mod.ts`. A stale controller is a textbook cause of a
red run-all verdict even when the bodies are correct. Fix: **delete the controller
file and re-sync** for fresh binds. (The bind *semantics* themselves live in
`rune:framework`; here you just know to regenerate.)

**Prune is opt-in.** When a spec drops a whole feature, the orphaned generated files are
**held back by default** — a spec edit can't silently delete code you may have filled in.
`rune sync … --force` removes them once you've confirmed they're truly orphans.

> Housekeeping: `rune update [tag]` (alias `rune upgrade`) self-updates the `rune` binary
> to the latest release and refreshes the rune skills. Run it if `sync`/`lint` behave
> unexpectedly against an old binary. `rune --help` lists every command.

## Stage 2 — LEARN (one agent: map the intent)

Spawn **one** read-only agent (`Explore`) with the spec + the freshly generated
tree. Its job: map *intent* — for each coordinator/Core/adapter/feature, what is it
*supposed* to do, derived from the spec's steps, faults, and DTOs? It produces a
**module map** the test and impl fleets consume:

- per `[REQ]` coordinator: the ordered steps, which are pure (Core) vs I/O (adapter),
  the input/output DTO contract, the asserted seams;
- per business feature method: its signature (typed from the spec) and the step it
  implements;
- per adapter method: the service boundary it calls and its declared **fault slugs**;
- per DTO: its fields and their `[TYP]` constraints.

This agent reads, it does not edit. Its output is JSON/markdown the next stage keys
off. (The `.rune` language itself — tags, scope, the modifier table — is `rune:spec`'s
domain; this agent reads the *already-clean* spec as the contract, not to validate it.)

## Stage 3 — ENUMERATE (one agent: every unwritten test)

Spawn **one** agent with the module map + the generated tree. It lists **every**
test that must exist and be real, by kind:

| Kind | File | Must prove |
| --- | --- | --- |
| business unit | `domain/business/<noun>/test.ts` | each pure method does what its step says |
| coordinator int | `domain/coordinators/<verb>/int.test.ts` | the shell wires steps + asserts seams; happy path + each fault |
| adapter smoke | `domain/data/<noun>/smk.test.ts` | the real boundary is reachable (connectivity), **no mocks** |
| **fault coverage** | the test file for the owning step | **one `Deno.test` titled with the bare fault slug** per declared fault |

The fault-coverage requirement is enforced by lint (`fault-coverage`, an **error**):
every fault slug declared under a boundary step needs a `Deno.test("<slug>", …)` with
the **bare slug** as the title — e.g. a `timeout` fault needs `Deno.test("timeout", …)`.
The generated stubs already lay these down with TODO bodies (see
`examples/todos/src/tasks/domain/data/task/smk.test.ts`); enumerate confirms the full
set and flags any missing slug.

Output: a **test inventory** — one row per test (file, kind, the method/behavior under
test, the assertion it must make). This is the fleet's work queue.

## Stage 4 — WRITE TESTS (fleet, one agent per test, TDD)

For each row in the inventory, spawn one agent with **`agents/test-author.md`** plus
that row, the relevant slice of the module map, and the code under test. Each agent
writes **one** real, quality test — AAA assertions that pin the *intended* behavior
from the spec, not the stub's `throw` — and proves it **RED** first (runs it, pastes
the failing output). The generated "keep-green" TODO stubs are replaced, not edited
around.

- Send the fleet in **one message, multiple Agent calls** (cap ~6–8; cluster a noun's
  methods into one agent so they share a file without collision).
- Unit/int tests are written for the `deno test --watch` loop. Smoke tests are
  written to hit the **real** boundary and are noted as run-individually.
- A test that can't be made to fail against the stub is reported, not forced —
  usually it means the test is gamed or the intent is unclear (re-open LEARN).

## Stage 5 — IMPLEMENT (fleet, one agent per method)

Once the tests exist and are red, spawn one agent per method with
**`agents/method-impl.md`** plus that method's failing test(s) and module-map slice.
Each writes the **minimal** body to turn its tests green:

- adapter methods return `Promise<…>` (the coordinator awaits them); business methods
  are **sync**; the coordinator shell loads via adapters → calls the pure `<verb>Core`
  → writes via adapters → returns, **asserting every seam** via `import { assert } from
  "#assert"`.
- **No blind DTO casts** in coordinators (`no-dto-cast`, a lint error): never
  `as XxxDto` — the seam is already asserted; an `assert(XxxDto, …)` is the contract.
- Run with `isolation: "worktree"` so parallel edits to a shared `mod.ts` don't
  collide; merge after.

The body satisfies the **spec**, then the test — not the other way round. A body that
games a test without doing what the step says is a defect VALIDATE will catch.

## Stage 6 — VALIDATE (loop, one agent per test, fresh + isolated)

For each test, spawn a **fresh** agent (never the one that wrote the test or the body)
with **`agents/validator.md`** plus that test, the spec's intent for it, and the
pinned baseline. Each confirms two things, with run output:

1. **Correct** — the test encodes the spec's intent (the right behavior, the right
   fault path), it is not gamed (doesn't assert the stub throw, doesn't tautologize).
2. **Green** — `deno test <file>` passes now, and the **full pinned baseline still
   passes** (no body fixed one test by regressing another).

Collect verdicts. **Loop:** any `fail` (wrong test, gamed body, regression) goes back
to WRITE TESTS or IMPLEMENT with the specific failure; re-run VALIDATE. Repeat
WRITE→IMPLEMENT→VALIDATE until **every test is green and confirmed-correct**. Don't
declare done over a red check.

## Stage 7 — LINT + heal

1. **`rune lint <project>`** — must print `All clear`. It enforces the architecture:
   import aliases (`@`-only, no `../`), layer boundaries (a pure feature can't import a
   data adapter), barrel discipline, `fault-coverage`, `dto-validation`, `no-dto-cast`,
   folder structure. Fix every finding. (One-feature modules trip
   `module-fragmentation` — that's a real signal the module is too small, not filler
   to add.)
2. **Enrich every `todo: true` heal-rules entry.** `rune sync` scaffolds
   `fixtures/heal-rules.json` with one entry per fault slug, each flagged `todo: true`
   ("rune guessed — confirm"). Filling these is dev work like filling a stub: replace
   the placeholder with a concrete suggestion, write a real one-line `why`, then drop
   the `todo` flag. (The full heal-rules **schema** — every `kind` and its fields —
   lives in `rune:cake`; here you just *fill in* what sync scaffolded.)
3. **`rune lint --strict`** (the CI profile; also `RUNE_LINT_STRICT=1`) — fails on any
   remaining `todo: true`. This is the gate: plain `rune lint` stays quiet on a fresh
   scaffold so you can iterate, `--strict` is what CI runs.

## Stage 8 — Exit (hand to `rune:cake`)

The module is built when **all four hold**:

- unit + int tests green under `deno test <project>/src/<module>`;
- smoke tests run individually and pass (real connectivity);
- `rune lint --strict` clean;
- `rune sync` (or `exerciseEndpoints`) run-all verdict **green** — the composed app
  actually runs, not just type-checks.

Then hand off to **`rune:cake`** for real-data end-to-end: serving `/docs/<module>`,
walking the process with real responses, pinning expectations/scenarios, and the heal
panel. That's where "does the app do what it's supposed to" gets proven.

## A pitfall that bites build specifically

**`@/` resolves to the *project* root, not `src/`.** Generated imports are
`@/src/<module>/…`; `rune sync` writes `"@/": "./"` into the project's `deno.json`. Run
`deno check` / `deno test` **from the generated project** (`cd` in first, or pass
`--config <project>/deno.json`) — running from the rune repo makes its `@/` map shadow
the project's and produces spurious `TS2307` errors that look like real bugs.

## Reporting back

Summarize: how many tests the inventory listed; how many bodies the fleet filled;
what VALIDATE confirmed vs bounced (and why); the final `rune lint --strict` result and
the run-all verdict; and — loudest — anything that hit a retry cap or still fails. Then
name the handoff: `rune:cake` for e2e.
