# Rune — Project Overview

> Part of the [project spec series](README.md). This file is the orientation
> document: what rune is, the two layers, the core ideas, and a glossary.

## What rune is

Rune builds a backend by **shaping** it instead of writing it. You describe a
module as a tiny `.rune` spec — its entrypoints, requirements (and the steps
and boundaries they take), and data contracts — and rune generates a typed,
validated, lint-clean TypeScript tree from it. That generated code runs on
**rune's runtime** (`@mrg-keystone/rune` on JSR): a Deno backend framework
that turns your modules into a routed, documented, self-verifying app.

**The spec is how you shape the thing; the runtime is the thing your shape runs
on.** You regenerate from the spec — you don't hand-edit the structure — and the
same spec carries you from "write it" to "watch it run green."

The founding motivation (from `lang/README.md`): *"Constrain what LLMs build.
Get exactly what you need."* LLMs hallucinate error handling, forget edge
cases, and invent APIs. A `.rune` spec is a format an LLM can follow precisely:
requirements, boundaries, faults, and data contracts are defined once; the
finished spec outlines acceptance criteria for unit, integration, and e2e
tests; the LLM (or a fleet
of them — see [09-claude-skills.md](09-claude-skills.md)) implements exactly
that — no more, no less.

## The two layers

| Layer | What | Where |
| --- | --- | --- |
| **Shaping** | The `.rune` language, the `rune` CLI (`init`, `sync`, `check`, `lint`, `dev`, `manifest`, `validate`, self-update — each specified in [03-cli.md](03-cli.md); `check` validates a spec, `validate` a `keywords.json` artifact), the architecture linter, the Rust `rune-lsp` / `rune-syntax` helpers, and Rune Studio (the visual editor for the language itself) | `src/` (engine), `lang/` (grammar + `keywords.json`, the single source of truth), `rune-studio/` |
| **Runtime** | The Deno backend framework generated code targets: DI bootstrap, auto Swagger, the interactive **cake**, the live system map, tracing/logging, a headless runner; built on `@danet/core` | `keep/` — published to JSR as [`@mrg-keystone/rune`](https://jsr.io/@mrg-keystone/rune) (the package name is a stable identifier, not a separate product) |

Everything else is shared across both layers: `claude/` (the eight Claude Code
skills + agent fleet), `examples/` (spec→code demos and runnable backends),
`e2e/` (the spec→runtime acceptance suites), `fixtures/` (the verification
corpus and goldens), `scripts/` (generators and drift guards), `docs/`,
`todos/`.

The directories above (`src/`, `keep/`, `lang/`, `claude/`, `examples/`, ...)
are rune's *own* repository layout. A scaffolded app (`rune init myapp`, see
"The loop" below) gets a different, generated layout — `ui/` + `server/` +
`spec/` — that runs *on* the keep runtime rather than *containing* it.

## The core ideas

1. **One source of truth per fact.** The language definition lives in
   `lang/keywords.json`; the grammar, editor highlights, artifact JSON schema,
   canonical-shape docs, and codegen templates are all *derived* from it and
   drift-gated in CI ([08-language-tooling.md](08-language-tooling.md),
   [10-testing-and-verification.md](10-testing-and-verification.md)).
2. **Spec-owned vs dev-owned.** `rune sync` regenerates contracts
   (`mod-root.ts`, module registry) on every run and creates method bodies,
   tests, and adapters exactly once — dev-owned files are never clobbered
   ([04-codegen.md](04-codegen.md)).
3. **Red by design.** Generated cores throw `not implemented`; every declared
   fault implies a test; the sync run ends with a run-all gate so a build
   session can't fail to notice the app doesn't run.
4. **Validated seams.** Generated coordinators assert input, adapter
   reads/writes, and output via the `#assert` runtime; a failed contract maps
   to HTTP 422 with dotted failure paths ([06-runtime.md](06-runtime.md)).
5. **The process is data.** Endpoint order, dependencies, and request autofill
   (`order`/`dependsOn`/`bind`) are derived from the spec's DTO field graph and
   ride into OpenAPI as the `x-keep-process` extension — which powers the cake,
   the system map, and the headless runner ([07-cake.md](07-cake.md)).
6. **Auth-agnostic runtime.** Keep does logging, docs, `#assert`, DI, and
   process metadata; it neither provides nor assumes authentication — you bring
   your own. Every surface is open by default, keep out of the way
   ([06-runtime.md](06-runtime.md)).
7. **The diamond.** Rune is the backend track of a two-track pipeline (the
   frontend track is **sprig**, a sibling project). Both descend from one
   product intent and converge on one contract at the waist — queries +
   commands, never an editable record — then merge into a single composed app
   via `Deno.serve(Backend(Frontend))`
   ([12-history-and-roadmap.md](12-history-and-roadmap.md)).

## The loop, end to end

```sh
rune init myapp && cd myapp            # composed ui/ + server/ monorepo, shared spec/
                                       # every command below runs at this monorepo root
# write spec/runes/<module>.rune       # the module's entrypoints, requirements (steps, boundaries), DTOs, faults
rune check spec/runes/<m>.rune         # spec diagnostics (same as the LSP), zero writes
rune sync  spec/runes/<m>.rune         # generate server/src/<m>/ — red by design
# fill the dev-owned bodies            # coordinator cores, adapters
deno check server/src/**/*.ts          # reconcile after any spec edit
rune lint .                            # lint against the architecture
rune dev                               # or run the whole loop live, cake auto-reloading
```

Then prove it: open `/docs/<module>` (the cake), walk the process on real data,
pin expectations, and drive it headlessly in CI via `POST /docs/_run`.

## Glossary

| Term | Meaning |
| --- | --- |
| **`.rune` spec** | The per-module DSL file ([02-language.md](02-language.md)) |
| **keep** | The runtime layer directory (`keep/`); "the keep" = a running backend on it. Package: `@mrg-keystone/rune` |
| **sprig** | The sibling frontend framework (separate repo); `rune init` composes a sprig UI with a keep backend |
| **the artifact** | `lang/keywords.json` — the machine-readable language definition |
| **the cake** | The per-module interactive process walk at `/docs/<module>` — served by the addable `DocsModule` (env-gated, off by default) |
| **the system map** | The whole-app process graph at `/docs/_map` |
| **requirement / `[REQ]`** | One externally triggerable feature, `noun.verb(InputDto): OutputDto`; the happy-path flow a coordinator wraps |
| **step** | One action inside a `[REQ]`'s flow; a plain step runs core logic, a boundary step (`db:`, `fs:`, ...) is an outbound call crossing into a service declared by `[SRV]` (e.g. `db:task.save`) |
| **seam** | A validated data crossing — a `[REQ]`'s input, a boundary read/write, or its output — asserted at runtime via `#assert` |
| **coordinator** | The generated imperative shell for a `[REQ]` — asserts seams, calls the pure core, runs boundaries in spec order |
| **backing service / `[SRV]`** | A declared backing service a boundary step crosses into (e.g. `db`, `stripe`), declared once in the project's shared core spec |
| **fault** | A named failure mode declared under a step, 2 spaces deeper, no bracket tag (`not-found timed-out`); each declared fault implies a generated test case |
| **entrypoint / `[ENT]`** | The only source of an *application's own* HTTP/WS surface; generates an `@Endpoint` controller. (The runtime separately provides its own built-in `/docs/*` surfaces — the cake, the system map, the headless runner — not sourced from an `[ENT]` declaration.) |
| **external input / `[TYP:ext]`** | A `[TYP]` modifier marking a consumed field no endpoint produces; binds as `$name`, supplied by the cake/runner |
| **ghost stub** | A generated placeholder producer for an unfulfilled `[TYP:ext]` input; evaporates when a real producer appears |
| **heal rules** | `spec/misc/heal-rules.json` — declarative error-slug → one-click-fix map for the cake's heal panel |
| **the waist / waist rule** | The frontend↔backend contract: queries + command verbs, never an edit-this-record endpoint |
| **the diamond** | The full two-track pipeline (scope → parallel sprig/rune tracks → one contract → one composed app) |
| **lockstep** | The machine-checked requirement that rune-emitted dependency ranges equal keep's (`scripts/check-keep-lockstep.ts`) |
| **run-all gate** | The end-of-sync headless walk of the composed app via `exerciseEndpoints` |
| **goldens / the ladder** | `fixtures/golden/` snapshots + the L0–L7 `deno task verify` gates |
