# ADR 0004 — Lint model: declarative DSL + typed escape-hatch (D3)

Status: **Accepted** · Closes the decision behind G3

## Context

Today lint is a closed checker library *configured* by data, not *defined* by
it. `keywords.json`'s `lint` entries are parameter bags keyed to a fixed `type`
vocabulary whose logic is hardcoded (`lib/lint.ts` `GEN_CHECKERS[rule.type]`),
and again as 23 shape-checker rule modules. From the UI a user can toggle
`enabled`/`severity`/`params` but **cannot author a new check**. Some rules are
genuinely AST/graph-heavy (`layer-restrictions` ~95 L, `barrel-discipline`) and
won't reduce to data.

## Decision

A **declarative rule DSL** expresses the reducible rules as artifact data; a
**typed code escape-hatch** covers the AST-heavy ones. **All rules register
through one interface**, whether their body is declarative or coded. Changing a
rule's `severity`/`params` in the artifact changes a real `shape-checker .` run
with no recompile.

## Consequences

- WO-4d builds the DSL + escape-hatch and ports all 23 registered rules onto it;
  reducible rules become artifact data, AST-heavy ones keep code but register
  through the same interface (gate L4 + L6 for a severity mutation).
- No rule logic lives in two places (the L5 conformance gate enforces this once
  the Studio shares the engine).
- "Edit lint" is truly low-code for the reducible majority; the escape-hatch is
  an admin-mode, code-review-gated path.
</content>
