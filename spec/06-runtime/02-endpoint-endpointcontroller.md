## `@Endpoint` / `@EndpointController`

`keep/src/foundation/domain/business/endpoint-decorator/mod.ts` — "the one
place keep learns about an endpoint," and the surface rune generates into.
`@Endpoint(opts)` composes the danet route decorator, request-input wiring
(`@Body()`, or per-field path/query/header assembly when `sources` is
present, validated via assert), the Swagger request/response schemas, and
stamps a subset of the normalized options as `ProcessMetadata`, which rides
into the module's OpenAPI doc as **`x-keep-process`** (shape below). The
process-graph fields (`order`, `dependsOn`, `bind`, `flows`) are not
hand-authored — rune derives them from the module's DTO field graph and
emits them as literals in the generated `@Endpoint({...})` call; see
[05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md#process-flows-and-derivation)
for the derivation.

### Options

```ts
type DtoClass = new (...args: any[]) => object;
type FieldSource = "path" | "path*" | "query" | "header";

interface EndpointOptions {
  // Route & schema
  method?: "get" | "post" | "put" | "patch" | "delete"; // default: "post"
  path?: string;                                          // default: "" (mounts at the controller surface)
  input?: DtoClass;                                       // default: none — no request body
  output?: DtoClass;                                      // default: none — no 200 response schema
  sources?: Record<string, FieldSource>;                  // default: {} — every field from the JSON body
  description?: string;                                   // default: none — no operation description

  // Process metadata (rune-derived; see 02-language/05)
  order?: number;                                          // default: position in the module-wide `[ENT]` order (see below)
  dependsOn?: string | (string | string[])[];             // default: none
  bind?: Record<string, string | string[]>;               // default: none
  flows?: string | string[];                               // default: every flow — untagged ⇒ every flow declared anywhere in the module (see below)
  optional?: boolean;                                      // default: false
  stub?: boolean;                                           // default: false
}
```

All 12 fields are optional — a bare `@Endpoint()` is a valid `POST` at the
controller surface with no body and no response schema. It is not without
process metadata, though: `order` and `flows` are always resolved, never
merely absent — a generated endpoint gets them from rune's derivation, which
is computed module-wide across every `[ENT]` surface, never restarted per
controller (see 02-language/05), and a hand-authored endpoint that omits
them gets defaults stamped in their place: `flows` defaults to every flow
name declared anywhere in the module (empty when none are tagged) — the
untagged-endpoint rule below, applied at the module level, matching rune's
own derivation; `order`'s hand-authored default is described below, where
the single-surface and multi-surface cases differ. A bare `@Endpoint()` is
therefore discoverable at an unordered position across every flow, not
walk-invisible; it simply has no `dependsOn`/`bind` (nothing to derive them
from) and no `sources`/`optional`/`stub`. Per field:

- **`method`** — HTTP verb. **`path`** — sub-path under the controller
  surface (`""`, `":id"`).
- **`input` / `output`** — the request/response DTO classes: `input` drives
  danet body injection plus the Swagger requestBody schema, `output` the 200
  response schema.
- **`sources`** — a field named here is bound from the URL path / query
  string / request header instead of the JSON body, then merged back
  server-side so the handler still receives one validated input DTO;
  omitted from the map ⇒ body. `path*` is the slash-capturing catch-all,
  bound from a `:field{.+}` route segment; there is no `"body"` literal.
- **`description`** — the OpenAPI operation description.
- **`order`** — ascending position in the process walk, 0-based. Rune's
  derivation is module-wide: one ascending sequence over every `[ENT]`
  in the module, spanning every surface, never restarted per controller
  (see 02-language/05#process-flows-and-derivation) — codegen emits one
  controller per surface, so a multi-surface module's controllers each carry
  only a slice of that one sequence. For a **single-surface** module the
  controller's `@Endpoint`s *are* the whole module-wide sequence, so a
  hand-authored `order` left omitted defaults to the endpoint's registration
  index among the controller's `@Endpoint`s (0, 1, 2, … in class-body
  order) — that index already is the module-wide position, and a
  hand-authored `order` and a rune-generated one share one numbering
  scheme. For a **multi-surface** module the per-controller registration
  index is not the same numbering as the module-wide derivation, since each
  controller only sees its own slice: an omitted `order` on a hand-authored
  `@Endpoint` defaults to the module-wide numbering, not the per-controller
  registration index — its fallback is the endpoint's position in the
  module-wide sequence (declaration order across every controller
  `endpointModule` composes for that module), matching how rune's own
  derivation numbers a generated endpoint (see
  [05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md#process-flows-and-derivation)).
- **`dependsOn`** — the endpoint id (`surface.action`) or list of ids that
  must succeed first; an inner array is an OR-group: `["a", ["b","c"]]` =
  `a AND (b OR c)`.
- **`bind`** — `"surface.action.field"` fills a field from a captured
  response; `"$name"` declares an external input → seeds / Module-inputs
  card; an array lists alternatives, first-resolvable-wins.
- **`flows`** — named branch(es) of the module's process this endpoint
  belongs to; untagged endpoints are part of every flow, which is also the
  default when `flows` is omitted.
- **`optional`** — run-all and the headless runner attempt it, but its
  failure neither stops the walk nor fails the report.
- **`stub`** — a generated stand-in minting placeholder values; the
  emulator badges it, and contract wiring treats it as a producer like any
  other.

```ts
interface WsEndpointOptions {
  topic: string;         // required — matched against an inbound frame's `topic`
  input?: DtoClass;       // default: none — no `data` validation
  output?: DtoClass;      // default: none — informational only, see WebSocket twins below
}
```

`topic` is the only required field across either options type — every
`EndpointOptions` field is optional, and so are `WsEndpointOptions.input` /
`output`.

### Emitted `x-keep-process`

`ProcessMetadata` is the subset of a resolved `EndpointOptions` that
survives into the OpenAPI doc, keyed by the operation's `x-keep-process`
extension. Every `@Endpoint`, bare or fully specified, is stamped — the one
exception is an endpoint also marked `@Internal`/`@InProcessOnly` (see
below), which is omitted from the OpenAPI document entirely and so carries
no `x-keep-process`:

```ts
interface ProcessMetadata {
  order: number;
  dependsOn?: (string | string[])[];
  bind?: Record<string, string | string[]>;
  flows: string | string[];
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string;
  sources?: Record<string, FieldSource>;
  optional?: boolean;
  stub?: boolean;
}
```

- `order`, `flows`, `method`, and `path` are always present — every endpoint
  has a declared position, a flow membership (even if it's "every flow"),
  and a resolved verb/route, all defaulted when the option was omitted: rune
  supplies `order`/`flows` for a generated endpoint per its derivation (see
  02-language/05), and a hand-authored endpoint that omits them gets the
  module-wide-position / every-flow-in-the-module defaults described in
  Options, above — an endpoint's process metadata is never merely absent.
- `dependsOn` is present only when the endpoint consumes at least one
  **produced** field (a field with a producer edge, per
  [05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md#process-flows-and-derivation));
  an endpoint whose consumed inputs are all `$`-external (or all ordinary
  unproduced fields) carries no `dependsOn` at all — it depends on nothing
  upstream, so an empty `dependsOn` is never emitted.
- `bind` is present when the endpoint consumes at least one produced **or**
  external field — broader than `dependsOn`'s condition, since a `$name`
  external entry belongs in `bind` (seeding the Module-inputs card) without
  contributing a dependency edge. An endpoint with neither kind of field
  carries no `bind` either.
- `optional` and `stub` are present only when set — both default falsy and
  are omitted rather than stamped `false`.
- `sources` rides along only when non-empty — an endpoint whose whole input
  comes from the body carries no `sources` key.
- `dependsOn`'s stamped shape is always an array — rune's derivation (see
  [05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md#process-flows-and-derivation))
  never emits a bare string, even though `EndpointOptions.dependsOn` itself
  also accepts a single `string` for a hand-authored endpoint with exactly
  one dependency.
- **`input`, `output`, and `description` never appear in `x-keep-process`.**
  They are consumed elsewhere in the same OpenAPI operation instead:
  `input` becomes the operation's `requestBody` schema, `output` its `200`
  response schema, and `description` the operation's own `description`
  field. `x-keep-process` carries only what the emulator and headless
  runner need to walk the process graph and re-issue the call outside a
  browser click — the DTO shapes and prose description are already the
  operation's normal OpenAPI fields, and duplicating them into the
  extension would be dead weight the runner never reads.

**Example.** A module `task` declares, in this order: `task.create` (mints
`taskId`), `task.approveByManager` (flow `card`, mints `approver`),
`task.approveByFinance` (flow `cash`, mints `approver`), and `task.finish`
(untagged, consuming `taskId` from `task.create` and `approver` — an
OR-join between the two approval endpoints, per
[05-entrypoints-ent.md](../02-language/05-entrypoints-ent.md#process-flows-and-derivation)).
Rune generates `task.finish`'s handler as:

```ts
@Endpoint({
  method: "post",
  path: "finish",
  input: FinishTaskDto,
  output: TaskDto,
  order: 3,
  dependsOn: ["task.create", ["task.approveByManager", "task.approveByFinance"]],
  bind: {
    taskId: "task.create.taskId",
    approver: ["task.approveByManager.approver", "task.approveByFinance.approver"],
  },
  flows: ["card", "cash"],
})
finish(input: FinishTaskDto): Promise<TaskDto> { /* dev-owned */ }
```

— and stamps exactly this `x-keep-process` on the operation (no
`sources`/`optional`/`stub`: the endpoint uses none of them):

```json
"x-keep-process": {
  "order": 3,
  "dependsOn": ["task.create", ["task.approveByManager", "task.approveByFinance"]],
  "bind": {
    "taskId": "task.create.taskId",
    "approver": ["task.approveByManager.approver", "task.approveByFinance.approver"]
  },
  "flows": ["card", "cash"],
  "method": "post",
  "path": "finish"
}
```

`FinishTaskDto`'s own requestBody schema and `TaskDto`'s `200` response
schema live in the operation's ordinary `requestBody`/`responses` — not
here.

### Controller & module composition

`EndpointController(surface, opts?)` mounts the class as a danet controller
at the `surface` path (`opts.description` → the module's Swagger
description; the standalone class decorator `@SwaggerDescription("…")` sets
that same OpenAPI description directly — the mechanism `opts.description`
uses under the hood); `endpointModule(name, controllers)` builds the module;
`appModule` composes many modules into a root that never appears in the docs
index.

### `@Internal` / `@InProcessOnly`

`@Internal(...)` / `@InProcessOnly(...)` — a standalone method decorator
stacked alongside `@Endpoint`, the same way `@SwaggerDescription` stacks
alongside `@EndpointController` above — marks a hand-authored endpoint as
in-process-only: reachable through keep's provisioned in-process client (see
[06-composition-serving.md § The delegation
boundary](06-composition-serving.md#the-delegation-boundary)) but never
exposed on the external HTTP surface the module's danet route serves. It
applies to `@Endpoint` only — `@WsEndpoint` handlers never enter OpenAPI
regardless (see WebSocket twins, below), so marking one `@Internal` would be
a no-op.

An `@Internal`/`@InProcessOnly` endpoint is omitted entirely from the
module's OpenAPI document and `x-keep-process` — the same "nothing for
`DocsModule` to render" outcome a `swagger: false` module gets (see [The
docs surface — an addable module](05-the-docs-surface-an-addable-module.md)).
An in-process-only endpoint has no external route for the danet-served
OpenAPI document to describe, so stamping it would document a door that
isn't there; discovering it is the in-process client's own contract
(bedrock's, not this doc's), not `x-keep-process`'s.

### WebSocket twins

`@WsEndpointController(path)` / `@WsEndpoint(opts)` compose danet's
`@WebSocketController`/`@OnWebSocketMessage`. `path` mounts the handshake
route (must be non-empty — an empty path would silently fall back to the
HTTP router). A request runs:

1. A client sends one handshake `GET` to `path`; danet upgrades it to a
   WebSocket connection.
2. The client sends an inbound JSON envelope `{ "topic": "<verb>", "data":
   <InputDto> }` on that connection.
3. Danet dispatches the frame to the `@WsEndpoint` whose `topic` matches the
   frame's `topic`.
4. `data` is validated against that handler's `input` DTO (via assert).
   Invalid `data` throws the usual `RuneAssertError` into danet's
   exception-filter chain — a frame has no HTTP response for the 422 filter
   to shape, so the frame-level wire behavior past that (the reply/error
   frame envelopes, a `topic` no `@WsEndpoint` declares) is `@danet/core`'s
   WebSocket transport, out of scope for this spec.
5. A non-`void` return is the reply: serialized to JSON and sent **to the
   sender only** (no broadcast). A `void` handler sends nothing.

`output` is informational only — it documents the reply shape but is never
validated or enforced against the actual return value. Binary and streaming
frames are out of scope
([02-language.md](../02-language/00-overview.md)). WS handlers never enter
OpenAPI — `WsEndpointOptions` has no process-metadata fields, and the
lifecycle above never touches `x-keep-process`.

