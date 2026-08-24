## Layering inside the engine (`src/`)

The engine practices the architecture it enforces (hexagonal, the same rules
`rune lint` applies to generated projects):

- `src/bootstrap/` — composition root: arg dispatch, the `rune lint` verb's
  driver (`lint` is the sole exception to the front door's rule that every
  command is a `run*` entrypoint re-exported from `mod-root.ts`: there is no
  `runLint`, and bootstrap dispatches it inline instead — it calls the flag
  parser and printers that `src/rune/entrypoints/cli.ts` defines, then runs
  the coordinators' `runPipeline` over the 27 rules directly),
  Rust-helper resolution. `config.ts` is a build-time script that writes
  `src/core/dto/lsp-config.ts`.
- `src/core/` — shared kernel: `dto/types.ts` (pipeline/rule contracts, Zod
  schemas) and `business/classify/` (the pure path → {module, layer}
  classifier every lint rule shares).
- `src/rune/` — the domain engine:
  - `entrypoints/` — one folder per CLI verb (`sync`, `check`, `manifest`,
    `dev`, `init`, `update`, `version`, `validate`; `stop` lives in `dev/`,
    and `lint` has no folder and no `run*` entrypoint — bootstrap dispatches
    it inline, per the exception noted under `src/bootstrap/` above) plus
    `cli.ts` (the lint verb's arg parsing and printers) and `spec-root.ts`
    (root/core-spec resolution).
  - `domain/business/` — pure logic, no I/O: `rune-parse` (the parser of
    record), `rune-manifest` (the code generator), `rune-sync` (the
    reconcile planner), `rune-sig`, `rune-modifiers`, `rune-bindings`,
    `rune-stubs` (ghost stubs), `rune-heal` (heal rules), the 27 lint
    `rules/`, and the artifact contract (`artifact/`, `governance/`,
    `migrate/`, `lint-config/`).
  - `domain/data/` — the I/O adapters: `filesystem`, `lsp`, `llm` (OpenAI
    lint suggestions), `project`.
  - `domain/coordinators/pipeline/` — `runPipeline`, wiring rules over the
    filesystem context.

Layer direction (enforced by the `layer-restrictions` rule on itself and on
generated projects). Each arrow lists a layer's complete allowed import set —
importing any layer outside it is a violation: `business → {business, dto}`,
`data → {data, dto}`, `coordinators → {coordinators, business, data, dto}`,
`entrypoints → {entrypoints, coordinators, business, data, dto}`,
`dto → {dto}`, `bootstrap → everything`. `mod-root.ts` belongs to none of
these layers: it sits at the module root, outside the layer directories, so
the shared classifier returns `layer: "unknown"` for it (with a separate
`isModRoot` flag), and `layer-restrictions` skips `unknown` on both ends — a
layer-less file's own imports are never layer-judged, and an import that maps
to no layer (another module's `mod-root.ts`) passes the layer rule.
Cross-module traffic, `mod-root.ts` included, is the separate
`module-isolation` rule's jurisdiction ([05-linter.md](../05-linter/00-overview.md)).

