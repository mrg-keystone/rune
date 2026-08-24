## What rune is

Rune builds a backend by **shaping** it instead of writing it. You describe a
module as a tiny `.rune` spec — its entrypoints, requirements (and the steps
and boundaries they take), and data contracts — and rune generates a typed,
validated, lint-clean TypeScript tree from it. That generated code runs on
**rune's runtime** (`@mrg-keystone/rune` on JSR): a Deno backend framework
that turns your modules into a routed, documented, self-verifying app.

**The spec is how you shape the thing; the runtime is the thing your shape runs
on.** You regenerate from the spec — you don't hand-edit the structure — and the
same spec carries you from "write it" to "watch it run green."

The founding motivation (from `lang/README.md`): *"Constrain what LLMs build.
Get exactly what you need."* LLMs hallucinate error handling, forget edge
cases, and invent APIs. A `.rune` spec is a format an LLM can follow precisely:
entrypoints, requirements, steps, boundaries, and data contracts are defined once; the
finished spec outlines acceptance criteria for unit, integration, and e2e
tests; the LLM (or a fleet
of them — see [09-claude-skills](../09-claude-skills/00-overview.md)) implements exactly
that — no more, no less.

