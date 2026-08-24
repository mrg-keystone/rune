## Governance (built, not yet wired)

Three subsystems are implemented and tested but **not yet reachable from the
CLI** — forward-looking infrastructure for the fully artifact-driven engine:

| Subsystem | Code path | ADR | What it does | What exercises it |
| --- | --- | --- | --- | --- |
| Governance | `src/rune/domain/business/governance/` | [ADR 0007](../12-history-and-roadmap/01-architecture-decision-records-docs-adr.md) | A **locked org baseline + project overlay** with provenance on every change ("a linter you can edit to pass is not a linter") | the `governance` gate |
| Migrations | `src/rune/domain/business/migrate/` | [ADR 0006](../12-history-and-roadmap/01-architecture-decision-records-docs-adr.md) | Artifact `schemaVersion` migrations | the `L7` gate |
| Lint-config | `src/rune/domain/business/lint-config/` | [ADR 0004](../12-history-and-roadmap/01-architecture-decision-records-docs-adr.md) | Artifact-driven rule instances | the `L6` gate's lint-policy mutation |

The gap is a specific wiring seam, not a blanket "not yet": the pipeline
([00-overview.md](00-overview.md)) runs its 27 rules hard-coded from
`src/rune/mod-root.ts`, and ADR 0004 promises "one registration interface"
in that spot. "Reachable from the CLI" concretely means the CLI/pipeline
instantiating its rule set from the artifact through that interface, in
place of the fixed `mod-root.ts` set — only once that swap lands do
governance's overlay and lint-config's artifact-driven instances take effect
on a real lint run.

The cutover from the hard-coded `mod-root.ts` set to artifact-driven
registration is an unconditional replacement, not a flag or config field:
once the registration interface ships, the CLI/pipeline instantiates its
rule set from the artifact through it, full stop. A project with no overlay
sees identical behavior to today's 27 hard-coded rules, so no flag is
needed to preserve current behavior during the transition.

This file owns the built-but-dormant detail for governance, migrations, and
lint-config; [Current state, summarized](../12-history-and-roadmap/07-current-state-summarized.md)
summarizes this status on its "Wired but dormant" line.
