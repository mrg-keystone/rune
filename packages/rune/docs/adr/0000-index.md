# Architecture Decision Records

These ADRs record the P0 decisions for the Rune Studio rebuild (see
`rune/new/studio/instructions.md`, `plan.md`, `gaps.md`). They are **made**, not
open questions; downstream work orders execute against them.

| ADR | Decision | Gap |
| --- | --- | --- |
| [0001](./0001-one-engine.md) | D1 — One engine: shape-checker (TS) is the sole artifact-driven engine; Rust retired from generation, LSP-only. | G7 |
| [0002](./0002-audience.md) | D0 — Audience: spec-author mode is the default surface; language-design is a separate admin/expert mode. | G11 |
| [0003](./0003-parser-of-record.md) | D2 — Parser of record: the engine parses with a TS parser generated from the artifact's tag table; tree-sitter is editor-only. | G6 |
| [0004](./0004-lint-model.md) | D3 — Lint model: declarative rule DSL for the reducible rules + a typed code escape-hatch; all rules register through one interface. | G3 |
| [0005](./0005-layout-source.md) | D4 — Layout: codegen path templates are canonical; `canonical-paths.json` is generated from them. | G5 |
| [0006](./0006-versioning.md) | D5 — Versioning: artifact carries `schemaVersion` (semver); ship migrations; stamp generated output. | G8 |
| [0007](./0007-governance.md) | D6 — Governance: locked org baseline + project overlay; provenance on every change. | G12 |
| [0008](./0008-axes.md) | D7 — Axes: target-independent `language` is separate from N selectable per-target `codegen` profiles. | G13 |
</content>
