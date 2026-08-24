# Testing & Verification

> Part of the [project spec series](../README.md). The oracle is `fixtures/` +
> `deno task verify`; the acceptance suites are `e2e/`; each layer also has
> its own unit suites.

`deno task verify` is the runnable front door, not `scripts/verify.ts` alone:
it runs the three drift guards, then `verify.ts`'s gate ladder, and "green"
means all of them exit green — the drift guards included
([drift guards](05-drift-guards-the-other-half-of-testing.md),
[the verify ladder](01-the-verify-ladder-deno-task-verify.md)). "Green" is
established by machine, not by claim.

The pinning mechanisms behind that bar:

- **Drift-gating** — byte-for-byte diff against regeneration. Pins the
  grammar + highlights. Detailed in
  [the verify ladder](01-the-verify-ladder-deno-task-verify.md)'s Drift row.
- **Goldens** — a captured baseline compared against fresh output. Pins
  parse, codegen, and lint behavior (L2–L4). Detailed in
  [the verify ladder](01-the-verify-ladder-deno-task-verify.md).
- **Live-vs-live** — live output checked against live output, used where
  there is no golden to pin (L5, Studio-vs-engine parity). Detailed in
  [the verify ladder](01-the-verify-ladder-deno-task-verify.md).
- **Regenerable but ungated** — a few derived artifacts are produced by
  script but never byte-diffed against their source. The owning catalogue is
  [08-language-tooling/01](../08-language-tooling/01-lang-keywords-json-the-artifact.md);
  the three known today are `lang/artifact.schema.json` (←
  `scripts/gen-artifact-schema.ts`), the codegen-template mirror in
  `lang/keywords.json` (← `scripts/gen-codegen-templates.ts`), and
  `docs/canonical-shape.md` (generated from `keywords.json`'s
  `canonicalPaths`).

The section's content lives in its sibling files:

- [The verify ladder](01-the-verify-ladder-deno-task-verify.md) — read this
  for the gate-by-gate table `deno task verify` runs: Drift, corpus, L0–L7,
  governance, grammar.
- [The fixture corpus](02-the-fixture-corpus-fixtures.md) — read this for
  what lives under `fixtures/` and which gate each directory feeds.
- [Acceptance suites](03-acceptance-suites-e2e.md) — read this for the two
  `e2e/` suites and their in-process/browser stages.
- [Per-layer suites](04-per-layer-suites.md) — read this for the per-layer
  unit-suite commands, engine through Rust.
- [Drift guards](05-drift-guards-the-other-half-of-testing.md) — read this
  for the three guards `deno task verify` runs ahead of the ladder, and the
  unwired git-hooks path (a `.githooks/` not present in the tree).
- [Known state](06-known-state.md) — read this for what's actually green
  today, the legacy unit failures, and the manual-only enforcement surface.

