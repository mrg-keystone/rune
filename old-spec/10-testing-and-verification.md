# Testing & Verification

> Part of the [project spec series](README.md). The oracle is `fixtures/` +
> `scripts/verify.ts`; the acceptance suites are `e2e/`; each layer also has
> its own unit suites. The philosophy: most derived artifacts are drift-gated
> (grammar + highlights, byte-for-byte against regeneration) while a few
> (the artifact schema, canonical-shape docs, and codegen-template mirror)
> are regenerable but ungated;
> behavior is pinned either by goldens or, where there is no golden to pin
> (L5), by live output checked against live output. "Green" is established
> by machine, not by claim.

## The verify ladder — `deno task verify`

`deno task verify` = the three drift guards (`check:lockstep`,
`check:spec-refs`, `check:agent-guardrail`) followed by `scripts/verify.ts`,
a gate ladder where each gate is a deterministic pass/fail over fixed inputs
(`fixtures/`, the live artifact `lang/keywords.json`, or a baseline crafted
in the gate). Run one gate with `--gate <name>` — every gate in the table below
is selectable by its name, matched case-insensitively (`--gate L3`,
`--gate drift`, `--gate corpus`, `--gate governance`, `--gate grammar`);
recapture goldens intentionally with `--update-goldens` (an unreviewed golden
diff is exactly the failure mode this guards against — review before
committing).

| Gate | Proves |
| --- | --- |
| **Drift** | Regeneration (`scripts/generate.mjs`) reproduces **grammar + highlights** byte-for-byte — the only two artifacts this gate regenerates and `git diff --exit-code`s (`lang/grammar/grammar.js`, `lang/queries/highlights.scm`). The artifact schema, canonical-shape docs, and codegen-template mirror are produced by separate, ungated scripts (`gen-artifact-schema.ts`, `gen-shape-docs.ts`, `gen-codegen-templates.ts`), none of which the Drift gate invokes or diffs, and none of which is byte-diffed anywhere else either: L3/L6/L7 exercise the live templates the mirror copies (their goldens and in-memory mutations run against the live source, never against the mirror file), so the mirror's consistency with its source is checked only indirectly — the artifact schema, canonical-shape docs, and codegen-template mirror are not drift-gated at all |
| **corpus** | Every `fixtures/corpus/valid/*.rune` parses with zero errors; every `invalid/*.rune` parses with ≥ 1 error — the `valid/`/`invalid/` directory is the fixture's expected verdict, and the gate itself checks accept/reject only, never which error fired. Error identity is pinned elsewhere: for artifact fixtures, by L1's `fixtures/artifact/expectations.json`; for the `[TYP]` constraint-modifier, `[ENT]` HTTP-method, and empty-`@docs` messages, by the dedicated parser-parity unit tests (see Per-layer suites) |
| **L0** | Determinism: parse / manifest / `lint --json` byte-identical across two runs |
| **L1** | The artifact contract + meta-validator: crafted-invalid artifacts (bad schemaVersion, duplicate tag id, unknown lint tag, profile gap, …) are rejected with their pinned identity — `fixtures/artifact/expectations.json` maps each `invalid/*.json` fixture to a substring the rejection's error message or path must contain |
| **L2** | Parse goldens match (`golden/parse/*.json` — the full AST, one golden per `corpus/valid/` spec; `invalid/` specs get no parse goldens — their only pin is the corpus gate's verdict) |
| **L3** | Codegen goldens match (`golden/manifest/*.json` — the planned file tree, paths + content; same input set as L2: one golden per `corpus/valid/` spec, all 20, not just the `[MOD]` ones) |
| **L4** | Lint goldens match (`golden/lint/*.json` over fixture projects) |
| **L5** | Studio interpreter == engine: for each of the three `[MOD]` corpus specs (`module-billing`, `module-catalog`, `entrypoint`), the Studio's `generate` (`rune-studio/lib/engine.ts`) must byte-equal the engine's planned file list (`planManifest`'s `toCreate` + `toRegenerate`, paths + content, sorted by path) — live output compared to live output, no golden; the gate also asserts the retired Rust bridge (`lib/runegen.ts`) stays deleted |
| **L6** | Artifact-driven behavior — the artifact, not the code, is in charge. Five in-memory mutations of the live artifact (`lang/keywords.json`), each a `structuredClone` handed to an engine entry point (never a disk write), must each change behavior: **binding** — dropping `<name>`'s `stripSuffix` makes `module-billing`'s DTO paths gain a `-dto` segment; **codegen-template** — a marker prepended to the `adapter-smk-test` template appears in the generated smoke test; **parse-recognition** — adding `[CONS]` as a tag synonym makes an inline snippet's unknown literal parse; **lint-policy** — flipping `module-isolation` to warning and disabling `no-relative-import` (the artifact/lint-policy name for the engine rule surfaced as `import-aliases` — one of the six rules that fire on `dirty`) both change a real lint run over `projects/dirty`; **UI-data-path** — the binding edit replayed through the Studio's registry-driven `generate` (the call `/api/generate` makes). The unmutated bindings and codegen templates must first reproduce the engine's default output (so L3 holds). The no-code-change guarantee is the in-memory mechanism itself — the mutations are clones that never touch disk, so no source file can change. The gate also snapshots `git diff --name-only -- src/shape-checker` before and after — a pathspec that is pre-reorg (the engine now lives under `src/`) and matches nothing at HEAD, so the tripwire is vacuously stable |
| **L7** | The N-1 artifact (`fixtures/artifact/n-1/legacy.json` — first proven genuinely older: the current contract must reject it) migrates forward to a valid artifact, under which each of the three `[MOD]` corpus specs still parses with zero errors and generates **byte-identically**: `planManifest` fed the migrated bindings + codegen templates must equal the default engine plan (the same output L3's goldens pin), not merely succeed |
| **governance** | Locked rules cannot be weakened: against an inline two-rule baseline crafted in the gate (a locked `layer-restrictions` error rule + an unlocked `module-fragmentation` warning rule — no fixture), the governance module's `applyOverlay`/`overlayIsCompliant` must reject a spec-author overlay disabling the locked rule (it stays enabled and the attempt is recorded in the audit trail), judge a severity downgrade of it non-compliant, and still let the unlocked rule tune freely |
| **grammar** | The grammar regenerates from the artifact and compiles to WASM; all tags wired |

> The L0…L7 numbering is this table's, not the execution order — `verify.ts`
> runs L1 (the artifact meta-validator) before L0 (the determinism check); the
> rest run in listed order.

> **[DECIDE]** L6's git-diff tripwire: keep the current `src/shape-checker`
> pathspec for exact parity with `verify.ts` as it stands (vacuously stable —
> it can never fire), or fix `verify.ts` to scope the diff to `src/`?
> Recommended default: scope it to `src/` — the in-memory `structuredClone`
> mechanism remains the operative no-code-change guarantee either way, and a
> `src/`-scoped tripwire can actually fire.

## The fixture corpus (`fixtures/`)

- `corpus/valid/` (20) + `corpus/invalid/` (14) — full tag coverage, all
  boundary prefixes, faults 0/1/many, polymorphism single/many/nested,
  `:core`, static vs instance, inline DTOs, multi-module, a realistic
  `example-e2e`, plus the parser's error paths. One documented lenient gap:
  `valid/poly-nested.rune` (a `[PLY]` inside a `[CSE]` — spec-illegal, parser
  accepts; owned by the WO-4c/4d follow-up).
- `golden/{parse,manifest,lint}/` — the captured baselines for L2–L4.
- `projects/` — L4 lint targets: three trees **materialised from corpus
  specs** (regenerated by `--update-goldens`; prove generated output stays
  lint-clean) plus `dirty/`, a hand-authored tree whose golden
  (`golden/lint/dirty.json`) pins 13 findings across 6 rules
  (external-imports, import-aliases, module-fragmentation, module-isolation,
  no-dto-cast, structure) (proves the linter actually fires; also L6's
  lint-policy target).
- `artifact/` — valid/invalid/n-1 artifacts feeding L1 and L7.
- `specs/`, `bullshit/`, `eval/` — a full generated composed project with a
  real `data.json`; a whole-diamond realistic scaffold (product spec, modules,
  heal-rules); and seed drafts for exercising the scope/spec skills.

## Acceptance suites (`e2e/`)

Both are real rune-generated modules (spec committed, coordinator bodies
hand-filled with deterministic values), workspace members resolving the
**in-tree** runtime, each served by a tiny `bootstrapServer` script. Run
in-process via `deno task test:e2e` (checkout alone: `deno task
test:e2e:checkout`). The browser stages are opt-in tests inside those same
suites, skipped unless the env var `KEEP_BROWSER=1` is set: `KEEP_BROWSER=1
deno task test:e2e` runs both suites' browser stages in headless Playwright
chromium — including checkout's branch-walk, which has no dedicated task.
`deno task cake` is the watchable convenience for the cake walk only: it
provisions chromium, then runs `e2e/cake/cake.e2e.test.ts` headed
(`KEEP_BROWSER=1 KEEP_HEADED=1`).

- **`e2e/cake/`** — the linear chain: six endpoints
  (drive→shop→checkout→mix→bake→cut) whose DTO field names chain so sync
  auto-derives `order`/`dependsOn`/`bind` with zero hand-wiring. Pins the
  exact routes + schemas + `x-keep-process` metadata, the in-process
  `exerciseEndpoints` walk, docs-page serving/gating, and a full
  headless-chromium cake walk (progressive unlock, `{{step.field}}` autofill,
  Run all).
- **`e2e/checkout/`** — the non-linear constructs: `[ENT:card]`/`[ENT:cash]`
  XOR flows, the OR-join (first-resolvable-wins bind), a `[TYP:ext]`
  `$memberId` external input (proven real: the unseeded run *fails*),
  `[ENT:optional]`, the browser branch-walk, and — the contract-lifecycle
  acceptance — a composed `[membersModule, httpModule]` app where a real
  producer auto-satisfies `$memberId` with **zero seeds**, ordering producer
  before consumer.

## Per-layer suites

```sh
deno test -A src/                    # the engine (parser, codegen, lint rules)
deno task test:keep                  # the runtime's unit suite (logging, tracing, assert→422, DI, docs, routing)
cd keep && deno task test:browser    # keep's own emulator-ui + map-ui browser units (not e2e/)
deno task test:e2e                   # the acceptance suites above
(cd rune-studio && deno test -A tests/)   # studio parse/engine/lint units
(cd lang && cargo test --workspace)  # Rust parser + LSP (incl. corpus parity)
```

The Rust LSP's corpus-parity tests deserve emphasis: they run its diagnostics
against the same `fixtures/corpus/` the engine is gated on and assert the
corpus gate's verdict contract — every `valid/*.rune` yields zero diagnostics,
every `invalid/*.rune` at least one — which is what keeps the hand-maintained
Rust port in lock-step with the TS parser of record. Parity is verdict parity,
not serialized-diagnostic equality; the messages that must match the TS engine
byte-for-byte (the `[TYP]` constraint-modifier, `[ENT]` HTTP-method, and
empty-`@docs` errors) are pinned by dedicated unit tests in the same suite.

One runnable that is *not* a suite: `deno task example` (`deno run -A
examples/in-process-client/main.ts`) is a hands-on demo — not a gated test — of the
in-process `backend.fetch` client (the runtime concept lives in
[06-runtime.md](06-runtime.md)). A tiny Users controller is bootstrapped once, then
GET / POST / path-param / 404 calls are dispatched through the full server pipeline
with no port bound and no token. Backed by
`examples/in-process-client/{server,main,users}.ts` + its README; the directory is a
workspace member (`deno.json`) but no verify gate runs it.

## Drift guards (the other half of "testing")

| Guard | Task | Keeps honest |
| --- | --- | --- |
| `scripts/check-keep-lockstep.ts` | `check:lockstep` | rune-emitted decorator-stack ranges == keep's (the single-copy invariant) |
| `scripts/sync-spec-skill-refs.ts --check` | `check:spec-refs` (regen: `sync:spec-refs`) | rune:spec's bundled references == `lang/docs/` + `examples/todos/` |
| `scripts/sync-agent-guardrail.ts --check` | `check:agent-guardrail` (regen: `sync:agent-guardrail`) | every agent carries the current guardrail block |
| `keep/scripts/check-jsr-deps.ts` | `check:keep-jsr` | JSR subpath exports valid across all matching versions (publish preflight) |

The middle two guards are each one script in two modes: with `--check` it verifies
only (the gate, `check:spec-refs` / `check:agent-guardrail`); run bare — `deno task
sync:spec-refs` / `sync:agent-guardrail` — it regenerates the derived file in place.
The `check:` task *is* that same script plus `--check`, so the fixer and the gate can
never drift apart. (`check:lockstep` and `check:keep-jsr` are check-only — no sync twin.)

A `deno task hooks` (`git config core.hooksPath .githooks`) is wired to point git at a
repo-tracked hooks directory — the obvious place to run these guards pre-commit — but
`.githooks/` is **not present in the tree**, so the task currently sets git's `hooksPath`
to a path that does not exist: a no-op today (git finds no hooks there and silently
proceeds), and a latent defect if anyone assumes commits are guarded by it. Nothing runs
the drift guards on commit; they fire only when invoked by hand (see Known state).

## Known state

`docs/REBUILD-PROGRESS.md` is a point-in-time record from the rebuild's
completion, not a live count (its gate roster predates the corpus's growth to
today's 20 + 14). It captured the ladder all green, with the unit suite at
223 pass / 3 pre-existing failures (two `data-class-returns` cases + an
env-sensitive git-root smoke test — predating the rebuild, untouched); the
practical bar used during that development — *no new unit-suite failures*,
established by stash-and-compare — belongs to the same era. Today's machine
bar is binary: `deno task verify` passes only when all three drift guards and
every ladder gate exit green — it tolerates no failures and does not run the
unit suite (`deno test -A src/` is a per-layer suite). That bar is also the
whole automated enforcement surface — and it is invoked by hand: the repo's
only workflows (`.github/workflows/release-rune.yml` and `publish-keep.yml`)
are the two publish trains, which build, stamp, and release but run no test
task, so nothing runs `deno task verify`, the per-layer unit suites, or the
e2e suites automatically. All of them are run manually from the checkout, and
the 3 legacy unit failures sit under no machine bar at all — the only rule
that ever covered them is the rebuild-era "no new unit-suite failures"
convention above. A field report
(`feedback/feedback.md`) demonstrated that a green `--strict` suite can
still hide systematic bug classes (cross-flow,
crash/restart, representation mismatches, off-path lifecycle, wire seams) —
which is why the build pipeline's test inventory now *requires* hardening rows
in those categories ([09-claude-skills.md](09-claude-skills.md)).
