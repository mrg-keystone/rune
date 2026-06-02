# ADR 0007 — Governance: locked baseline + project overlay (D6)

Status: **Accepted** · Closes the decision behind G12

## Context

shape-checker's value is that it **enforces invariants**. If lint rules, layout,
and codegen are freely user-editable, a user can weaken or disable the very
guardrails that make output trustworthy. There is today no notion of
core/locked vs tunable rules, no ownership, no team-level governance, and no
audit of who changed the language. "A linter you can edit to make yourself pass
is not a linter."

## Decision

A **locked org-owned baseline** sits under a **project-level overlay**. Rules and
layout are marked org-locked vs project-tunable; a project may only tune what the
baseline permits and **cannot weaken a locked rule**. Every artifact change
records **provenance/author**, surfaced as an audit trail.

## Consequences

- WO-3's artifact model carries lock/ownership metadata; WO-7 implements the
  overlay, provenance, and audit UI.
- Gate (WO-7): a spec author provably cannot weaken a locked rule.
- Combined with ADR 0002, language-design authority is both mode-gated (admin)
  and policy-gated (locked baseline).
</content>
