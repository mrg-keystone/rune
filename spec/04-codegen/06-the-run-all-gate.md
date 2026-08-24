## The run-all gate

Sync's final act: write a throwaway runner script that, in a subprocess,
imports `bootstrap/mod.ts`'s `api = await bootstrapServer(...)` result —
**not** the composed `serve.ts` — and passes that result's `{ backend, docs }`
straight into keep's `exerciseEndpoints` — the same walk
[the headless runner](../07-cake/04-the-headless-runner-exerciseendpoints-opts.md)
specifies (topological order, the green-loop, seed/bind resolution, the
`{ passed, failed, optionalFailed, … }` report) — printing a verdict last.
The gate keeps keep boot alone this way: it awaits `bootstrap/mod.ts`'s `api`
export directly, never touching the `Backend` composition function or
`serve.ts`'s wiring.

Right after a fresh sync, every generated core is still
`throw new Error("not implemented")` — red by design. A red run-all
immediately after generation is therefore the *expected* state, not an error
in the run: nothing has been implemented yet, so nothing can be green. That's
why the verdict only notices and never blocks — it stays advisory no matter
what it prints:

`N` and `M` count **required** (non-optional) steps only — the same steps
`exerciseEndpoints`'s `failed` bucket can hold. Optional endpoints are walked
too, but a failed optional lands in `optionalFailed`, never `failed` (the
headless runner's report semantics), so optional steps never count toward `N`
or `M` and an optional failure never turns `N/N` into `M/N`; it's called out
in the verdict instead.

| Situation | Verdict printed | Effect on exit |
| --- | --- | --- |
| Every required step goes green, no optional failures | `run-all: N/N steps passed — keep boots and runs green` | advisory, exit unchanged |
| Every required step goes green, `optionalFailed` non-empty | `run-all: N/N steps passed (K optional failed)` | advisory, exit unchanged |
| `exerciseEndpoints` returns a non-empty `failed`, no optional failures | `run-all: M/N steps passed` (M < N) | advisory, exit unchanged |
| `exerciseEndpoints` returns a non-empty `failed` *and* `optionalFailed` non-empty — the expected state right after a fresh sync, once any module has an optional endpoint | `run-all: M/N steps passed (K optional failed)` (M < N) | advisory, exit unchanged |
| The subprocess can't boot keep | `run-all: could not boot keep — <error>` | advisory, exit unchanged |
| The subprocess crashes or times out mid-walk | `run-all: crashed/timed out — <error>` | advisory, exit unchanged |
| Nothing to exercise (no `[ENT]` surfaces yet) | `run-all: nothing to exercise` | advisory, exit unchanged |

Every outcome is a single `run-all: …` line, grep-able the same way as the
green/red cases above.

Together with red-by-design cores and fault-implied tests, this is the
["you can't not notice" principle](../00-overview/03-the-core-ideas.md):
generation never pretends the app works. The gate's exact slot in the ordered
sync run — step 10, and what has to succeed before it runs — is
[`rune sync`'s semantics](../03-cli/02-rune-sync-semantics-that-matter.md).

The generated `e2e.test.ts` ([the pipeline](01-pipeline.md)) drives the same
`exerciseEndpoints` engine, one surface at a time: run-all is the sync-time,
whole-app, advisory verdict; `e2e.test.ts` is the `RUNE_E2E`-gated,
per-surface test-suite form — same engine, two entry points.

Skippable with `--no-run`, for batch or scripted syncs where the
subprocess-boot cost is unwanted, and for pipelines that already run a
separate `RUNE_E2E` stage (via the generated `e2e.test.ts` above) covering
the same ground.
