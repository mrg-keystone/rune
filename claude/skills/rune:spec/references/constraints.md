# Rune Constraints

Derived from LSP implementation.

## Syntax

| Rule | Severity |
|------|----------|
| Lines must not exceed 80 characters | ERROR |
| `[REQ]` format: `[REQ] noun.verb(InputDto): OutputDto` | ERROR |
| Step format: `noun.verb(args): type` or `Noun::verb(args): type` | ERROR |
| Boundary format: `service:noun.verb(args): type` (single-colon service prefix) | ERROR |
| Fault format: lowercase, hyphenated, space-separated | ERROR |
| `[DTO]` format: `[DTO] NameDto: prop1, prop2` | ERROR |
| `[TYP]` format: `[TYP] name: type` | ERROR |
| `[TYP]` modifier form: `[TYP:mod,mod,...] name: type` (comma-separated) | ERROR |
| Tags must be exactly 3 letters in brackets | ERROR |
| Instance methods use `.` separator | ERROR |
| Static methods use `::` separator | ERROR |
| Comments use `//` syntax | - |

## Indentation

| Context | Spaces | Severity |
|---------|--------|----------|
| `[REQ]` | 0 | ERROR |
| Steps | 4 | ERROR |
| Faults (under steps) | 6 | ERROR |
| `[PLY]` | 4 | ERROR |
| `[CSE]` | 8 | ERROR |
| Steps inside `[CSE]` | 8 | ERROR |
| Faults inside `[CSE]` | 10 | ERROR |
| DTO/TYP descriptions | 4 | ERROR |

## Scope

> **Documented, intentionally not enforced.** These rules describe how to
> reason about scope when authoring a spec, but the LSP deliberately does NOT
> implement them: diagnostics mirror what `rune sync`/`manifest` (the TS
> parser) actually enforce — structure + shape — and the generator performs no
> scope/usage checks. Inventing them would wrongly reject specs the valid
> corpus exercises. See the design comment at `lang/lsp/src/main.rs:25-30`.

| Rule | Severity |
|------|----------|
| Instance method noun must be in scope | ERROR |
| Static method noun has no scope requirement | - |
| Parameters must be in scope or from REQ input DTO | ERROR |
| Return type must be defined `[TYP]`, `[DTO]`, or `void` | WARNING |
| Each step's return value is added to scope | - |
| REQ input DTO properties (recursive) are in scope | - |
| Scope resets at each `[REQ]` | - |

## Requirements

| Rule | Severity |
|------|----------|
| Input must be DTO or inline `{}` | ERROR |
| Output must be DTO | ERROR |
| Last step must return REQ output type | ERROR |
| No duplicate `noun.verb` pairs | ERROR |
| `[REQ]` takes no modifier (any `[REQ:x]` is rejected) | ERROR |
| Double blank line between REQs | WARNING |

## Entrypoints

| Rule | Severity |
|------|----------|
| `[ENT]` format: `[ENT] surface.action(InputDto): OutputDto` | ERROR |
| `[ENT]` input must be a DTO or inline `{}`; output must be a DTO | ERROR |
| `[ENT]` modifier is a flow name or `optional` (`[ENT:card]`, `[ENT:optional]`) | - |
| An `[ENT]` may carry an explicit route clause between name and parens: `surface.action @ METHOD /path/{field}(InDto): OutDto` | - |
| `[ENT]` HTTP method must be one of GET, POST, PUT, PATCH, DELETE (case-insensitive; uppercase by convention) | ERROR |
| No clause ⇒ `POST` at an auto-derived route; `@ METHOD` alone ⇒ verb override, route still auto-derived | - |
| Template `{field}` segments (and one trailing `{field*}` catch-all) bind URL parts to same-named input-DTO fields — the explicit twin of `[TYP:from=path\|path*]` | - |
| An `[ENT]` may carry ONE indented `[REQ]` body line naming the coordinator it dispatches to | - |
| An `[ENT]` body `[REQ]` must reference a defined `[REQ]` | ERROR |
| An `[ENT]` body `[REQ]` takes no modifier | ERROR |
| Without a body `[REQ]`, an `[ENT]` is matched to its coordinator by `(input, output)` DTO pair | - |
| Two `[REQ]`s sharing an `[ENT]`'s `(input, output)` signature are ambiguous — disambiguate with a body `[REQ]` | ERROR |
| `[ENT:ws]` declares a WebSocket socket: `[ENT:ws] <surface> @ /path` header + indented `verb(InputDto): OutputDto` topics | - |
| An `[ENT:ws]` socket must declare at least one topic | ERROR |
| An `[ENT:ws]` topic must read `verb(InputDto): OutputDto` (`void` output ⇒ no reply) | ERROR |
| A surface is either HTTP `[ENT]`s or a WebSocket `[ENT:ws]` socket, never both | ERROR |

An empty input (`[ENT] http.refresh({}): StatusDto`) generates a no-argument
handler: the `@Endpoint` omits its `input` key and the method takes no body.

A WebSocket socket (`[ENT:ws] chat @ /rooms/{room}`) generates a `@WsEndpointController`
with one `@WsEndpoint` per topic; the verb is the message topic, the inbound `data` is
validated against the input DTO, and a non-`void` return is the reply sent to the sender.
Handshake bindings (`{path}` segments, `[TYP:from=query]` tokens) are read once at connect,
not per message. WS endpoints carry no HTTP verb, so they never enter the OpenAPI document.

## Process derivation

The cake/runner order and the `dependsOn` / `bind` wiring are derived from the
DTO field graph across the module's `[ENT]`s.

| Rule | Note |
|------|------|
| An ent depends on the earliest-declared ent whose **output** mints a field its **input** consumes | earliest-producer-wins |
| **Outputs declare what an ent MINTS, not what it echoes** — a field present in both an ent's input and output is NOT a producer of that field | echo-fields would otherwise poison derivation |
| A producer edge that would close a **cycle** (`A↔B`) is dropped; that field falls back to a `$input` bind | no circular `dependsOn` is ever emitted |
| A consumed field with no producer and a `[TYP:ext]` type becomes a `$field` external-input bind | seeds / the Module-inputs card supply it |

## Signatures

| Rule | Severity |
|------|----------|
| Same method name must have identical signature throughout | ERROR |
| First occurrence defines the signature | - |
| Applies to both instance and static methods | - |

## Boundaries

A boundary step is written `service:noun.verb(params): ret` — a single-colon
**service prefix**. This is distinct from `Noun::verb()` (static, double colon)
and from `noun.verb()` (an in-module business step). There are no builtin
boundary kinds: a prefix like `db:` is just a service **named** `db` that must
be declared in the same spec by a `[SRV]` block. (The old fixed kinds
`db:`/`fs:`/`mq:`/`ex:`/`os:`/`lg:` are gone — each is now an ordinary service
that needs a matching `[SRV]`.)

| Rule | Severity |
|------|----------|
| A boundary prefix names a declared service | ERROR |
| Service prefix must have a matching `[SRV]` in the same spec | ERROR |
| Parameters must be DTO or primitive | ERROR |
| Return type must be DTO, primitive, or `void` | ERROR |

An undeclared service prefix is a spec error (the `rune-service-presence`
lint).

### Service declarations (`[SRV]`)

A service is declared once per spec by:

    [SRV] (TRANSPORT)<service>: <ENV_VAR, ENV_VAR2>
        <one-line prose description>
        @docs <url>

`<transport>` is a **closed set**: `SDK` / `HTTP` / `WEBSOCKET`
/ `SIDECAR` / `NATIVE`. `NATIVE` is an in-process runtime/std-lib boundary
(filesystem, subprocess, crypto, clock) — neither a network surface nor a
co-located process; its faults are synchronous throws and its env-var list is
optional.

| Rule | Severity |
|------|----------|
| `[SRV]` format: `[SRV] (TRANSPORT)<service>: <ENV_VARS>` | ERROR |
| Transport must be one of `SDK` / `HTTP` / `WEBSOCKET` / `SIDECAR` / `NATIVE` | ERROR |
| One-line description required (4 spaces) | ERROR |
| `@docs <url>` line required (4 spaces) | ERROR |

The `@docs <url>` line is **required** on every `[SRV]` (added 2026-06-18). A
`[SRV]` missing it is a hard parse error — `[SRV] <name> requires an @docs
<url> line` — from `rune check` / `sync`, mirrored by the LSP. The `@docs` line
is indented 4, obeys the 80-column rule, and its url survives the inline-comment
stripper. `rune codegen` surfaces it as an `@see <url>` JSDoc tag on the
generated data-adapter method.

Worked example:

    [REQ] task.create(CreateTaskDto): TaskDto
        id::generate(): id                       // static step (::)
        [NEW] task
        task.fill(title): task                   // in-module business step
        db:task.save(TaskDto): void              // boundary: service:noun.verb
          timeout                                // fault
        task.toDto(): TaskDto

    [SRV] (SIDECAR)db: DB_URL                          // declares service "db" (sidecar)
        the project's primary datastore
        @docs https://docs.example.com/db        // REQUIRED documentation link

Here `db:task.save` is a boundary call to the service named `db`, declared by
the `[SRV]` block; `SIDECAR` is the sidecar transport; `DB_URL` is its env var; the
`@docs` line is the required documentation link.

## Types

| Rule | Severity |
|------|----------|
| Must resolve to primitive, not DTO | ERROR |
| Cannot reference other `[TYP]` definitions | ERROR |
| Each name must be unique | ERROR |
| All defined types must be used | WARNING |
| Bracket modifiers are comma-separated: `[TYP:ext,uuid]` | - |
| Unknown modifier (allowed: `ext`, `core`, `uuid`, `email`, `url`, `nonempty`, `int`, `min=<n>`, `max=<n>`, `positive`, `example=<value>`, `from=<path\|path*\|query\|header>`) | ERROR |
| `uuid` / `email` / `url` / `nonempty` require a `string` type | ERROR |
| `int` / `min=N` / `max=N` / `positive` require a `number` type | ERROR |
| `min` / `max` require a numeric value (e.g. `min=0`) | ERROR |
| `from` value outside `path` / `path*` / `query` / `header` | ERROR |
| Value on a modifier that takes none | ERROR |

Constraint modifiers become class-validator decorators on generated DTO
fields (`(s)` array properties use the `{ each: true }` forms) — the full
decorator table is in `spec.md` under **Constraint Modifiers**.

### Field-source binding (`from=`)

`[TYP:from=path|path*|query|header]` declares **where an input field is
populated from** at the HTTP boundary, adopting OpenAPI's parameter model.
**Body is the default** — a field with no `from=` is read from the JSON body
exactly as before, so existing specs are unchanged.

| `from=` | Source | Route effect |
|---------|--------|--------------|
| `path` | a named URL path segment | appends `/:field` to the endpoint route |
| `path*` | the catch-all path remainder (may span `/`) | appends a trailing slash-capturing segment |
| `query` | a query-string value | — (read from `?field=…`) |
| `header` | a request header | — (read from the headers) |

The route is **derived automatically** from the action plus the path fields in
declaration order — no path template needs to be written in the spec. (When you want
explicit control of the verb or the route shape, the `[ENT] … @ METHOD /template`
clause overrides the derivation and composes with `from=query|header` — see the
Entrypoints section.) Every layer reads
the same per-field source: the framework binds each field from its source and
merges them into one validated input DTO (so the coordinator signature is
unchanged); the docs render path/query/header params (out of the request body);
the cake renders each field at its source. Example:

```
[ENT] http.proxy(ProxyReqDto): ProxyResDto

[DTO] ProxyReqDto: target, rest, q, payload
    a request proxied to an upstream service

[TYP:from=path] target: string
    the upstream host segment
[TYP:from=path*] rest: string
    the remaining upstream path
[TYP:from=query] q: string
    a forwarded query parameter
[TYP] payload: string
    the forwarded request body
```

→ `POST /http/proxy/:target/:rest{.+}` with `q` as a query param and `payload`
in the body. `from=` composes with the other modifiers (`[TYP:from=query,example=widgets]`).

Built-in primitives: `string`, `number`, `boolean`, `void`, `Uint8Array`, `Class`, `Primitive`

Generics: `Array<T>`, `Record<K,V>`, `Map<K,V>`, `Set<T>`, `Promise<T>`, `Partial<T>`, `Required<T>`, `Pick<T,K>`, `Omit<T,K>`, `ReturnType<T>`

Tuples: `[type1, type2]`

## DTOs

| Rule | Severity |
|------|----------|
| Name must end in `Dto` | ERROR |
| Properties reference `[TYP]` or other DTOs | ERROR |
| Description required on next line (4 spaces) | ERROR |
| Each name must be unique | ERROR |
| No duplicate properties within same DTO | ERROR |
| All defined DTOs must be used | WARNING |

Array property syntax:
- `url(s)` -> `urls: Array<url>`
- `address(es)` -> `addresses: Array<address>`
- `child(ren)` -> `children: Array<child>`

## Polymorphism

| Rule | Severity |
|------|----------|
| `[PLY]` must be at step level (4 spaces) | ERROR |
| `[CSE]` must be inside poly block (8 spaces) | ERROR |
| `[CSE]` cannot appear outside poly block | ERROR |
| Block ends when indentation returns to 4 | - |
| Case names are camelCase | - |

## Constructor

| Rule | Severity |
|------|----------|
| Format: `[CTR] class_name` (no parens) | ERROR |
| Must reference `[TYP]` with type `Class` | ERROR |
| Returns the class itself (implied) | - |
| Adds class to scope | - |

## Return

| Rule | Severity |
|------|----------|
| Format: `[RET] value` | ERROR |
| Value must be in scope | ERROR |
| 4 spaces normally, 8 inside poly | ERROR |

## Faults

| Rule | Severity |
|------|----------|
| Must be under a step | ERROR |
| 2 spaces deeper than parent step | ERROR |
| Lowercase, hyphen-separated | ERROR |
| Must describe why (not just "failed") | - |
| Multiple faults space-separated on one line | - |

## Spacing

| Rule | Severity |
|------|----------|
| No blank lines between steps within REQ | - |
| Double blank line between REQs | WARNING |
| Blank line ends DTO/TYP description block | - |

## Generated code: validated seams

Generated coordinators validate every seam at runtime via
`import { assert } from "#assert"` — keep's assert runtime; `rune sync` maps
the `#assert` alias in the project's `deno.json`. Context labels use the
REQ's `noun.verb` for input/result and the boundary step's `noun.verb` for
reads/writes:

- the request **input**: `assert(InputDto, input, "task.create input")`,
  first statement of the shell
- every data-adapter **read**: `assert(TDto, await ..., "task.load")`;
  reads whose type resolves to a primitive use
  `assert.string` / `assert.number` / `assert.boolean` / `assert.uint8Array`
- every DTO **write** argument before it leaves:
  `assert(WDto, out.field, "task.save input")`
- the **result**:
  `return assert(OutputDto, out.result, "task.create output")`

A failed contract throws `RuneAssertError`; keep maps it to HTTP 422 with
`{ target, context, failures }` and dotted failure paths (`lines.1.qty`).
Named types with no runtime contract keep an `as` cast plus a trailing
`// unvalidated: <type> has no runtime contract` comment. `RUNE_ASSERT=off`
turns every assert into a passthrough (trusted prod mode). Entrypoint
controllers stay validation-free — validation lives in the coordinator.

### Lint: no-dto-cast

| Rule | Severity |
|------|----------|
| A coordinator must not cast with `as XxxDto` | ERROR |

Message: `coordinator casts to "<X>Dto" — validate the seam with
assert(<X>Dto, ...) instead of a blind cast`. Applies to coordinator-layer
files only (test files exempt).
