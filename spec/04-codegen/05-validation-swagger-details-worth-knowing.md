## The `[TYP]` → validator/Swagger emission reference

How a DTO field's declared `[TYP]` and cardinality suffix (`(s)`/`(s?)`/
trailing `?`) become class-validator decorators and `@ApiProperty` metadata on
the generated class — the emission rules codegen applies field by field.

### Type → validator mapping

| `[TYP]` resolves to | Base decorator(s) | Constraint modifiers | Why / marker |
| --- | --- | --- | --- |
| checkable primitive (`string`/`number`/`boolean`) | `@IsString()` / `@IsNumber()` / `@IsBoolean()` — the base check always applies, `int` included: `[TYP:int]` layers `@IsInt()` on top of the `@IsNumber()` base rather than replacing it | layered per the modifier table in [02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md) (`[TYP:email] email: string` → `@IsString()` + `@IsEmail()`; `[TYP:int] n: number` → `@IsNumber()` + `@IsInt()`) | — |
| no `[TYP]` at all | `@Allow()` | none | field types `unknown` — opaque to class-validator, so any base check would risk falsely rejecting a valid value; carries a `// TODO: tighten` marker flagging the gap for the builder to close by hand once the field's real type is known |
| a non-checkable primitive (`void`/`Uint8Array`/`Class`), a bare alias of another `[TYP]` (`[TYP] taskId: id`), or a `[TYP]` resolving to a generic or a real type union | `@Allow()` | none | same opacity as above — none of these has a class-validator base check that wouldn't risk rejecting valid values; pass-through, no marker |
| a `[TYP]` aliasing a `DTO` | `@ValidateNested()` + `@Type()` | none | not opaque — it nests through the aliased DTO's own decorators rather than a scalar check; not the `@Allow()` pass-through |

String-literal enums (bare-word unions) are the one exclusion from the
`@Allow()` row above: they validate with `@IsIn()`, per the bare-word-union
rule in the sibling doc above — not the `@Allow()` pass-through. The
`@Allow()`-vs-nesting split for a `[TYP]` naming another type follows the
canonical rule in
[02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md):
only a `[TYP]` aliasing a DTO nests; a bare alias of another `[TYP]` carries
no validator at all. See also the emission-table enum
note in [01-pipeline.md § 3 Generate](01-pipeline.md#3-generate).

### Array cardinality

| Suffix | Base decorator(s) | Per-element validated? | Field required? | Swagger routing |
| --- | --- | --- | --- | --- |
| `x` (scalar) | per the mapping above | n/a | yes | `min`/`max` on the property; `type` too, but only for a non-`string` scalar |
| `x(s)` | mapping-above decorator(s) with `{ each: true }`, plus `@IsArray()` | yes | yes — omitting the field is a 422 | `min`/`max`/`type` under `items` |
| `x(s)?` | mapping-above decorator(s) with `{ each: true }`, plus `@IsArray()` and `@IsOptional()` (composite of the `x(s)` row plus `@IsOptional()`) | yes | no | `min`/`max`/`type` under `items` |
| `x(s?)` | mapping-above decorator(s) with `{ each: true }`, plus `@IsArray()` and `@IsOptional()` — the `?` inside the parens marks the same field-level optionality as a trailing `?`, an alternate spelling of the `x(s)?` row below | yes | no | `min`/`max`/`type` under `items` |
| `x?` | mapping-above decorator(s) + `@IsOptional()` | n/a | no | property |
| `x(s?)?` | mapping-above decorator(s) with `{ each: true }`, plus `@IsArray()` and `@IsOptional()` (both `?` markers stack to the same decorators as the `x(s)?`/`x(s?)` rows — doubling the marker changes nothing) | yes | no | `min`/`max`/`type` under `items` |

The `?` inside the parens (`x(s?)`) and a trailing `?` (`x(s)?`) both mark the
same field-level optionality — [02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md)
applies `{ each: true }` to an array's element check unconditionally off the
element type, never off this suffix, so neither spelling drops per-element
validation.

### Swagger / `@ApiProperty`

The cardinality table's routing column is the whole rule: `@ApiProperty`
never takes `{ each: true }`; for an array property, `min`/`max`/`type` route
under `items` instead of the property itself — OpenAPI silently ignores them
at the property level. For a scalar property, `type` is included only when
the field isn't a bare `string` — a `string` field's type is already resolved
by NestJS's reflection-based inference, so `@ApiProperty()` needs no explicit
`type` there, while a `number`/`boolean` field always carries one
(`@ApiProperty({ type: Number, … })`). Under `items`, `type` is always
explicit regardless of element type, since reflection can't see inside an
array. An optional field — any cardinality-table row whose Field required?
column reads no (`x?`, `x(s)?`, `x(s?)`, and `x(s?)?`; whichever one applies
also carries `@IsOptional()`) — additionally emits
`@ApiProperty({ required: false, … })`: OpenAPI defaults an omitted
`required` to `true`, and since this doc rules out the NestJS Swagger CLI
plugin (`type` must always be explicit for `number`/`boolean`, never
inferred), nothing else would flip that default — a bare `@ApiProperty()` on
an optional field would mis-document it as required.

### `example=` & inputs

`example=` values — rendered by the type-coercion rule in the sibling
modifier table — emit swagger examples that the cake and runner use to fill
required, unbound input fields. See "Guaranteed 422s" below for what happens
when a required, unbound field has none.

### Guaranteed 422s

Every generated DTO is validated by keep's assert runtime (`#assert`, see
[06-runtime/03-the-assert-runtime-assert.md](../06-runtime/03-the-assert-runtime-assert.md)):
`assert(Cls, plain)` runs `validateSync` against the class's decorators and
throws `RuneAssertError`, which the global filter maps to HTTP 422. The
decorators below are what that call validates, so a request lands a 422 in
exactly these codegen-owned cases:

1. A field fails its base check (the primitive check from the type mapping
   above).
2. A field fails a layered constraint-modifier decorator (`@IsEmail()`,
   `@IsUUID()`, `@Min(N)`, …).
3. A string-literal-enum field fails its `@IsIn()` check — the value isn't
   one of the bare-word union's members.
4. A required field is missing — including a required `(s)` array (the only
   array suffix that isn't also optional; see "Array cardinality" above):
   `@IsArray()` applies, so omitting the field is a 422.
5. A required field **without** `[TYP:ext]` has no producer and no
   `example=` — flagged at sync time by the input diagnostics
   ([05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md)), and still
   a 422 at runtime once the request actually arrives without the field. A
   `[TYP:ext]` field with no producer is a different case: it becomes a
   `$field` external input kept runnable by ghost stubs
   ([03-ghost-stubs-the-typ-ext-lifecycle.md](03-ghost-stubs-the-typ-ext-lifecycle.md)),
   not a guaranteed 422.

This is the codegen-owned surface of that same `#assert` mechanism — the
decorators above are what `assert(Cls, plain)` validates at the HTTP
boundary. Business logic that calls `assert()` directly on a DTO class hits
the identical `validateSync`/`RuneAssertError`/422 path; see
[06-runtime/03-the-assert-runtime-assert.md](../06-runtime/03-the-assert-runtime-assert.md)
for the runtime mechanics shared by both call sites.

### JSDoc safety

- `jsdocSafe` breaks `*/` in prose with a zero-width space so descriptions
  can't terminate a generated JSDoc block.
- `[SRV]` `@docs` URLs surface as `@see` JSDoc on generated adapter methods.

### Worked example

Source:

```rune
[TYP:email] email: string
[TYP] tag: string
[TYP] note: string
[TYP:int,min=1,max=5,example=3] priority: number

[DTO] OrderDto: email, tag(s), note(s?), priority?
    Order metadata submitted by the customer; do not close early: */ this
    must not break the generated doc block.
```

Generated `dto/order.ts`:

```ts
/**
 * Order metadata submitted by the customer; do not close early: *[U+200B]/ this
 * must not break the generated doc block.
 */
export class OrderDto {
  @IsString()
  @IsEmail()
  @ApiProperty()
  email!: string;

  @IsArray()
  @IsString({ each: true })
  @ApiProperty({ items: { type: String } })
  tags!: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ApiProperty({ required: false, items: { type: String } })
  notes?: string[];

  @IsOptional()
  @IsNumber()
  @IsInt()
  @Min(1)
  @Max(5)
  @ApiProperty({ required: false, type: Number, minimum: 1, maximum: 5, example: 3 })
  priority?: number;
}
```

Every rule above is in that one class: `email` is a primitive alias plus a
constraint modifier (`@IsString()` base, `@IsEmail()` layered); `tags` is a
required `(s)` array (`@IsArray()` plus the element check under `{ each:
true }`); `notes` is an optional `(s?)` array — the `?` inside the parens
marks the same field-level optionality as `priority`'s trailing `?`
(`@IsOptional()` plus `@IsArray()` and the per-element `@IsString({ each:
true })` check, exactly as `tags` gets — see "Array cardinality" above);
`priority` is a trailing-`?` optional number (`@IsNumber()` base
with `@IsInt()` layered, per the `int` modifier) carrying `required: false`
plus its `example=3` into `@ApiProperty` and its `min=1`/`max=5` under
`minimum`/`maximum`. The
class comment shows `jsdocSafe` at work: the source
description's `*/` survives as `*[U+200B]/` — a zero-width space wedged
between the two characters — so it can't prematurely close the generated
`/** … */` block.

The DTO's `[SRV]` counterpart, declared once in the core spec:

```rune
[SRV] (HTTP)orders: ORDERS_API_URL
    the orders API used to place customer orders
    @docs https://api.example.com/docs/orders
```

surfaces on the generated adapter, not on the DTO itself:

```ts
/**
 * @see https://api.example.com/docs/orders
 */
async create(dto: OrderDto): Promise<OrderDto> {
  // adapter body — generated from the [SRV] boundary, see
  // 02-language/03-requirements-and-steps.md
}
```

