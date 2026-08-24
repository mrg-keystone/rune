## Package hygiene

`keep/deno.json` is keep's **own** package manifest — the config for the
JSR-published `@mrg-keystone/rune` package itself, distinct from the
generated project's `deno.json` that `rune sync` maintains. The consumer-side
import map (including the `#assert` pin) is owned by [03-cli.md §
`rune sync` — semantics that matter, step
4](../03-cli/02-rune-sync-semantics-that-matter.md), the single authoritative
pin-set owner — [01-architecture.md § The canonical generated-project
shape](../01-architecture/05-the-canonical-generated-project-shape.md) does
not enumerate pins of its own and defers to it; it is not re-enumerated here.
Per step 4's `REQUIRED_IMPORTS`, plus the lockstep guard in
[11-release-and-distribution.md](../11-release-and-distribution/00-overview.md):
`class-validator`, `class-transformer`, and `reflect-metadata` are written
into the consumer's import map as direct pins, alongside `@mrg-keystone/rune`
and `#assert`.

It exports `.` (the package root) and `./assert`. `./assert` is a **subpath
of this same package**, never a package of its own: it's the publisher-side
half of the single-copy invariant
([03-the-assert-runtime-assert.md](03-the-assert-runtime-assert.md)) — a
generated project's `#assert` alias resolves through this subpath to the
exact copy of keep already on its dependency graph, keeping `assert` itself
from ever forking a second copy. The subpath alone doesn't make a second copy
of class-validator/class-transformer/reflect-metadata impossible — that's a
real, detectable failure mode if their version ranges drift apart from
keep's, which is why 11-release's lockstep guard exists to police and
enforce the single-copy invariant across the whole decorator stack (see
[06-runtime/03 §
single-copy](03-the-assert-runtime-assert.md)).

| Task | What it exercises |
| --- | --- |
| `test` | keep's own unit suite — logging, tracing, `assert` → 422, DI, the docs module, routing (run from the workspace root as `test:keep`; see [10-testing-and-verification.md § Per-layer suites](../10-testing-and-verification/04-per-layer-suites.md)) |
| `test:browser` | Playwright cake tests — headless-chromium coverage of the docs surface's emulator-ui + map-ui, distinct from `e2e/`'s browser stages |
| `test:smoke` | a packaging-level boot-and-serve check — see below |
| `check:jsr` | `keep/scripts/check-jsr-deps.ts` validates subpath exports resolve across every version matching each dependency range (run from `keep/`; exposed at the workspace root as the `check:keep-jsr` alias, a thin wrapper around `cd keep && deno task check:jsr` — see [10-testing-and-verification.md § Drift guards](../10-testing-and-verification/05-drift-guards-the-other-half-of-testing.md)) |

`test:smoke` boots `bootstrapServer` against a minimal fixture module and
drives a handful of requests over real HTTP, catching packaging/wiring
issues `test`'s in-process unit suite can't — the packaging-level
counterpart to `test`'s in-process unit coverage.

How `check:jsr` plugs into the publish preflight, and the round trip it saves,
is [11-release-and-distribution.md § Train 2 — the runtime
(JSR)](../11-release-and-distribution/02-train-2-the-runtime-jsr.md)'s to
own, not restated here. Publishing is CI-automated on push to main — see
[11-release-and-distribution.md](../11-release-and-distribution/00-overview.md).
