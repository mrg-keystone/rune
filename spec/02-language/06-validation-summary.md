## Validation summary

`rune check` / `rune sync` (the TS engine, `planManifest`) and the Rust LSP do
**not** enforce the same diagnostics — the LSP is stricter. The TS engine
enforces structure and semantics (what the generator needs to emit correct
code); the LSP additionally enforces the *shape* rules — `Dto` suffix, required
descriptions, in/out-DTO, boundary type-safety, uniqueness, line length,
indentation — that `rune check`/`rune sync` let pass (they exit 0 on all of
them). Do not assume a `check`-clean spec is LSP-clean; editing in the LSP
catches far more than a bare `rune check` (see [03-cli.md](../03-cli/00-overview.md)).
A third, non-interactive surface, `rune-syntax validate` (the CLI the `rune`
command shells out to), sits alongside these two: narrower than either, it
still catches parse errors and the 80-column limit, so both are enforceable
in CI without an editor open — see the full three-surface check × surface
matrix in
[08-language-tooling/03 § Diagnostics: check × surface](../08-language-tooling/03-the-rust-workspace-lang-parser-lsp-cli.md#diagnostics-check--surface)
for exactly which surface catches which check. The load-bearing categories
from `lang/docs/constraints.md`:

**Enforced by `rune check` / `rune sync` (the TS engine; the LSP mirrors these):**

- **Structure / parse** — every line must be a **known/recognized tag** (there
  is no tag-length rule — an unrecognized bracket tag, even a 3-letter one like
  `[XYZ]`, errors as an unrecognized line), `.`/`::` separators (though a
  dot-less camelCase `verbNoun` signature also parses — see the dot-less
  camelCase signature rule in
  [03-requirements-and-steps.md](03-requirements-and-steps.md) — so a
  separator is not strictly required), fault format, and other malformed-line
  errors.
- **Types** — `[TYP]` modifier validation (unknown modifier, wrong base
  primitive, missing numeric value, bad `from=` source); a known
  string/number modifier applied to a field of the wrong type
  (`[TYP:uuid] x: number`) is the same hard error class. Duplicate
  `[TYP]`/`[DTO]` names are errors. A property token that resolves under
  **both** DTO-property naming rules at once — a declared `[TYP] address`
  and an `AddressDto` both present, so property `address` could mean either
  — is also a hard `rune check`/`rune sync` error (`property 'address' is
  ambiguous between [TYP] address and AddressDto` — rename one; see
  [04-types-dtos-and-constraint-modifiers.md](04-types-dtos-and-constraint-modifiers.md)),
  the same severity class as the duplicate-name error above. A DTO property
  that matches **neither** rule — no declared `[TYP]`/`[DTO]` of that name at
  all — is a different case and is **not** rejected here: it is a deliberate
  escape hatch, the property reaches generation typed `unknown` under
  `@Allow()` with a `// TODO: tighten` marker (see
  [04-codegen/05-validation-swagger-details-worth-knowing.md](../04-codegen/05-validation-swagger-details-worth-knowing.md)).
  That undeclared-name pass-through is a documented gap, not an LSP shape
  rule either — but the ambiguous-collision and duplicate-name cases above
  are hard TS-engine errors, not gaps.
- **Services** — presence of the `@docs <url>` line on every `[SRV]` (a hard
  parse error if missing — distinct from the one-line *description*, which is
  LSP-only; see Types/DTOs below) and strict service resolution (a `service:`
  boundary prefix must name a declared `[SRV]`).
- **Entrypoints** — valid verb, body-`[REQ]` dispatch resolution,
  ambiguous-signature dispatch, `[PLY]`-requires-`[CSE]`, HTTP-vs-WS surface
  exclusivity, and WS topic rules (malformed header/topic, zero-topic socket —
  see WebSocket entrypoints). The `[ENT]` bracket modifier itself is never
  validated (flow names are free-form — see the Process flows and derivation
  section in [05-entrypoints-ent.md](05-entrypoints-ent.md)).
- `[REQ]` takes no modifier.

**Enforced by the Rust LSP (`rune check`/`rune sync` exit 0 on these; one of
them, line length, is also caught by the non-interactive `rune-syntax
validate` CLI — see the cross-referenced matrix above):**

- **Line length** — the 80-column limit (`main.rs:167`); this rule is not
  LSP-only — `rune-syntax validate` catches it too, so it's enforceable in
  CI without an editor open.
- **Indentation** — REQ 0 / steps 4 / faults 6 / PLY 4 / CSE 8 / case faults 10
  / descriptions 4. Two indented forms carry no checked depth: an `[ENT]`
  body `[REQ]` line and `[ENT:ws]` topic lines (any indent ≥ 1 parses; 4 is
  the convention).
- **Types/DTOs** — the `Dto` suffix (`main.rs:490`), a required 4-space
  description on every `[DTO]` (`main.rs:643`; a `[TYP]` description is
  conventional, not required), a required one-line *description* on every
  `[SRV]` (mirroring `[DTO]`'s — this is separate from the `@docs <url>` line,
  whose presence is a hard parse error enforced by the TS engine, above), and
  no duplicate `[REQ]` declaration (a
  repeated `noun.verb` `[REQ]` header errors as `Duplicate REQ`,
  `main.rs:387`; repeated *calls* to the same `noun.verb` are fine as long as
  the signature stays identical — see the identical-signature rule in
  [04-types-dtos-and-constraint-modifiers.md](04-types-dtos-and-constraint-modifiers.md)).
- **DTO in/out** — a `[REQ]` (`main.rs:391`) and an `[ENT]` (`main.rs:341`)
  input and output must each be a DTO. The escape hatch is **input-only**: any
  input starting with `{` — inline shapes and the empty `{}` — passes, so only
  a bare non-`Dto` input name is flagged (see
  [03-requirements-and-steps.md](03-requirements-and-steps.md), whose `[REQ]`
  bullet documents inline/empty `{}` for input but requires output to be a
  DTO with no such exception). Output carries no inline-shape escape — an
  inline `{...}` output, or any bare non-`Dto` output name, is flagged.
- **Boundary type-safety** — a boundary-call parameter must be a DTO or a
  boundary-safe primitive (`main.rs:438`).

**Enforced by neither engine (documented only):**

- **Scope rules** (instance nouns in scope, plain non-`Dto` params from scope
  or REQ input, step return types and `[NEW]` names resolving to declared
  types/nouns, the last step returning the REQ's output DTO, a `[RET]` value
  being in scope) are **documented but enforced by neither engine** — both
  deliberately skip them; see the design note at `lang/lsp/src/main.rs:102-104`
  for the LSP's rationale, and `lang/docs/constraints.md` for the full list.

