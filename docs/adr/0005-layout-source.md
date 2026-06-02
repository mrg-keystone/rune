# ADR 0005 — Layout source of truth: codegen templates (D4)

Status: **Accepted** · Closes the decision behind G5

## Context

The expected file shape lives in two places: `assets/canonical-paths.json`
(consumed by the `structure` rule and `rune-manifest`) **and** the codegen path
templates in the registry. They can drift. `MERGE.md` proposes the path
templates *become* the expected shape ("presence guaranteed by generation"), but
canonical-paths also encodes `$forbiddenDirNames`, `$looseFileNames`, and
optional-file (`?`) semantics that must not be lost.

## Decision

**Codegen path templates are canonical.** `canonical-paths.json` is **generated
from them**, preserving `$forbiddenDirNames` / `$looseFileNames` / optional-`?`
semantics. There is one layout source; the structure rule consumes a generated
artifact, not a hand-maintained parallel file.

## Consequences

- WO-4b makes the codegen templates the layout source and generates
  canonical-paths from them; the Drift gate proves the generated file is not
  hand-edited.
- Presence checks (`rune-*-presence`) are largely subsumed by generation: a
  construct's templates *are* its expected files.
- The `$`-prefixed semantics are encoded in the template/artifact model, not
  lost in the collapse.
</content>
