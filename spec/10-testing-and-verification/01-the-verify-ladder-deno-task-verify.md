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
committing; see the walkthrough below).

| Gate | Input | Proves |
| --- | --- | --- |
| **Drift** | live artifact `lang/keywords.json`, regenerated via `scripts/generate.mjs` | `lang/grammar/grammar.js` + `lang/queries/highlights.scm` regenerate byte-for-byte (`git diff --exit-code` against both) |
| **corpus** | `fixtures/corpus/valid/*.rune` (20) + `invalid/*.rune` (14) | every `valid/` spec parses with 0 errors, every `invalid/` spec with ≥ 1 — verdict is the directory only, never which error fired (error identity is pinned elsewhere: L1's `fixtures/artifact/expectations.json` for artifact fixtures; the dedicated parser-parity unit tests for the `[TYP]` constraint-modifier, `[ENT]` HTTP-method, and empty-`@docs` messages — see Per-layer suites) |
| **L0** | `fixtures/corpus/valid/*.rune` (parse + manifest) and the lint fixture projects — `module-billing`, `module-catalog`, `entrypoint`, `dirty` (`lint --json`) | parse / manifest / `lint --json` are each byte-identical across two runs — determinism, no golden |
| **L1** | `fixtures/artifact/invalid/*.json` — crafted-invalid artifacts (bad schemaVersion, duplicate tag id, unknown lint tag, profile gap, …) | each is rejected, and the rejection's error message or path contains the substring `fixtures/artifact/expectations.json` pins for it |
| **L2** | `fixtures/corpus/valid/*.rune` (all 20) | parse output matches `golden/parse/*.json` byte-for-byte, one golden per spec (`invalid/` specs get none — their only pin is the corpus gate's verdict) |
| **L3** | `fixtures/corpus/valid/*.rune` (all 20, same set as L2) | the planned file tree (paths + content) matches `golden/manifest/*.json` byte-for-byte |
| **L4** | the lint fixture projects — `module-billing`, `module-catalog`, `entrypoint` (materialised from the corpus) plus the hand-authored `dirty` | lint output over each matches `golden/lint/*.json` byte-for-byte |
| **L5** | the three `[MOD]` corpus specs (`module-billing`, `module-catalog`, `entrypoint`) | the Studio's `generate` (`rune-studio/lib/engine.ts`) byte-equals the engine's planned file list (`planManifest`'s `toCreate` + `toRegenerate`, paths + content, sorted by path) — live output checked against live output, no golden; also asserts the retired Rust bridge (`lib/runegen.ts`) stays deleted |
| **L6** | live artifact `lang/keywords.json`, five independent in-memory mutations — each a `structuredClone` handed to an engine entry point, never a disk write | each mutation changes engine behavior as itemized below; the unmutated bindings/codegen templates first reproduce the engine's default output (so L3 holds); no source file can change, because the mutations never touch disk |
| **L7** | `fixtures/artifact/n-1/legacy.json` (the N-1 artifact), migrated forward, then fed to the three `[MOD]` corpus specs | the migrated artifact parses all three with 0 errors and its plan byte-equals the default engine plan — the same output L3's goldens pin, detailed below |
| **governance** | an in-gate two-rule baseline — a locked `layer-restrictions` error rule + an unlocked `module-fragmentation` warning rule (no fixture) | `applyOverlay`/`overlayIsCompliant` rejects a spec-author overlay disabling the locked rule (it stays enabled, the attempt is recorded in the audit trail), judges a severity downgrade of it non-compliant, and lets the unlocked rule tune freely |
| **grammar** | live artifact `lang/keywords.json` | the grammar regenerates from it and compiles to WASM; every tag is wired — a parse rule and a highlight capture per tag id |

> The L0…L7 numbering is this table's, not the execution order — `verify.ts`
> runs L1 (the artifact meta-validator) before L0 (the determinism check); the
> rest run in listed order.

> This gate regenerates and diffs only the two artifacts above. The artifact
> schema, canonical-shape docs, and codegen-template mirror are also
> regenerable, but none of the three is touched or byte-diffed here — L3/L6/L7
> exercise the live codegen templates the mirror copies, never the mirror file
> itself, so the mirror's consistency with its source is checked only
> indirectly. That catalogue and its generating scripts are
> [00-overview](00-overview.md)'s and
> [08-language-tooling/01](../08-language-tooling/01-lang-keywords-json-the-artifact.md)'s
> to track, not this gate's.

L6's five mutations, each proving the artifact — not the code — is in charge:

| Facet | What's mutated | Expected behavior change |
| --- | --- | --- |
| binding | `<name>`'s `stripSuffix` dropped | `module-billing`'s DTO file paths gain a `-dto` segment |
| codegen-template | a marker prepended to the `adapter-smk-test` template | the marker appears in the generated smoke test |
| parse-recognition | `[CONS]` added as a `[NEW]` tag synonym | an inline snippet's unknown `[CONS]` literal parses instead of erroring |
| lint-policy | `module-isolation` flipped to warning; `no-relative-import` (the artifact/lint-policy name for the engine rule surfaced as `import-aliases`) disabled | both changes are visible in an in-process lint-config run over `projects/dirty` |
| UI-data-path | the binding edit above, replayed through the Studio's registry-driven `generate` (the call `/api/generate` makes) | the Studio's output changes the same way the engine's does |

The lint-policy facet calls the artifact-consuming lint-config engine
directly, in-process — the same entry point `rune sync`/`manifest --artifact`
drive, never `rune lint`. The CLI's `lint --json` still runs its 27
hardcoded rules and doesn't yet honor artifact-supplied lint instances; that
rule-registration swap is tracked as built-but-not-yet-wired in
[08-language-tooling/01](../08-language-tooling/01-lang-keywords-json-the-artifact.md).
The lint-config engine path this facet exercises already honors
artifact-supplied instances end to end — the L6 property — so the mutation
is observable today at the engine layer without waiting on that swap.

The gate also snapshots `git diff --name-only -- src/` before and after all
five mutations, scoped to the engine's current home under `src/` (the
pre-reorg `src/shape-checker` pathspec is retired) — a tripwire that can
actually fire, unlike a pathspec matching nothing at HEAD. The in-memory
`structuredClone` mechanism remains the operative no-code-change guarantee
either way; the `src/`-scoped diff is confirmation on top of it.

> "Byte-equals the default engine plan" means `planManifest` fed the migrated
> bindings + codegen templates must produce the exact plan the unmigrated
> engine's defaults produce — not merely a plan with zero errors. The N-1
> fixture is first proven genuinely older: the gate also asserts the current
> contract rejects `legacy.json` before migrating it forward.

**A golden-recapture walkthrough**, worked end to end: editing the engine's
`adapter-smk-test` codegen template to add a boilerplate header line, then
running `deno task verify --gate L3`, fails — the template is shared across
every module, so `verify.ts` prints a `manifest/<spec>: differs from golden`
line against `golden/manifest/*.json` for each affected corpus spec (a status
line only — the goldens still hold the old content, and no fresh output
exists yet to diff). Running `deno task verify --update-goldens` recaptures:
it rewrites the affected `golden/manifest/*.json` files and prints
`goldens updated — review the diff before committing`. Only now does a
content diff exist to inspect: running `git diff` over the regenerated golden
files shows only the added header line, module by module — the intended
change, nothing incidental. Re-running `deno task verify --gate L3` is green.
The load-bearing step is that `git diff`, reviewed before committing — skip
it and an unreviewed regression ships as a golden, which is exactly the
failure mode `--update-goldens` being explicit (rather than automatic)
guards against.

`deno task verify` chains the drift guards ahead of the ladder as
`check:lockstep && check:spec-refs && check:agent-guardrail && scripts/verify.ts`
— shell `&&`, so a failing drift guard stops the chain before `verify.ts` ever
runs. Once `verify.ts` starts, though, it runs every gate in the table above
regardless of earlier failures, prints a pass/fail line per gate, and only
then exits: `0` if none failed, `1` if any did. So the ladder's own gates
never bail on each other — only a drift-guard failure short-circuits, and it
does so upstream of the ladder entirely. `deno task verify` as a whole is
green iff all three drift guards and every gate above exit green; what
invokes this task, and when, is [Known state](06-known-state.md)'s to say.

