## Test-only

Not product configuration — used only by the test suites.

| Variable | Purpose | Unset (default) | Read at |
| --- | --- | --- | --- |
| `KEEP_BROWSER` | Gate the e2e browser stage. | Off — e2e browser stage skipped | `e2e/**` |
| `KEEP_HEADED` | Run the e2e browser stage headed — a no-op unless `KEEP_BROWSER` is already on (see the paragraph below the table). Scoped to `e2e/**`; it has no effect on keep's `emulator-ui`/`map-ui` browser units (see the paragraph below). | Off — headless | `e2e/**` |
| `KEEP_PLAYWRIGHT_SMOKE` | Gate the exercise-harness Playwright smoke. | Off — smoke skipped | `exercise-harness/smk.test.ts` |
| `CI` | Skip environment-dependent smoke tests (LLM/LSP) in CI. | Unset (as it is on a local checkout) — LLM/LSP smoke **runs** | `llm/smk.test.ts`, `lsp/smk.test.ts` |

Every `KEEP_*` row above shares one polarity: set → do more (run a suite that's
otherwise skipped, or run it headed). `CI` inverts that polarity: set → do
*less* (skip the environment-dependent smoke). Read each row's own Unset
column rather than assuming the name's polarity.

`KEEP_BROWSER`/`KEEP_HEADED` are consumed by the e2e task table in
[Acceptance suites (`e2e/`)](../10-testing-and-verification/03-acceptance-suites-e2e.md#running-the-suites) —
there is no bare `deno test` invocation that sets them directly; the running
form is `KEEP_BROWSER=1 deno task test:e2e`. `KEEP_HEADED` rides along with
`KEEP_BROWSER` rather than standing alone: setting it with `KEEP_BROWSER`
unset changes nothing, since there's no browser stage running to make headed.
The two travel together in practice as `deno task cake`'s
`KEEP_BROWSER=1 KEEP_HEADED=1` — see that same e2e task table for the one
task that sets both.

Keep's own `emulator-ui`/`map-ui` browser units are a separate suite from
`e2e/**`, run by hand as `cd keep && deno task test:browser`
([Per-layer suites](../10-testing-and-verification/04-per-layer-suites.md));
that one command covers both emulator-ui and map-ui together, with no
separate read site for either. `test:browser` runs those units
unconditionally and does not consult `KEEP_BROWSER` — the one hand-run
command that names the suite is sufficient on its own, with no environment
variable required. `KEEP_BROWSER` has exactly one job in this table: gating
the e2e browser stage above.

`KEEP_PLAYWRIGHT_SMOKE` gates a suite covered by the hand-run,
not-wired-into-`deno task verify` convention in
[Per-layer suites](../10-testing-and-verification/04-per-layer-suites.md).
`CI` matters against [Known state](../10-testing-and-verification/06-known-state.md):
the repo's own two CI workflows run no test task at all, so `CI` here is set
by whatever invokes the LLM/LSP smoke by hand, not by this repo's CI.
