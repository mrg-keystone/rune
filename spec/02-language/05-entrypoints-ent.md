## Entrypoints (`[ENT]`)

`[ENT] surface.action(InputDto): OutputDto` declares an inbound surface — the
inverse of a boundary call. **It is the only source of an HTTP surface**: a
module with `[REQ]`s but no `[ENT]` is a pure library module — no controller,
no route, no OpenAPI doc, no cake rows. Each `[ENT]` dispatches to the `[REQ]`
matched by its `(input, output)` signature — textual equality of the pair, so
named DTOs match by name and an inline `{...}` (or empty `{}`) input matches
only a `[REQ]` whose input reads identically; there is no structural
comparison. When two `[REQ]`s share the signature the dispatch is ambiguous
(an error) unless the `[ENT]` names its target explicitly with one indented
`[REQ]` body line restating the target's full signature:

```rune
[ENT] http.postRecording(GetRecordingDto): IdDto
    [REQ] recording.set(GetRecordingDto): IdDto
```

The body line follows the same `[REQ] noun.verb(input): output` grammar as any
top-level `[REQ]` (the signature is not optional syntax — a bare
`[REQ] recording.set` with no `(input): output` fails to parse), but only its
`noun.verb` resolves the dispatch: the restated `(input, output)` is not
checked against the target `[REQ]`'s actual signature, so a mismatched
restatement is not diagnosed and does not affect which `[REQ]` is wired — it
is documentation, not a constraint. The parser of record accepts the line at
any indent ≥ 1 (4 spaces is the convention — no depth is checked), it takes no
modifier (a `[REQ:x]` body line is an error), and naming a `[REQ]` the file
doesn't define is an error. Zero matches is not an error: the handler is
generated unwired ("No coordinator wired"), throwing `not implemented` and
naming the coordinator file to create.

- Default: `POST` at an auto-derived route — the kebab-cased action under the
  kebab-cased surface (`http.getTask` → `POST /http/get-task`), plus one
  `/:field` segment per `from=path` input field in DTO declaration order and a
  trailing catch-all for a `from=path*` field. An optional clause between name
  and parens overrides verb and/or route:
  `[ENT] http.getTask @ GET /tasks/{id}(TaskRefDto): TaskDto`. Verbs are
  limited to `GET/POST/PUT/PATCH/DELETE`; `@ METHOD` alone overrides only the
  verb (route still auto-derived). An explicit `/template` replaces the derived
  sub-path (still mounted under the surface prefix): its `{field}` segments
  (and one trailing `{field*}` catch-all) bind URL parts to same-named
  input-DTO fields and are the sole source of path bindings — `from=path`
  appending never applies to a templated route (`from=query`/`header` still
  compose). No diagnostic checks a template's `{field}` names against the
  input DTO: a segment naming no field still becomes a route param and a
  recorded path source, but it binds nothing — the URL value reaches no DTO
  field. The converse gap binds nothing either: a `from=path` field the
  template does not name keeps its recorded `path` source (template sources
  merely overlay the field-declared ones) but gets no route segment, so no
  URL part exists to bind it — it stays unbound rather than falling back to
  the body.
- **The verb is contract, not styling** (the "waist rule" — see
  [12-history-and-roadmap.md](../12-history-and-roadmap/00-overview.md)): reads are `GET`
  queries returning current-state DTOs; writes stay `POST` command verbs. Never
  an "edit-this-record" endpoint. This is a documented convention, not a
  diagnosed rule: `rune check`/`rune sync` and the LSP validate only that the
  verb token itself is one of `GET/POST/PUT/PATCH/DELETE` (see
  [06-validation-summary.md](06-validation-summary.md)) — neither engine flags
  a write wired to `PUT`/`PATCH`/`DELETE` or a read wired to `POST`. `PUT`,
  `PATCH`, and `DELETE` stay grammar-legal, but only as an escape hatch for an
  `[ENT]` that must mirror a fixed external REST contract verb-for-verb — never
  as a second command style. Every ordinary write-command endpoint still uses
  `POST`.
- Empty input `({})` generates a no-argument handler.

### Process flows and derivation

A module's HTTP `[ENT]`s form a *process* that the **cake** — keep's
interactive per-module docs page (`/docs/<module>`), a guided walk of the
endpoints in process order — and the headless runner walk (see
[07-cake.md](../07-cake/00-overview.md)). `[ENT:ws]` topics sit outside this
process entirely — see WebSocket entrypoints, below.
Each `[ENT]` carries four pieces of process metadata: `order`, `dependsOn`,
`bind`, and `flows`. `order` is plain declaration order and `flows` is read
straight off the endpoint's own flow modifier — neither is derived from
anything else; `dependsOn` and `bind` are **derived from the DTO field
graph** — no wiring is written by hand:

- `order` is a `number`: each `[ENT]`'s ascending position among the module's
  endpoints, assigned once in file declaration order — flow-tagged and
  untagged endpoints numbered together in one module-wide sequence, never one
  sequence per flow, and never one sequence per surface: a module whose
  `[ENT]`s span more than one surface still gets a single ascending sequence
  over every surface's endpoints together, in file order, not a sequence
  restarted at each surface. It is the same declaration order that the
  `dependsOn`/`bind` earliest-producer-wins race below reads; the cake and the
  headless runner walk a selected flow by filtering this one `order` down to
  that flow's endpoints, never renumbering it (runtime shape: `number`,
  documented in
  [02-endpoint-endpointcontroller.md](../06-runtime/02-endpoint-endpointcontroller.md)).
  Codegen emits one controller per `[ENT]` surface (see
  [04-codegen.md](../04-codegen/00-overview.md)), so a multi-surface module's
  controllers each carry only a slice of this one module-wide sequence — the
  registration index a hand-authored `order` falls back to is scoped per
  controller (see
  [02-endpoint-endpointcontroller.md](../06-runtime/02-endpoint-endpointcontroller.md)),
  and that per-controller index is **not** the same numbering as this
  module-wide derivation once a module declares more than one surface;
  reconciling the hand-authored fallback for that case is that sibling
  document's open item, not decided here — this derivation is module-wide,
  full stop.
- `dependsOn` is the union, over every field the ent's input consumes, of
  that field's producer(s): the earliest-declared ent whose **output mints**
  the field, when the field has a single flow-scope (earliest-producer-wins
  **per field**) — one entry, one edge; or, when the field is an OR-join (see
  the flow-scope rule below), **every** alternative producer of that field,
  never narrowed to the earliest one — a `dependsOn` entry that drops an
  OR-join's other alternatives would point at a single, possibly
  flow-tagged, producer and reintroduce exactly the cross-flow
  unresolvability the OR-join exists to prevent. An OR-join's `dependsOn`
  entry is therefore an inner array of every alternative, same order and
  same membership as its `bind` alternatives list (below): the runtime
  `dependsOn` shape's inner array is this OR-group — `["a", ["b","c"]]`
  means "depends on `a`, and on (`b` or `c`)" (documented in
  [02-endpoint-endpointcontroller.md](../06-runtime/02-endpoint-endpointcontroller.md)).
  An input drawing field A (single-scope) from ent P and field B (an
  OR-join between ent Q and ent R) from either depends on `["P", ["Q",
  "R"]]`. **Outputs declare what an ent mints, not what it echoes** — a
  field in both input and output is not a producer (echoes would poison
  derivation).
- Declare `[ENT]`s in the order the process runs — a producer edge only ever
  points from a consumer to an earlier-declared endpoint, so derived
  `dependsOn` can never cycle. A field minted only by a later-declared
  endpoint gets no edge at all (declaring it wouldn't point backward): it
  falls into the same handling as a field no endpoint produces at all (below)
  — a `$field` external input if typed `[TYP:ext]`, otherwise an ordinary
  request field.
- `[ENT:card]` / `[ENT:cash]` name **flows** (branches): tagged endpoints exist
  only in that flow, untagged in every flow; a field produced across more
  than one flow-scope makes its consumer an OR-join (first-resolvable-wins
  alternatives) — "flow-scope" counts untagged as its own universal scope, so
  an untagged producer paired with one or more flow-tagged producers of the
  same field is an OR-join too, not a single edge: a lone edge picked by raw
  declaration order could land on a flow-tagged producer and leave the field
  unresolved in every flow that producer isn't part of, even though the
  untagged producer would have covered all of them.
  `order`/`dependsOn`/`bind`/`flows` are computed once per module — a single
  value per endpoint, not one recomputed per flow selection — so this
  OR-join is what keeps that single derivation correct however the flow is
  selected at run time: when the join includes an untagged producer, that
  producer is always the last alternative, after every flow-tagged one
  (declaration order among those), so first-resolvable-wins tries each
  flow-tagged producer — resolvable only inside its own flow — before
  falling through to the untagged producer, which resolves in every flow the
  tagged ones don't run in. A field produced within a single flow-scope only
  (every producer untagged, or every producer tagged to that same one flow)
  keeps the single-edge form: earliest-producer-wins picks it as usual.
  `[ENT:optional]` marks a step that is attempted but never blocks a run.
  Unlike `[TYP]`, the `[ENT]` bracket slot holds exactly **one** modifier —
  `ws`, `optional`, or a single flow name; there is no comma list and they do
  not combine (`[ENT:card,optional]` parses as a flow literally named
  `card,optional`). `ws` and `optional` are the only reserved words a flow
  cannot be named; any other word is a valid flow name — no diagnostic
  validates the modifier.
- `flows` is that same tagging, read directly off the modifier rather than
  derived from the field graph: a flow-tagged `[ENT]`'s `flows` is `string`
  — its one tag name (the bracket slot never holds more than one flow name,
  per the rule above); an untagged `[ENT]`'s `flows` is `string[]` — every
  flow name declared anywhere in the module — the concrete listing of
  "untagged in every flow" (runtime shape: `string | string[]`, documented
  in
  [02-endpoint-endpointcontroller.md](../06-runtime/02-endpoint-endpointcontroller.md)).
- `bind` maps each consumed input field to its producer, one entry per
  field, each producer serialized as its producing `[ENT]`'s full
  `surface.action` name plus the minted field, dot-joined into one
  three-part string — `"surface.action.field"` — since `surface.action` is
  the endpoint's only identifier and neither `surface` nor `action` may
  itself contain a `.`, so the first two dot-separated segments always name
  the endpoint and the third always names its output field: this single
  serialized string is used for a single earliest-producer edge (the
  `dependsOn` winner for that field), or listed in an alternatives array
  (`["surface.action.field", ...]`, first-resolvable-wins) when the field is
  an OR-join — one entry per flow-tagged producer, declaration order, plus
  the untagged producer last when one also mints the field. A
  field resolving to a `$field` external input carries a literal `"$"`
  prefixed to that field's own name — e.g. a field named `userId` carries
  `"$userId"`, not the literal string `"$field"` — instead of a producer
  reference. A field with neither a producer nor `[TYP:ext]` gets no
  `bind` entry at all (below). This is the derivation that populates the
  runtime `bind` shape — `Record<string, string | string[]>` — documented in
  [02-endpoint-endpointcontroller.md](../06-runtime/02-endpoint-endpointcontroller.md).
- A consumed field with no producer edge — whether no endpoint mints it at
  all, or the field-minted-later case above — becomes a `$field`
  **external input** when typed `[TYP:ext]` — the cake's "Module inputs" card / the runner's
  `overrides.seeds` supply it, and *ghost stubs* keep it runnable meanwhile
  (see [04-codegen.md](../04-codegen/00-overview.md)). Without `[TYP:ext]`, such a field gets
  no bind at all: it stays an ordinary request field the cake/runner fill from
  its `example=` at send time, and `rune sync` warns when an input field has
  neither producer nor example (a guaranteed 422). The warning covers every
  field of the input DTO — the diagnostic draws no required/optional
  distinction.

### WebSocket entrypoints

`[ENT:ws] <surface> [@ /path]` declares a socket header; the indented
`verb(InputDto): OutputDto` lines under it are its **topics** (message
handlers), accepted at any indent ≥ 1 (4 spaces is the convention — no depth
is checked). The "WS topic rules" the Validation summary names are the parser
of record's errors: a malformed header (`[ENT:ws]` without a valid
`<surface> [@ /path]`, or one carrying a `(...)` signature), a socket with
zero topics, and a malformed topic — a topic's verb must be a bare identifier
and its output non-empty (`void` means "no reply"); any other indented line
under a socket, including a `[REQ]` line, is a malformed-topic error. Client
messages are `{ "topic": "<verb>", "data": <InputDto> }`; a non-`void` return
is the reply to that sender. Each topic dispatches to a `[REQ]` exactly as an
HTTP `[ENT]` does — matched by its `(input, output)` signature, a shared
signature is the same ambiguity error (topics cannot carry a body `[REQ]`, so
disambiguate with distinct signatures), and zero matches generates an unwired
handler. The match is textual on **both** slots, so a `void`-output topic
could only wire to a `[REQ]` declared `: void` — which the DTO-output rule
flags — and in a clean spec every no-reply topic therefore takes the
zero-match path. That path is the intended one, not a dead end: the socket
controller is create-once and dev-owned, so the dev implements the no-reply
behavior directly in the generated handler body (it throws `not implemented`
until filled). The `void` still shapes the generated method — no `output:` in
its decorator, a `Promise<void>` return, and no reply sent. A header's `@ /path`
segments provide the socket's handshake bindings: its `{name}` segments
translate to route params exactly like an HTTP template (`{name}` → `:name`,
a trailing `{name*}` catch-all) to form the socket's mount path. A header with
no `@ /path` mounts at `/<kebab-cased-surface>` — the same surface-derived
default an HTTP `[ENT]` uses for its route prefix — and carries no route
params. Either way the generated code binds nothing from the mount path
itself: each topic handler receives only its message payload (`data:
InputDto`), and reading connect-time values is left to the dev-owned handler
bodies. `from=` field sources are an HTTP-only concept: WS
codegen never consults them, so a `[TYP:from=query]` (or `path`/`header`)
field of a topic's input DTO stays an ordinary message-payload field. WS
endpoints carry no HTTP verb and never enter
the OpenAPI doc or the cake walk — nor the field-graph derivation in "Process
flows and derivation," above: a topic's input/output DTO fields never act as
a producer or consumer for any `[ENT]`'s `dependsOn`/`bind`, and a topic
carries no `order`/`dependsOn`/`bind`/`flows` of its own — `WsEndpointOptions`
has no such fields (see
[02-endpoint-endpointcontroller.md](../06-runtime/02-endpoint-endpointcontroller.md)).
A surface is HTTP or WS, never both — this
is a diagnosed rule (HTTP-vs-WS surface exclusivity), enforced by both
`rune check`/`rune sync` and the LSP: a surface name declared by both an
`[ENT]` and an `[ENT:ws]` errors (see
[06-validation-summary.md](06-validation-summary.md)).

