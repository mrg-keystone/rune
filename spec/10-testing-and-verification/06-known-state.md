## Known state

Nothing here is enforced automatically. `deno task verify` is the one binary
machine bar the repo has — it passes only when the ladder is entirely green —
but it, the per-layer unit suites, and the e2e suites are all invoked by hand
from the checkout, on separate schedules, and none of them shares a runner
with the other: `deno task verify` does not run the unit suites, and no CI
workflow runs any test task at all.

| Surface | Runs when | What it covers | Under a machine bar? |
| --- | --- | --- | --- |
| `deno task verify` (3 drift guards + the gate ladder) | by hand | drift, corpus, artifact contract, goldens, Studio parity, governance — full roster: [01-the-verify-ladder](01-the-verify-ladder-deno-task-verify.md); guard list: [05-drift-guards](05-drift-guards-the-other-half-of-testing.md) | **Yes** — binary, zero-tolerance (pass condition owned by 01-the-verify-ladder) |
| Per-layer unit suites (`deno test -A src/`, `test:keep`, keep's browser units, studio units, `cargo test`) | by hand | engine/runtime/studio/Rust-parser units — full list: [04-per-layer-suites](04-per-layer-suites.md) | No automated gate — only the rebuild-era "no new unit-suite failures" convention (stash-and-compare), itself checked by hand |
| e2e suites (`deno task test:e2e`, `test:e2e:checkout`, `deno task cake`) | by hand | cake + checkout acceptance suites, opt-in browser stages — [03-acceptance-suites-e2e](03-acceptance-suites-e2e.md) | No |
| The two CI workflows (`release-rune.yml`, `publish-keep.yml`) | on release | build, stamp, and publish the two trains — [11-release-and-distribution](../11-release-and-distribution/00-overview.md) | No — neither runs a test task; **CI runs zero tests** |

Three unit-suite failures are known, all three in the ENGINE suite
(`deno test -A src/`); the convention above is the only rule that has ever
covered them. The RUNTIME suite (`deno task test:keep`) has no known
failures — it runs clean.

| Test | Suite | Why it fails | Since | Governing bar |
| --- | --- | --- | --- | --- |
| `data-class-returns` — case 1 | engine (`deno test -A src/`) | not diagnosed beyond the rule name in this record | predates the rebuild | the rebuild-era convention (row above) — not an automated gate |
| `data-class-returns` — case 2 | engine (`deno test -A src/`) | not diagnosed beyond the rule name in this record | predates the rebuild | same |
| the git-root smoke test | engine (`deno test -A src/`) | environment-sensitive — fails depending on where it's invoked relative to the git checkout root | predates the rebuild | same |

A field report (`feedback/feedback.md`) demonstrated that a green `--strict`
suite can still hide systematic bug classes (cross-flow, crash/restart,
representation mismatches, off-path lifecycle, wire seams) — which is why the
build pipeline's test inventory now *requires* hardening rows in those
categories ([09-claude-skills.md](../09-claude-skills/00-overview.md)).

To refresh this snapshot: engine unit count and failures ← `deno test -A
src/` (the only suite the ledger above tracks failures for); ladder-green ←
`deno task verify`. If `deno task test:keep` ever produces a failure, add it
to the ledger with `runtime (deno task test:keep)` as its Suite and fold it
into this refresh command too.

> **Provenance.** `docs/REBUILD-PROGRESS.md` is a point-in-time record from
> the rebuild's completion, not a live count — its gate roster predates the
> corpus's growth to today's 20 + 14. It captured the ladder all green, with
> the unit suite at 223 pass / 3 pre-existing failures (the ledger above); the
> "no new unit-suite failures" convention belongs to that same era.
