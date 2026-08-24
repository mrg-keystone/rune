# History, Decisions, and Roadmap

> Part of the [project spec series](../README.md). Sources: `docs/adr/`,
> `docs/REBUILD-PROGRESS.md`, `todos/`, `upgrades.md`, `maybe/`, `feedback/`,
> and the historical `docs/phase2-*.md` planning docs.

Sections [00](../00-overview/00-overview.md) through
[11](../11-release-and-distribution/00-overview.md) of this spec say what rune
**is** — the current design, contracts, and behavior. This section says what's
**actually true, decided, and next**: it's the reconciliation ledger, giving
every feature named elsewhere in the spec a status — working-and-gated,
wired-but-dormant, removed, known-drift, open-follow-ups, or
strategic-direction. Each subsystem's own owning section (04-codegen,
06-runtime, 05-linter, and so on) is authoritative for its own status;
[Current state, summarized](07-current-state-summarized.md) is the derived
cross-subsystem dashboard that summarizes them, refreshed by re-reading the
owning sections. Where 07 and an owning section disagree, re-sync 07 from the
owner — the owner wins. This overview delegates status detail to 07 rather
than repeating it.

The section's content lives in its sibling files:

- [Architecture Decision Records](01-architecture-decision-records-docs-adr.md)
  — read this for why rune is shaped as it is: the eight made decisions from
  the Rune Studio rebuild's P0.
- [The rebuild](02-the-rebuild-docs-rebuild-progress-md.md) — read this for
  how the engine got from hand-wired to artifact-driven across seven gated
  work orders, and the scoped follow-ups still open.
- [The DX roadmap](03-the-dx-roadmap-todos-complete.md) — read this for the
  completed seven-task, agent-dispatchable plan, from generated isolation
  seeds through the docs/skill/release sweep.
- [The diamond](04-the-diamond-upgrades-md-the-strategic-direction.md) — read
  this for the strategic direction: merging the sprig and rune pipelines into
  one contract at the waist.
- [Parked proposals](05-parked-proposals-maybe.md) — read this for drafts
  considered and set aside, with why.
- [Field feedback](06-field-feedback-feedback-feedback-md.md) — read this for
  what rebuilding a real product through the full diamond drove, and what's
  still open from it.
- [Current state, summarized](07-current-state-summarized.md) — read this for
  the derived dashboard: what's working and gated, wired but dormant,
  removed (the auth-agnostic cutover — the full removed-model inventory lives
  in [06-runtime's overview](../06-runtime/00-overview.md), not a dedicated
  history entry), known drift, open follow-ups, or strategic direction.

**What's next:** the open work is scattered across three siblings — the
rebuild's [scoped follow-ups](02-the-rebuild-docs-rebuild-progress-md.md)
(parser structural dispatch, `rune-sig` templating, Studio island previews,
the profiles UI, the nested-`[PLY]` gap), the diamond's [strategic
direction](04-the-diamond-upgrades-md-the-strategic-direction.md) (executing
the waist rule and both bridges further, now that they live in the skills),
and field feedback's [still-open items](06-field-feedback-feedback-feedback-md.md)
(typed array/object DTO fields, parse status on the dispatch wire). Current
state's Open-follow-ups and Strategic-direction bullets are one-line pointers
back to 02 and 04 respectively, not separate content. Read all three for the
full forward-looking picture — none is exhaustive alone.

