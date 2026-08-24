# Codegen — From Spec to Tree

> Part of the [project spec series](../README.md). This file is the
> orientation document for the `04-codegen` section: what codegen is, its
> through-line, and a map to the sibling files that own its mechanics.

Codegen is the shaping layer's transform from `.rune` spec text into a
generated module tree. `rune sync` walks the full through-line: **parse**
the spec into an AST, **validate** it end to end, **generate** per-element
source into `<root>/src/<module>/`, **reconcile and emit** against
whatever's already on disk (create, regenerate, prune), and finish at the
**run-all gate**, which boots keep alone and drives it live (see
[the run-all gate](06-the-run-all-gate.md)). `rune check` walks only the
parse and validate steps and performs zero writes; `rune manifest` runs the
same parse-and-validate front end but stops at a plan — spec text and the
existing file set in, a plan out, no I/O.

The principle threading all of it: generation never pretends the app works.
Every core body generates `throw new Error("not implemented")` — red by
design — every declared fault scaffolds a named test stub for the developer
to fill in, and sync's final act boots keep alone and drives every endpoint
live rather than trusting a clean build. A tree that "generates clean" but
has never actually run is not the goal; a tree that fails loudly in the
right, expected places — the untouched cores, live at boot — is.

The generator itself lives in
`src/rune/domain/business/rune-manifest/mod.ts` (`planManifest`) — **pure**:
spec text and the existing file set in, a plan out, no I/O. The equally pure
`rune-sync/mod.ts` extends that plan for the reconcile/emit step; the
entrypoints (`sync`, `manifest`, `check`) do all the I/O. The plan's shape,
prune gating, and create-once growth mechanics belong to
[the pipeline's reconcile-and-emit step](01-pipeline.md).

The section's content lives in its sibling files:

- [The pipeline](01-pipeline.md) — parse → validate → generate →
  reconcile/emit, spec text to generated tree end to end.
- [The contract artifact — `spec/contract/`](02-the-contract-artifact-spec-contract.md)
  — the offline OpenAPI document + typed-client build consumers use with no
  rune backend present.
- [Ghost stubs — the `[TYP:ext]` lifecycle](03-ghost-stubs-the-typ-ext-lifecycle.md)
  — stand-in endpoints for unfulfilled external inputs, and how they evaporate.
- [Heal rules](04-heal-rules.md) — the merge-owned `heal-rules.json` map from
  fault slugs to one-click fixes.
- [Validation & Swagger details worth knowing](05-validation-swagger-details-worth-knowing.md)
  — the class-validator/`@ApiProperty` rules generation applies.
- [The run-all gate](06-the-run-all-gate.md) — sync's final boot-and-drive
  verdict.

