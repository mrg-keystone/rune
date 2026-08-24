# The `.rune` Spec Language

> Part of the [project spec series](../README.md). Sources of truth: `lang/docs/spec.md`
> (syntax), `lang/docs/constraints.md` (enforced rules), `lang/keywords.json` (the
> machine-readable language artifact — see [08-language-tooling.md](../08-language-tooling/00-overview.md)).

A `.rune` file is a small, indentation-significant spec describing **one backend
module**: its externally triggered features, the steps they take, the seams they
cross, the data contracts they exchange, and the ways each step can fail. The
engine (`rune sync`) generates a typed, validated TypeScript tree from it —
the spec is the source of truth; generated structure is never hand-edited.

The founding idea (from `lang/README.md`): *"Constrain what LLMs build. Get
exactly what you need."* Faults imply test cases; DTOs imply validation; steps
imply the file layout. An LLM (or a human) implements exactly what the spec
declares — no more, no less.

