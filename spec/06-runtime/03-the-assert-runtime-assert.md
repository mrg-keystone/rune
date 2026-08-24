## The assert runtime (`#assert`)

`keep/src/assert/mod.ts`, exported as `@mrg-keystone/rune/assert`, aliased to
`#assert` in generated projects (canonical doc: `docs/assert-runtime.md`).

### The call contract — `assert(Cls, plain, context?)`

`assert(Cls, plain, context?)` runs `plainToInstance` + `validateSync` against
`Cls` with `whitelist: true` (undecorated properties are stripped — the DTO
class *is* the contract) and `enableImplicitConversion: false` (no silent
coercion). `[DTO:open]` classes (`static __keepOpen = true`) validate declared
fields strictly, then re-attach the payload's extra top-level fields.

- **On success**, `assert` returns a **new instance of `Cls`, not the
  original `plain` object**: `plainToInstance` constructs it, and
  `whitelist: true` prunes that instance down to `Cls`'s own decorated
  properties — any field on `plain` that `Cls` doesn't declare is silently
  absent from the result, not merely left unvalidated. `[DTO:open]` is the one
  exception: its re-attach step puts the payload's extra top-level fields back
  onto the instance after validation, so an open DTO's returned instance
  carries them even though a plain `[DTO]`'s wouldn't.
- **`context`** is an opaque, caller-supplied value (a request id, the calling
  endpoint's name — anything the caller finds useful) that `assert` neither
  reads nor validates. A successful call discards it; a failing call carries
  it verbatim onto the thrown `RuneAssertError`'s own `context` field (below),
  for whoever catches or logs the error to identify where the failing call
  came from.

### Helpers

Every helper takes the same optional trailing `context?` `assert` does, and
shares `assert`'s `RuneAssertError` → 422 mechanism: a failing call throws
`RuneAssertError` with `context` set to whatever the caller passed and a
`failures` array of `{path, constraint, message}`. Unlike
`assert(Cls, plain, context?)`, a scalar helper has no DTO field to source a
`path` from, so a standalone scalar failure's `path` is `""` — the empty
string. (`assert.arrayOf` prefixes the failing element's index onto its
item's path, which is how a scalar item's `""` path becomes the bare index
`2` in the worked example below, versus `2.qty` when the item is a class.)
Each scalar helper's `constraint` is its own type name, and its `message` is
that constraint's fixed default — there is no field name to interpolate, so
the message always reads in terms of "value".

| Helper | Signature | Success return | Validates / rejects | Constraint / default message |
| --- | --- | --- | --- | --- |
| `assert.arrayOf` | `assert.arrayOf(itemCheck, value, context?)` | the validated array, typed to `itemCheck`'s element type | `value` is an array whose every element passes `itemCheck` | per-element, from `itemCheck` (failures prefix the failing element's index onto its path — `2`, or `2.qty` when `itemCheck` is itself a class) |
| `assert.string` | `assert.string(value, context?)` | `value`, typed `string` | `value` is a `string`, rejects everything else | `isString` — `"value must be a string"` |
| `assert.number` | `assert.number(value, context?)` | `value`, typed `number` | `value` is a `number`, **finite only** — `NaN`/`Infinity`/`-Infinity` rejected, not just non-numbers | `isNumber` — `"value must be a number"` |
| `assert.boolean` | `assert.boolean(value, context?)` | `value`, typed `boolean` | `value` is a `boolean`, rejects everything else | `isBoolean` — `"value must be a boolean value"` |
| `assert.uint8Array` | `assert.uint8Array(value, context?)` | `value`, typed `Uint8Array` | `value` is a `Uint8Array`, rejects everything else | `isUint8Array` — `"value must be a Uint8Array"` |

A bare failing scalar call, e.g. `assert.number("nope")`, therefore serializes
to the same 422 body shape as any other assertion failure:

```json
{
  "statusCode": 422,
  "failures": [
    { "path": "", "constraint": "isNumber", "message": "value must be a number" }
  ]
}
```

### The failure model — the error and its 422 mapping

Failure throws `RuneAssertError { target, context, failures[{path,
constraint, message}] }`. Bootstrap registers a global filter that maps it to
**HTTP 422** with dotted paths (`lines.1.qty`) — detection is duck-typed on
name + failures shape, so it works across module copies.

#### Worked example

Source:

```rune
[TYP:int,min=0] qty: number

[DTO] LineDto: qty
    A single order line's quantity.

[DTO] OrderDto: line(s)
    An order and its line items.
```

generates, per the array-of-DTO rule in
[02-language/04-types-dtos-and-constraint-modifiers.md](../02-language/04-types-dtos-and-constraint-modifiers.md):

```ts
export class LineDto {
  @IsNumber()
  @IsInt()
  @Min(0)
  @ApiProperty({ type: Number, minimum: 0 })
  qty!: number;
}

export class OrderDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  @ApiProperty({ items: { type: LineDto } })
  lines!: LineDto[];
}
```

A caller passing a negative quantity:

```ts
assert(OrderDto, { lines: [{ qty: -1 }] });
```

throws:

```ts
RuneAssertError {
  target: OrderDto,
  context: undefined,
  failures: [
    { path: "lines.0.qty", constraint: "min", message: "qty must not be less than 0" },
  ],
}
```

`lines.0.qty` is the dotted path the mapping above promises: the array index
(`0`) prefixes the nested field name, flattened out of class-validator's
nested per-element `children`.

The 422 filter's wire body serializes the error's own `failures` array
unchanged and adds `statusCode`, dropping `target` and `context`
(server-internal, not for a client): `{ statusCode: 422, failures: [{ path,
constraint, message }] }`. The call above sends the client:

```json
{
  "statusCode": 422,
  "failures": [
    { "path": "lines.0.qty", "constraint": "min", "message": "qty must not be less than 0" }
  ]
}
```

### Operational concerns

- `RUNE_ASSERT=off` (trusted prod) skips `validateSync` only — `assert` still
  runs `plainToInstance` with `whitelist: true`, so the return contract above
  holds in both modes: callers still get a new `Cls` instance with
  undeclared fields stripped (and `[DTO:open]`'s extra fields re-attached).
  Off-mode only stops rejecting invalid payloads; it never starts returning
  the original `plain` object or leaking fields `Cls` doesn't declare. Read
  once at load; missing env permission fails safe (asserts stay on).
- The **single-copy invariant**: DTO classes and the assert runtime must
  resolve one copy of class-validator/class-transformer/reflect-metadata, or
  nested validation silently degrades. Guarded by the lockstep check
  ([01-architecture.md](../01-architecture/00-overview.md)).

