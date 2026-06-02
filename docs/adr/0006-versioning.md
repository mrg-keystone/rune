# ADR 0006 — Versioning: semver the artifact, ship migrations (D5)

Status: **Accepted** · Closes the decision behind G8

## Context

There is no artifact contract, no meta-validation, and no versioning. If users
can change the language, specs written against v1 break under v2 with no version
stamp and no migration path for existing `.rune` files or generated code.

## Decision

The artifact carries a top-level **`schemaVersion` (semver)**. We **ship
migrations** between versions and **stamp generated output** with the version
that produced it. The engine refuses to interpret an artifact whose version it
cannot handle.

## Consequences

- WO-3 puts `schemaVersion` in `artifact.schema.json` and the meta-validator
  checks it.
- WO-7 implements the version-bump + migration UX and runs migrations over
  existing specs (gate L7: N-1 specs migrate and still parse/generate under N).
- Generated trees record their producing version, enabling drift/upgrade audits.
</content>
