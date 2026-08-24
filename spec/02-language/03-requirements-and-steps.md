## Requirements and steps

- `[REQ] noun.verb(InputDto): OutputDto` at column 0. Input must be a DTO (or
  inline `{prop:type, ...}`, empty `{}` included — the DTO-input check passes
  anything starting with `{`), output must be a DTO, and by convention the
  **last step returns the REQ's output DTO**. Like the scope rules, that
  last-step rule is documented, not enforced: no tool diagnoses a mismatch
  (the LSP carries a parity test asserting a non-matching last step is NOT
  flagged), and codegen derives the coordinator's result from the seam types —
  any step producing the output DTO — not from the last line, so a final
  `[RET]` is never checked against the output either. One `[REQ]` per feature;
  it represents the happy path (and implies its `int.test.ts` — the
  integration/happy-path test; the e2e test is `[ENT]`-derived, not
  `[REQ]`-derived, per [04-codegen.md](../04-codegen/00-overview.md)).
- Steps are indented 4 spaces, `noun.verb(args): return-type`. Each step's
  return value enters scope for later steps. The parser of record also accepts
  a boundary step with **no return clause** at all (`service:noun.verb(args)`,
  no `: type`) — a lenient parse: such a step is a **send**, an awaited call
  like any other (errors propagate), with nothing bound from it (see
  [04-codegen.md](../04-codegen/00-overview.md)). "No blank lines between steps" is
  convention only: the parser of record ignores blank lines inside a `[REQ]`
  (they close nothing — following steps still attach) and no tool emits a
  diagnostic for them. Between requirements a double blank line is the
  documented convention — warning-level at most, never an error (the example's
  single blanks parse clean). Lines are capped at 80 characters — enforced by
  the LSP only, not `rune check`/`rune sync` (see
  [06-validation-summary.md](06-validation-summary.md)).
- **A step signature may span multiple lines.** When a step's `(` is not closed
  on its own line the parser of record tracks paren depth and folds the
  following indented lines into the one signature until the parens balance
  (`os:storage.save(` / `id,` / `payload` / `): void` — two in-scope names
  folded across lines — is a single step). The
  closing line ends the step on depth alone, so a bare `)` terminator closes it
  even with the output omitted (the following top-level `[REQ]` is not
  swallowed). This is distinct from a multi-line `[DTO]` description below —
  here the continuation is the *signature* itself.
- **Arguments are names, not variable expressions.** A plain (non-`Dto`)
  argument references an in-scope value — a previous step's return or a field
  of the REQ's input DTO (`task.fill(title)` uses the input's `title`). An
  argument ending in `Dto` instead declares the **data contract at that call**;
  no such value need be in scope: the example's `db:task.save(TaskDto)` says
  the save crosses the seam as a `TaskDto`, and codegen sources that value
  from the validated request input when the name is the REQ's own input DTO,
  otherwise from a value the flow builds (the pure core returns it, asserted
  at the seam) — except a `: void` write's **primary param**: the first
  `Dto` param (else the first param) is always core-built or an earlier
  post-core step's result, never the request input, even when it names the
  REQ's own input DTO (the example's save consumes the core-built
  `TaskDto`). A **send** — a boundary step with no return clause at all,
  parsed leniently, binding nothing (errors still propagate) — has no
  primary param: every one of its `Dto` arguments resolves through the same
  table-resolution precedence as any other post-core param, so the
  request-input value can still supply it when the argument type-matches
  (full resolution precedence in
  [04-codegen.md](../04-codegen/00-overview.md)'s coordinator paragraph). The scope
  convention ("params from scope or REQ input") governs plain arguments only.
- **Instance vs static:** `noun.verb()` operates on an instance (`noun` must be
  in scope); `Noun::verb()` is a static/class-level call (no scope requirement).
  A noun enters scope via `[NEW]`, a step that returns it, or a **boundary read
  on that noun** — loading its data hydrates the instance: in the example's
  `task.complete`, `db:task.load(id): TaskDto` puts `task` in scope for
  `task.markDone()` (in generated code the loaded DTO feeds the pure core,
  where instance steps run — see [04-codegen.md](../04-codegen/00-overview.md)).
- **Dot-less camelCase signature.** A `[REQ]` or `[ENT]` signature may be
  written with no `.`/`::` separator as a single camelCase `verbNoun`: the
  parser of record splits it at the first interior uppercase letter into
  verb + noun and lowercases the noun's leading letter. For a `[REQ]` this is
  the primary form — the verb-part becomes the verb and the noun-part the
  noun, so `createOrder` parses exactly like `order.create` (an accepted
  alternative to the `noun.verb` instance form). An `[ENT]` signature is
  `surface.action`, not `noun.verb`: a dot-less `[ENT]` maps the noun-part to
  the **surface** and the verb-part to the **action** — so `getRecording`
  yields surface `recording`, action `get`. A bare name with no interior
  uppercase and no separator fails to parse.
- **`[NEW] class`** instantiates a domain class — no parens, no return type
  (the class itself is implied and enters scope). The name refers to a domain
  concept declared as `[TYP] ...: Class` or described by a `[NON]` noun (the
  example's `[NEW] task` is backed by `[NON] task`, and `task` then serves as
  step instance and return type). Like the scope rules below, that reference is
  documented convention, not an enforced diagnostic. Constructor details are
  deliberately unspecified: specs describe flow, not construction.
- **`[RET] value`** returns something already in scope — used when the final
  operation is a side effect (e.g. a `db:` save returning `void`). The value's
  in-scope-ness is not checked (a scope rule, documented-not-enforced), and a
  `[RET]` is accepted at any step position, not only the last line — only its
  step-level indentation is validated. Generated coordinators derive the
  returned value from the seam types; the `[RET]` line survives only in the
  recipe comment.
- **Faults** sit 2 spaces deeper than their step (6 normally, 10 inside poly
  cases): lowercase, hyphen-separated, space-separated on one line
  (`not-found timed-out invalid-id`). Fault names describe *why* something
  failed. **Each fault implies a test case; a step with no faults cannot fail.**

### Boundaries and `[SRV]` services

A step that crosses a system boundary is written with a single-colon **service
prefix**: `db:task.save(TaskDto): void`. There are no built-in boundary kinds —
`db:`, `fs:`, `ex:`, `os:` are just service names, and every prefix used must
be declared by a matching `[SRV]` block in the project's shared **core spec**:
`core.rune`, recognized at the root-relative `spec/runes/core.rune` (canonical —
the durable home of the core spec) or under the legacy layouts still resolved
for reading (in-tree `src/core/core.rune`, plural `specs/runes/core.rune`;
legacy flat `spec/core.rune` / `specs/core.rune`),
probed in that order: the first readable copy wins. All finalized locations
are probed before any draft; the `.in-prog.rune` variants of the same
locations follow, in the same order, so a finalized core anywhere (e.g.
`spec/runes/core.rune`) beats a draft anywhere (e.g.
`src/core/core.in-prog.rune`). An `[SRV]` in any other project spec is
the `rune-service-core-only` error; only a standalone spec outside a project
layout (docs examples, corpus fixtures) may carry a self-contained `[SRV]`:

```rune
[SRV] (SIDECAR)db: DB_URL
    the project's primary datastore
    @docs https://docs.example.com/db
```

- Format: `[SRV] (TRANSPORT)<service>: <ENV_VAR, ...>`. The `: <ENV_VAR, ...>`
  clause is optional for **every** transport — an env-var-less declaration
  (`[SRV] (SDK)stripe`, with its required description and `@docs` line per the
  next bullet) parses clean; nothing requires env vars per transport.
  Transport is a closed set: `SDK`, `HTTP`, `WEBSOCKET`, `SIDECAR`, `NATIVE`
  (`NATIVE` = in-process runtime/std-lib boundary — filesystem, subprocess,
  crypto, clock; faults map to synchronous throws; typically declared without
  env vars).
- A one-line description **and** an `@docs <url>` line are required. Missing
  `@docs` is a hard parse error enforced by both the TS engine and the LSP; a
  missing description is enforced by the LSP only, mirroring `[DTO]`'s
  required description (`rune check`/`rune sync` let it pass — see
  [06-validation-summary.md](06-validation-summary.md)). The URL
  surfaces as `@see` JSDoc on the generated adapter
  method.
- Boundary params/returns must be DTOs or one of the boundary-safe primitives
  (`string`, `number`, `boolean`, `void`, `Uint8Array`, `Primitive`) — the
  full primitive set also includes `Class`, which is never boundary-safe (see
  [04-types-dtos-and-constraint-modifiers.md](04-types-dtos-and-constraint-modifiers.md)).
  `Primitive` (`string | number | boolean`) is boundary-safe:
  every member of the union is itself a boundary-safe primitive, so it erases
  to that union at the seam. A named `[TYP]` that resolves to a boundary-safe
  primitive (including `Primitive`) counts — it erases to its primitive at the
  seam (the example's `db:task.load(id)` crosses as a `string`); a `[TYP]`
  that resolves to `Class`, or to a non-primitive body, never crosses a
  boundary.
- Each `[SRV]` generates a shared client at `src/core/data/<service>/mod.ts`;
  module-level per-noun adapters construct it.

### Polymorphism

```rune
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        [CSE] fiveNine
        ...
```

`[PLY]` at step level (4 spaces) opens the block; `[CSE]` cases at 8 spaces,
their steps at 8, their faults at 10. The block closes when indentation returns
to 4. Cases may differ in sub-steps but share the interface return type.
Generated layout: `base/` + `implementations/<case>/` + `poly-mod.ts` barrel
(see [04-codegen.md](../04-codegen/00-overview.md)). Known gap: a `[PLY]` nested inside a
`[CSE]` is spec-illegal, but the parser of record accepts it leniently — the
nested `[PLY]` restarts a top-level poly block under the `[REQ]`, dropping the
case nesting. That lenient parse is normative for now: the fixture lives in the
valid corpus and its parse golden captures it, so a rebuilt parser must
reproduce it; rejection is deferred to the artifact-driven parser/lint work
(`fixtures/README.md`).

