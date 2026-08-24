## Types, DTOs, and constraint modifiers

- `[TYP] name: primitive` — primitives are `string`, `number`, `boolean`,
  `void`, `Uint8Array`, `Class`, plus the `Primitive` alias
  (`string | number | boolean`). Five of the six emit their TS keyword
  verbatim in the generated alias (`export type Name = string;`, `= number;`,
  `= boolean;`, `= void;`, `= Uint8Array;`); `Primitive` likewise emits its
  union verbatim. `Class` is
  the odd one out — it names a domain concept (the `[NEW]`/untagged-step
  class backing a `[NON]` noun, see
  [03-requirements-and-steps.md](03-requirements-and-steps.md))
  rather than a TS type, and it is never boundary-safe.

  `[TYP] name: Class` skips alias generation — no `dto/<name>.ts` file is
  generated for a `Class`-typed `[TYP]`, the same "no file of its own"
  treatment `[NON]` gets, since the domain class already generates from the
  matching noun's untagged steps at `domain/business/<noun>/mod.ts` and a
  `dto/<name>.ts` alias would be redundant; a `Class`-typed `[TYP]` used as a
  DTO field type carries `@Allow()` (no validator, no nesting). This file is
  the canonical owner of that rule: the codegen emission table's `[TYP]` row
  ([04-codegen/01-pipeline.md § 3. Generate](../04-codegen/01-pipeline.md#3-generate))
  maps `[TYP]` to `dto/<name>.ts` unconditionally and still needs this
  `Class`-typed carve-out folded in to match — that table row, not this rule,
  is what's pending sync.

  Generics (`Array<url>`,
  `Record<string, Primitive>`) and tuples (`[id, name]`) are allowed. A
  **bare-word union** body (`[TYP] verb: GET | POST | DELETE` — two-plus
  `|`-separated members, each a plain identifier that is neither a TS
  primitive/keyword nor a `*Dto` name) is accepted leniently — a `[TYP]` body
  is free text to the parser of record — and is a **string-literal enum**: the
  generated alias quotes the members, and DTO fields of the type validate with
  `@IsIn`; any other union passes through verbatim (see
  [04-codegen.md](../04-codegen/00-overview.md)). Types give semantic meaning to primitives
  (`id` vs raw `string`). Of the six primitives, only `string`, `number`, and
  `boolean` are **checkable**: a DTO field whose `[TYP]` resolves to one of
  them validates with that primitive's base check — `@IsString()` /
  `@IsNumber()` / `@IsBoolean()` — with any **constraint modifier** decorators
  from the table below layered on top (`[TYP:email] email: string` →
  `@IsString()` + `@IsEmail()`). Constraint modifiers — `uuid`/`email`/`url`/
  `nonempty`/`json`/`int`/`min`/`max`/`positive`, the table rows whose
  `Requires` column is `string` or `number` — apply only to a field of that
  required primitive; none of them ever applies to `boolean`, or to the three
  non-checkable primitives (`void`, `Uint8Array`, `Class`). The remaining,
  type-agnostic modifiers — `core`, `ext`, `from` (`Requires` = `—`) and
  `example` (`Requires` = `any`) — apply to a field of any type, checkable or
  not.

  Applying a known string/number modifier to a field of the wrong type —
  `[TYP:uuid] x: number`, `[TYP:int] x: string`, or any string/number
  modifier on a `boolean` field — is a hard error: `rune check` rejects it
  (`modifier 'uuid' requires a string field, got number`), the same severity
  class as the `[DTO:opne]` unknown-modifier error, since a requirement
  violation should not silently downgrade to a no-op that would generate a
  DTO whose decorators don't match what the field declaration implies.

  The other three primitives — `void`, `Uint8Array`, `Class` — have no base
  check: a DTO field whose `[TYP]` resolves to one of them carries only
  `@Allow()` (no validator), the same `@Allow()`-only pass-through that
  applies to a bare alias of another `[TYP]`, or to a `[TYP]` resolving to a
  generic or a real type union, with no constraint modifiers in either case
  (see
  [04-codegen/05-validation-swagger-details-worth-knowing.md](../04-codegen/05-validation-swagger-details-worth-knowing.md)).
  A `[TYP]` body may also name a DTO or another
  `[TYP]` — no tool rejects either (the LSP carries a parity test asserting
  both parse clean), but only the DTO alias is supported: codegen imports the
  DTO class and re-exports it under the alias's own name (`[TYP] Foo:
  SomeDto` → `export { SomeDto as Foo }`, so downstream references resolve
  through the alias identifier), and a DTO field of the alias nests and
  validates through it. A bare alias of another `[TYP]` (`[TYP] taskId: id`)
  is unsupported convention, like the scope rules: codegen emits the body
  verbatim (`export type TaskId = id;` — an unresolved reference, since the
  aliased type generates as `Id`), DTO fields of it carry only `@Allow()` (no
  validator), and it does not count as a primitive at boundaries — alias the
  primitive instead. Generic parameters and tuple members may reference
  declared `[TYP]`s, as the examples above do.
- `[DTO] NameDto: prop1, prop2` — properties reference types or other DTOs by
  name (property name = type name): a `[TYP]`-typed property keeps the
  `[TYP]` name verbatim (e.g. `[DTO] TaskDto: id, title, done`, where `id`,
  `title`, and `done` are each a declared `[TYP]`). A property
  that composes another `[DTO]` instead takes that DTO's name with the
  trailing `Dto` suffix stripped and camelCased (`AddressDto` → `address`) —
  the same stripping convention `[DTO]`-derived filenames use (see
  [01-architecture/07-naming-conventions.md](../01-architecture/07-naming-conventions.md)).

  When a single property token resolves under both rules at once — a
  declared `[TYP] address` and an `AddressDto` both present make property
  `address` ambiguous, and the two names are not "duplicate names" — it is a
  hard error at `rune check`/`rune sync` time (`property 'address' is
  ambiguous between [TYP] address and AddressDto` — rename one), the same
  severity class as this file's own duplicate-name rule below; silently
  picking a winner would make the generated field's type depend on
  declaration order the author never chose.

  Name must end in `Dto`. A 4-space-indented
  description line is **required** on `[DTO]` — but enforced by the LSP only
  (`lang/lsp/src/main.rs:643`; `rune check`/`rune sync` exit 0 on an undescribed
  DTO). Multi-line is allowed; it feeds LSP hover and generated docs. The same
  description line on `[TYP]` is **conventional, not required** — no tool flags
  an undescribed `[TYP]` (there is no `typ-described` rule anywhere).
- **`[DTO:open]`** (opaque-inbound DTO) validates its declared fields strictly
  but lets **undeclared** top-level fields ride through, instead of stripping
  them the way a plain `[DTO]` and `[DTO:core]` do. Codegen marks the generated
  class `static __keepOpen = true`; at the seam keep's assert validates the
  declared fields, then re-attaches the payload's extra fields (see
  [06-runtime.md](../06-runtime/00-overview.md), [04-codegen.md](../04-codegen/00-overview.md)). The only
  `[DTO]` modifiers are `core` and `open`, and — like the `[TYP]` slot below —
  the `[DTO]` bracket slot is comma-split: the two modifiers are independent
  axes (kernel routing vs. inbound strictness) and combine freely
  (`[DTO:core,open]`). Any other value (`[DTO:opne]`) is an unknown-modifier
  error naming `:core or :open`.
- **Array properties** use a parenthesized suffix: `url(s)` → `urls: string[]`,
  `address(es)` → `addresses`, `child(ren)` → `children`.
- Unused types/DTOs are warnings; duplicate names are errors; the same
  `noun.verb` (a step's callee, `[REQ]`'s own name included — see
  [03-requirements-and-steps.md](03-requirements-and-steps.md)) must keep an
  identical signature — argument names/types and return type — everywhere in
  the file.

The `[TYP]` bracket slot takes a comma-separated **modifier list**
(`[TYP:ext,uuid] memberId: string`):

| Modifier | Requires | Effect |
| --- | --- | --- |
| `core` | — | route to the shared kernel `src/core/` (also on `[DTO:core]`; never on `[REQ]`) |
| `ext` | — | value produced outside this module → `$name` external-input bind |
| `uuid` / `email` / `url` / `nonempty` / `json` | `string` | class-validator decorator on generated DTO fields (`@IsUUID()`, …; `json` = `@IsJSON()`, validates a JSON-blob string parses at the seam) |
| `int` / `min=N` / `max=N` / `positive` | `number` | `@IsInt()`, `@Min(N)`, `@Max(N)`, `@IsPositive()` |
| `example=V` | any | swagger `@ApiProperty({ example: V })` — feeds the cake/runner's generated bodies (see [07-cake.md](../07-cake/00-overview.md)); rendering of `V` is type-coerced — see below |
| `from=path\|path*\|query\|header` | — | where the field binds at the HTTP boundary (body is the default); `path` appends `/:field` to the derived route, `path*` a catch-all (route derivation: see [05-entrypoints-ent.md](05-entrypoints-ent.md)) |

The slot is split on **every** comma — no quoting or escaping — so a value
(`example=V`) runs only to the next comma or `]` and can never itself contain
a comma: the text after the comma is tokenized as another modifier (normally
an unknown-modifier error).

`example=V`'s raw token `V` is rendered by the field's checkable-primitive
type, not verbatim: on a `number` field it parses as a numeric literal and
emits unquoted (`example=5` → `example: 5`); on a `boolean` field `true`/
`false` emit as the literal (`example=true` → `example: true`); on a
`string` field, or on any field whose `[TYP]` isn't one of the three
checkable primitives (`void`/`Uint8Array`/`Class`, a generic, a union, a DTO
nest), `V` emits as a double-quoted string literal (`example=hello` →
`example: "hello"`).

Array properties apply the `{ each: true }` form to every element-level
`class-validator` decorator on the field, whichever kind it is: the field's
base check, for an array of a plain checkable primitive with no constraint
modifier (`@IsString({ each: true })` / `@IsNumber({ each: true })` /
`@IsBoolean({ each: true })`); each layered constraint modifier, for an array
of a modifier-carrying `[TYP]` (`@IsEmail({ each: true })`); and
`@ValidateNested({ each: true })` (paired with an unmodified `@Type`), for an
array of a composed `[DTO]` (`dto/<name>.ts`'s `@ValidateNested`/`@Type`
nesting decorators — see [04-codegen.md](../04-codegen/00-overview.md)). An
array of a non-checkable primitive (`void`/`Uint8Array`/`Class`) still gets
the array-level `@IsArray()` every `(s)`/`(s?)` array carries — cardinality is
validated, so a missing required such array is still a guaranteed 422 — with
only the element-level check downgraded to `@Allow()` (see
[04-codegen/05-validation-swagger-details-worth-knowing.md](../04-codegen/05-validation-swagger-details-worth-knowing.md)).
`@ApiProperty` never takes `{ each: true }` —
array `min`/`max`/`type` route under `items` instead (see
[04-codegen/05-validation-swagger-details-worth-knowing.md](../04-codegen/05-validation-swagger-details-worth-knowing.md)).
`[REQ]` takes **no** modifier at all.

