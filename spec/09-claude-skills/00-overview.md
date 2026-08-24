# Claude Integration — Skills, Agents, and the Pipeline

> Part of the [project spec series](../README.md). Source: `claude/skills/`
> (eight `rune:*` skills) and `claude/agents/` (15 pinned specialist agents),
> installed into `~/.claude/skills/` and `~/.claude/agents/` via
> `scripts/install.sh`, `deno task install`, or `rune update`. See
> [Distribution](03-distribution.md) for the install mechanics — the
> tarball/manifest fallback paths, the version-match caveat, and the
> no-`~/.claude`/no-`agent/` edge cases.

Rune treats Claude Code as a first-class user. Five of the eight skills form
a sequenced **spine** keyed to the project's lifecycle stages — scope, spec,
data, build, cake — one skill per rung of the 13-rung ladder below. Two more,
**rune:framework** and **rune:docs**, are on-demand **advisors**: invoked
outside that sequence to answer questions about a running surface, holding
no rung of their own. The eighth, **rune:diamond**, is the conductor: it
never performs a stage's work itself but sequences the spine (and the
sibling sprig repo's frontend stages) by walking the 13-rung ladder. The
skills encode the lifecycle's playbooks; the
agents are the isolated specialists the skills orchestrate. The premise
throughout: the spec constrains what LLMs build, and the toolchain (check,
lint --strict, the run-all gate, the cake) verifies it — the same
check → sync → lint → run-all → cake loop documented in
[the loop, end to end](../00-overview/04-the-loop-end-to-end.md),
[the CLI](../03-cli/00-overview.md), and [codegen](../04-codegen/00-overview.md).
The skills in this section are that loop's orchestrators, end to end.

The section's content lives in its sibling files:

- [The eight skills, in pipeline order](01-the-eight-skills-in-pipeline-order.md)
  — read this to see which skill owns which lifecycle stage, and the
  13-rung ladder rune:diamond walks to sequence them.
- [The agent fleet](02-the-agent-fleet-claude-agents.md) — read this for the
  fifteen specialists' pinned models and exhaustive per-agent tool grants.
- [Distribution](03-distribution.md) — read this for install mechanics: the
  tarball/manifest fallback path and the version-match caveat.
- [Drift guards](04-drift-guards.md) — read this for the two sync scripts
  that keep spec references and agent guardrails honest.

