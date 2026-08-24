## Per-layer suites

Where [the verify ladder](01-the-verify-ladder-deno-task-verify.md) gates the
engine's own artifacts and behavior, and [the acceptance suites](03-acceptance-suites-e2e.md)
exercise whole generated apps end to end, this file is the per-layer unit
tier: each layer's own unit suite, run in isolation. None of these are wired
into automation — `deno task verify` does not run any suite below, and no
workflow does either (the repo's only workflows are the two publish trains;
see [Known state](06-known-state.md)). Every row is run by hand from a
checkout.

| Layer / component under test | Command | Run from | Covers | Run by |
| --- | --- | --- | --- | --- |
| The engine | `deno test -A src/` | repo root | parser, codegen, lint rules | hand |
| The runtime's unit suite | `deno task test:keep` | repo root | logging, tracing, assert→422, DI, docs, routing | hand |
| keep's browser units | `cd keep && deno task test:browser` | `keep/` (`cd`) | keep's own emulator-ui + map-ui browser units (not `e2e/`) | hand |
| Studio | `(cd rune-studio && deno test -A tests/)` | `rune-studio/` (subshell `cd`) | parse/engine/lint units | hand |
| Rust workspace | `(cd lang && cargo test --workspace)` | `lang/` (subshell `cd`) | Rust parser + LSP (incl. corpus parity) | hand |

Not a per-layer suite, but the runnable that ties them all together: `deno
task test:e2e` is the cross-layer acceptance suite, owned by
[Acceptance suites (`e2e/`)](03-acceptance-suites-e2e.md). It's listed here
only so the "run everything" picture is complete.

The engine (`deno test -A src/`, the first row) carries no clean-green
machine bar the way the verify ladder's gates do — it has known pre-existing
failures. The standing rule is *no new failures*: a run must not regress past
that baseline. The failure count and roster are tracked in
[Known state](06-known-state.md), not here. The runtime's unit suite
(`deno task test:keep`, the second row) has no known failures — it is
clean-green.

keep's browser units (`cd keep && deno task test:browser`, the third row) are
a suite distinct from `e2e/**`, and `KEEP_BROWSER` — the variable that gates
the e2e browser stage (`KEEP_BROWSER=1 deno task test:e2e`; see
[Environment variables — test-only](../13-environment-variables/05-test-only.md))
— does not extend to it: `test:browser` ignores `KEEP_BROWSER` and runs its
emulator-ui/map-ui browser units unconditionally. That variable gates only
the e2e browser stage, not this row, so the one hand-run command that names
the suite is sufficient on its own to run it.

The Rust LSP's corpus-parity tests deserve emphasis: they run its diagnostics
against the same `fixtures/corpus/` the engine is gated on and assert the
corpus gate's verdict contract — every `valid/*.rune` yields zero diagnostics,
every `invalid/*.rune` at least one — which is what keeps the hand-maintained
Rust port in lock-step with the TS parser of record. Parity is verdict parity,
not serialized-diagnostic equality; the messages that must match the TS engine
byte-for-byte (the `[TYP]` constraint-modifier, `[ENT]` HTTP-method, and
empty-`@docs` errors) are pinned by dedicated unit tests in the same suite.

One runnable that is *not* a suite: `deno task example` (`deno run -A
examples/in-process-client/main.ts`) is a hands-on demo — not a gated test —
of the in-process `backend.fetch` client (the runtime concept lives in
[06-runtime.md](../06-runtime/00-overview.md)). The directory is a workspace
member (`deno.json`), but no verify gate runs it.

