## Acceptance suites (`e2e/`)

Both are real rune-generated modules (spec committed, coordinator bodies
hand-filled with deterministic values), workspace members resolving the
**in-tree** runtime, each served by a tiny
[`bootstrapServer`](../06-runtime/01-bootstrapserver-appname-module-options.md)
script. [The run-all gate](../04-codegen/06-the-run-all-gate.md) already
names two entry points onto one `exerciseEndpoints` engine — sync-time
run-all and the generated per-surface `e2e.test.ts`; these acceptance suites
are a third, distinct context — the toolchain's own hand-maintained walks
over **committed**, real modules — so `e2e/` here is not that generated
`e2e.test.ts` (a name collision only).

### Running the suites

| Command | Suite(s) run | Stage(s) | Browser mode |
| --- | --- | --- | --- |
| `deno task test:e2e` | both | in-process | skipped |
| `deno task test:e2e:checkout` | checkout only | in-process | skipped |
| `KEEP_BROWSER=1 deno task test:e2e` | both | in-process + browser | headless chromium |
| `KEEP_BROWSER=1 deno task test:e2e:checkout` | checkout only | in-process + browser (branch-walk) | headless chromium |
| `deno task cake` | cake only | in-process + browser | headed chromium |

`deno task cake` is the watchable convenience for the cake walk
specifically: it provisions chromium, then runs
`e2e/cake/cake.e2e.test.ts` headed (`KEEP_BROWSER=1 KEEP_HEADED=1` under the
hood). The in-process stages above drive
[the `exerciseEndpoints` walk](../07-cake/04-the-headless-runner-exerciseendpoints-opts.md)
directly — same options, report shape, and green loop specified there. The
browser stages are a different walker: stepping the cake/checkout UI itself
(progressive unlock, `{{step.field}}` autofill, branch stepping, a module's
own **Run all in order**) drives live requests and lands in cake session
state in the browser, not an `exerciseEndpoints` report. Only the system
map's separate **Run all** delegates through `POST /docs/_run` onto that same
walk — and even then the cake's producer selection for a `$`-input isn't
guaranteed to match the runner's (the cake's `auto:` index applies no
downstream exclusion, the runner adds one —
[→07-cake/00](../07-cake/00-overview.md#golden-path-browser-walk-to-ci-replay)).

- **`e2e/cake/`** — the linear chain: six endpoints
  (drive→shop→checkout→mix→bake→cut) whose DTO field names chain so sync
  auto-derives `order`/`dependsOn`/`bind` with zero hand-wiring.

  | Pin | What it proves |
  | --- | --- |
  | Exact routes + schemas + `x-keep-process` metadata | the process-graph the runner/cake/map all read stays pinned |
  | The in-process `exerciseEndpoints` walk | the linear chain goes fully green, endpoint by endpoint |
  | Docs-page serving/gating | the docs surface renders and gates as specified |
  | A full headless-chromium cake walk | progressive unlock, `{{step.field}}` autofill, and Run all all work end to end |

- **`e2e/checkout/`** — the non-linear constructs:

  | Pin | What it proves |
  | --- | --- |
  | `[ENT:card]`/`[ENT:cash]` XOR flows | flow-tagged branching selects the right endpoint set |
  | The OR-join | first-resolvable-wins bind resolution |
  | A `[TYP:ext]` `$memberId` external input | proven real: the unseeded run *fails* |
  | `[ENT:optional]` | optional endpoints ride the green loop without blocking `failed` |
  | The browser branch-walk | the cake UI follows the same XOR/OR-join branching |
  | A composed `[membersModule, httpModule]` app | the contract-lifecycle acceptance — a real producer auto-satisfies `$memberId` with **zero seeds**, ordering producer before consumer |

