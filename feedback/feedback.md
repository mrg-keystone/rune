# Feedback for the rune maintainer

Context: this repo is a full diamond rebuild of arachne (a scatter/gather HTTP flow
orchestrator) — rune 4.2.0 (upgraded from 3.1.0), sprig 0.20.29, four keep modules
(board, core, ingest, targets), composed via `serveSprig({keep, app})`. The notes
below come from running the whole pipeline to completion, then an adversarial
92-agent debug sweep over the engine (39 candidates → 21 reproduced bugs; suite
162 → 186 green — details in `spec/misc/debug-sweep.md`), plus live crash-recovery
experiments against the running composed app. Each item: what we saw → suggestion.

## What worked well (keep these)

- **The event-sourced fold is a gift for operability.** Every engine question in this
  project — "why didn't it fan out", "is it stuck", "does it survive a kill -9" — was
  answered by reading `flow_event` rows. Crash-recovery proofs took minutes because
  the durable log IS the state.
- **The in-process `backend.fetch` client** made headless exercise, seeding, and
  repair scripts trivial and safe (no token plumbing). It is the best-behaved seam in
  the stack.
- **Boot diagnostics are accurate and actionable** — the INFRA_URL/session-store
  warnings and the route-audit both said exactly the true thing.
- **Generated colocated test style** (`*.test.ts` beside `mod.ts`) let a fix fleet add
  24 regression tests without inventing any new conventions.

## Runtime / keep API

1. **`deno serve` + background loops needs a first-class hook.** Because `deno serve`
   never runs `import.meta.main`, our orchestrator heartbeat had to be started at
   module top level in `serve.ts`, hand-guarded with a `globalThis` symbol against
   double-start under `--watch`. Suggestion: let `serveSprig`/`bootstrapServer`
   accept lifecycle callbacks (`onStart`/`onStop`) so apps with tick loops don't each
   reinvent this (and each risk the double-interval bug).

2. **Internal-only endpoints trip the route audit every boot.** Our tick endpoint
   (`POST /http/orchestrator-tick`, called only by the in-process client) declares
   neither `@Public` nor `@Grant`, so every boot logs the deny-by-default audit
   warning. The posture is correct; the noise is not. Suggestion: an explicit
   `@Internal`/`@InProcessOnly` decorator that documents the intent and satisfies the
   audit.

3. **The 4.2.0 `INFRA_URL` default flip deserves a loud upgrade note.** On 3.1.0,
   bearer verification was off unless set; 4.2.0 bakes in the keystone infra default
   and requires an explicit empty string to opt out. The boot warning is good, but we
   only understood the behavior change from experimentation. A CHANGELOG entry +
   README callout ("upgrading from 3.x: set `INFRA_URL=` for local-dev @Public
   posture") would have saved a session.

4. **Control-plane doors (`/docs/_run`, `/docs/_fixtures`) 403 all external callers,
   including localhost** — in-process is the only sanctioned headless path. Fine
   posture, but it's discovered by failing. Suggestion: the 403 body itself should
   say "use the in-process client (`api.backend.fetch`) — no localhost bypass exists."

## Codegen / DSL ergonomics — the JSON-in-string problem

This one caused real, reproduced bugs and one bad API experience, so it's the item
I'd weigh heaviest:

- The DTO layer pushes list/object fields through JSON-encoded **strings**
  (`stepsJson`, `payloadJson`, `chunkInputsJson`, `headersJson`, ...). Submitting the
  natural shape (`steps: ["a","b"]`) 422s; the caller must pre-stringify.
- The same convention inside the engine produced two confirmed bugs in our sweep
  (level-0 payload double-encoding; truncated-body strings silently failing
  `JSON.parse` and flipping a scatter into a collapse), plus generated-adjacent code
  that queries `payloadJson` with `LIKE` patterns — a substring-match footgun.
- Suggestion: first-class typed array/object fields on `[DTO]` (the swagger builder
  already reads `design:type`), with the string encoding as an internal wire detail —
  or at minimum a `[TYP:json]` modifier that validates parseability at the boundary
  instead of letting invalid JSON degrade silently downstream.

Related: the dispatch wire's "body is a Primitive string" rule forces every consumer
to `JSON.parse`-with-fallback, and the fallback is a **silent semantic cliff** (a
target replying `['a','b','c']` — single quotes — quietly becomes a scalar and the
flow collapses instead of scattering; we hit this live). Suggestion: carry parse
status on the wire (`{ body, parsed: boolean }`) so engines can surface "didn't parse
as JSON" instead of silently changing meaning.

## The build pipeline (rune:build) — where 21 bugs got past a green suite

The fleets produced a fully green 162-test suite, `rune lint --strict` clean — and an
adversarial sweep still reproduced 21 real bugs. The misses were systematic, not
random; the per-method TDD inventory structurally cannot see them:

- **Cross-flow interactions** (content-hash chunk ids collide across flows; per-flow
  tests never instantiate two flows).
- **Crash/restart paths** (orphan re-enqueue double-counting its own lane slot;
  nothing in the inventory kills a process).
- **Representation mismatches between layers** (lexical vs epoch `matureAt`
  comparison; acceptance and due-selection disagreed on the same value).
- **Lifecycle states off the happy path** (`scheduled` flows dispatched but never
  folded — no test ever submitted a future-dated flow).
- **Wire-contract seams** (body truncation cap interacting with shape ruling).

Suggestion: add a hardening rung to the pipeline after the cake — an adversarial
pass with lenses explicitly targeting cross-entity interaction, process death,
time/encoding representation, and each wire seam. Alternatively (cheaper): have
rune-build-analyst's test inventory REQUIRE at least one test per module in each of
those categories, so the fleet writes them up front. The per-batch validators were
not the weakness — every miss traces to a test that was never enumerated.

## Toolchain guards

1. **The pipeline ran an entire build inside a broken git checkout and nothing
   flagged it.** This repo's `.git` is a dangling worktree pointer (the main repo was
   deleted); every artifact — spec, four modules, the app, 186 tests — existed only
   as unversioned files for the whole build. Worktree-isolated agents were silently
   unavailable too. Suggestion: a rung-0 gate in the conductor: verify `git status`
   works and the tree is committable before generating anything, and warn hard if
   fixes/fleets will run without VCS.

2. **Composed-repo layout is unpinned and drifts.** Across the ecosystem docs there
   are at least three shapes: `serve.ts` beside `bootstrap/` at one root (sprig
   serving reference), a `ui/` + `server/` two-package convention (our other repos),
   and what this repo ended up with (backend owns the root, app nested at `app/`
   aliasing `"@/": "../"`). Nothing gates it, so each build invents one. Suggestion:
   the scaffolder should pin one canonical layout (and record deviations as an
   explicit artifact, e.g. `spec/misc/layout.md`) so the shape of a composed repo is
   a decision, not an accident.
