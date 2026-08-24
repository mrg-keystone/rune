## `--strict`

`--strict` is the CI/ship gate: it's what a pipeline runs before it lets a
module count as done. It layers exactly one extra promise on top of a plain
`rune lint` — no heal-rules entry is still sitting un-enriched — and reports
nothing a plain lint didn't already report otherwise.

`--strict` sets `RUNE_LINT_STRICT=1`, which strict-gated rules read — the
`RUNE_STRICT` env var is honored as an alias, so either variable enables
strict mode (full reference:
[13-environment-variables.md § rune CLI & engine](../13-environment-variables/03-rune-cli-engine.md)).
Rule bodies stay flag-free: strictness is read from the environment, never
threaded through as an argument, so it composes identically no matter how
lint is invoked — a `--json` run reads the same env var and runs the exact
same strict-gated rule body as a text run, so strict findings appear in
`--json` output exactly as any other finding does. `--strict` changes which
findings exist, never the output shape or the exit-code rule: exit 1 if any
rule — strict-gated or not — reports a violation, 0 clean, same as a plain
lint.

Currently the only strict-gated rule is `rune-heal-todo`: silent in a plain
lint, but under `--strict` it fails on any `heal-rules.json` entry still
carrying `todo: true`. That's the entire predicate — `todo: true`, and
nothing else: an entry with `todo: false` and an empty or dubious `fixes`
list still passes, because fix-content quality is a hand-review concern, not
something the gate adjudicates. Which of an entry's states
(fresh/enriched/stale/orphan) block `--strict` and which don't is
[04-codegen.md § heal rules § Entry lifecycle](../04-codegen/04-heal-rules.md)'s
table to own; this gate is the `rune-build-linter` agent's closing job
([09-claude-skills.md](../09-claude-skills/00-overview.md)).

**Resolution is independent of the walk.** `rune-heal-todo` doesn't key on a
copy of `heal-rules.json` the lint walk happens to reach; it resolves the
file from its known location via project-root resolution — the same
mechanism the rune-derived rule family uses to find `spec/runes/`
([01-rule-families.md § Rune-derived rules](01-rule-families.md)) —
independent of wherever the walk itself is rooted. In the canonical
composed layout the walk roots at `server/`
([00-overview.md](00-overview.md)), while `heal-rules.json` scaffolds to
`<git>/spec/misc/heal-rules.json`
([04-codegen.md § heal rules § Location](../04-codegen/04-heal-rules.md));
project-root resolution reaches that file regardless of the walk's root, so
the gate is live: a `todo: true` entry does fail `--strict`, and a clean
`--strict` run really does mean no entry is still un-enriched. `04-codegen.md`
§ heal rules owns both the resolution mechanism and which of an entry's
states block the gate
([04-codegen.md § heal rules § Entry lifecycle](../04-codegen/04-heal-rules.md)).
`--module <name>` narrows independent of all this — it keeps only findings
whose path starts with `src/<name>/`, and `heal-rules.json` never lands
under `src/<name>/`, so `rune-heal-todo` can never surface in a
`--module`-scoped run; only a whole-tree `--strict` run ever reports it.

