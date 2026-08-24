## Glossary

| Term | Meaning |
| --- | --- |
| **`.rune` spec** | The per-module DSL file ([02-language.md](../02-language/00-overview.md)) |
| **keep** | The runtime layer directory (`keep/`); "the keep" = a running backend on it. Package: `@mrg-keystone/rune` |
| **sprig** | The sibling frontend framework (separate repo); `rune init` composes a sprig UI with a keep backend |
| **the artifact** | `lang/keywords.json` — the machine-readable language definition |
| **the cake** | The per-module interactive process walk at `/docs/<module>` — served by the addable `DocsModule` (env-gated, off by default) |
| **the system map** | The whole-app process graph at `/docs/_map` |
| **the headless runner** | The programmatic/HTTP endpoint walk at `/docs/_run` — `exerciseEndpoints(opts)`, discovering and driving an app's endpoints to green; the same mechanism the `run-all gate` invokes headlessly at end-of-sync |
| **requirement / `[REQ]`** | One externally triggerable feature, `noun.verb(InputDto): OutputDto`; the happy-path flow a coordinator wraps |
| **step** | One action inside a `[REQ]`'s flow; a plain step runs core logic, a boundary step (`db:`, `fs:`, ...) is an outbound call crossing into a service declared by `[SRV]` (e.g. `db:task.save`) |
| **seam** | A validated data crossing — a `[REQ]`'s input, a boundary read/write, or its output — asserted at runtime via `#assert` |
| **coordinator** | The generated imperative shell for a `[REQ]` — asserts seams, calls the pure core, runs boundaries in spec order |
| **backing service / `[SRV]`** | A declared backing service a boundary step crosses into (e.g. `db`, `stripe`), declared once in the project's shared core spec |
| **fault** | A named failure mode declared under a step, 2 spaces deeper, no bracket tag (`not-found timed-out`); each declared fault implies a generated test case |
| **entrypoint / `[ENT]`** | The only source of an *application's own* HTTP/WS surface; generates an `@Endpoint` controller. (The runtime separately provides its own built-in `/docs/*` surfaces — the cake, the system map, the headless runner — not sourced from an `[ENT]` declaration.) |
| **named type / `[TYP]`** | A named type declaration — the primitive building blocks; `[TYP:ext]` is its external-input modifier |
| **external input / `[TYP:ext]`** | A `[TYP]` modifier marking a consumed field no endpoint produces; binds as `$name`, supplied by the cake or the headless runner |
| **ghost stub** | A generated placeholder producer for an unfulfilled `[TYP:ext]` input; evaporates when a real producer appears |
| **heal rules** | `spec/misc/heal-rules.json` — declarative error-slug → one-click-fix map for the cake's heal panel |
| **the waist / waist rule** | The frontend↔backend contract: queries + command verbs, never an edit-this-record endpoint |
| **the diamond** | The full two-track pipeline (scope → parallel sprig/rune tracks → one contract → one composed app) |
| **lockstep** | The machine-checked requirement that rune-emitted dependency ranges equal keep's (`scripts/check-keep-lockstep.ts`) |
| **run-all gate** | The end-of-sync headless walk of the composed app via `exerciseEndpoints` |
| **goldens / the ladder** | `fixtures/golden/` snapshots + the L0–L7 `deno task verify` gates |
