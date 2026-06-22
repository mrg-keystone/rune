# ADR 0002 — Audience: spec authors by default, language design as admin (D0)

Status: **Accepted** · Closes the framing behind G11

## Context

"Low-code users can edit the Rune language" conflates three roles: **language
designers** (edit tags, indent, `follows`, codegen templates, lint rules — expert
work; a bad rule silently breaks every spec), **spec authors** (write `.rune`
files against a *fixed* language — the genuinely low-code, day-to-day activity),
and **body-fillers** (write implementations — out of scope). Today the Studio
mixes a spec editor and a live language-registry editor on one page, exposing
expert-only controls to everyone. "Low-code" here means "no recompile," **not**
"no expertise."

## Decision

**Spec-author mode is the default surface.** Language-design (editing the
artifact's `language`/`lint`/`codegen`) is a **separate admin/expert mode**, not
the landing page. Build both; do not show the registry editor to spec authors.

## Consequences

- WO-7 separates the two modes in the UI and gates language-design behind the
  admin surface.
- Combined with governance (ADR 0007), a spec author provably cannot weaken a
  locked rule.
- The default product story is "author specs against a curated, enforced
  language"; mutating the language is the privileged path.
</content>
