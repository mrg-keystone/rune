# The Runtime Layer (`keep/` — `@mrg-keystone/rune`)

> Part of the [project spec series](README.md). Source: `keep/` — the
> publishable JSR package only. Reference doc: `keep/README.md` (the standalone
> surface). Current version: 4.x, built on `@danet/core`. The interactive docs
> surface (cake, system map, runner) has its own file: [07-cake.md](07-cake.md).

Keep is the Deno backend framework rune-generated code targets — and a
perfectly usable standalone framework. It builds on **bedrock**, the
foundation framework, which owns the layer-neutral substrate — handler/layer
composition and serving, the in-process client, and observability. Keep
conforms to bedrock's rules and does not restate them; this doc covers only
what keep adds. Keep owns the **backend semantics**: `@Endpoint` and the
OpenAPI/`x-keep-process` document build, the assert runtime and its → 422
mapping, and the docs module. Public API is exported from
`keep/src/bootstrap/mod.ts` (which loads the `reflect-metadata` polyfill once
for all consumers); the `./assert` subpath exports the assert runtime.

**Keep is auth-agnostic — bring your own auth.** It neither provides nor
assumes authentication: keep mints and verifies no credentials, carries no
session store, no caller identity, and no trust boundary, and leaves every
route it serves open. An app that wants auth layers its own (a danet guard,
its own middleware) over keep — keep never gets in the way of one and never
supplies one.

## `bootstrapServer(appName, module, options?)`

The composition root
(`keep/src/foundation/domain/coordinators/bootstrap-server/mod.ts`). It wires
logging, tracing, and the `RuneAssertError` → 422 filter, and builds each
module's OpenAPI document. `appName` names the app for the OpenAPI document's
title and as the app tag on every log entry and trace this server produces.
`module` is a class or an **array** of module
classes (composed into one root via `appModule`; each contributes its own
OpenAPI document). Options: `port` (default 3000), `swagger` — `true`
(the default, build the per-module OpenAPI documents), `false` (build none —
the `docs` return is empty), or `{ filters: string[] }` naming module classes
to exclude from the OpenAPI build (their routes still serve) — each entry is
the module's JS class name: for a raw danet `@Module` class, that class's own
name; for a module built via `endpointModule(name, controllers)`, the `name`
argument (keep uses it as the generated module class's name) — and
`onStart`/`onStop` lifecycle hooks.
The `onStart`/`onStop` semantics — the once-only guard, the handler-path
`{ backend, port: 0 }`, the disposer, `stop()` ordering, and the
SIGINT/SIGTERM process-termination handler under `deno serve` (`Backend`
forwards its hooks into this same lifecycle) — are bedrock's
serving-lifecycle contract, not restated here.

Returns `{ listen, stop, backend, handler, docs }`:

- `listen()` / `stop()` — start/stop on the configured port.
- `handler` — the raw `(Request, info?) => Response` dispatcher (the same
  pipeline `listen()` serves). Serve without binding
  (`Deno.serve((req, info) => api.handler(req, info))` — forward `info` so
  logs stay attributable) or mount under a prefix with `withBasePath`.
- `backend` — the **in-process client**. `backend.fetch` is `typeof fetch` and
  behaves **exactly like browser `fetch`** against this app — body, query,
  headers, cookies, streaming, redirects, and errors byte-identical to the HTTP
  path; only the transport differs (no port, no TCP — speed is the whole
  point), and the full pipeline runs (guards, pipes, interceptors, filters, the
  request/response logging). Usable immediately, before `listen()`. The
  authoritative contract — URL resolution, the cookie-fidelity model, the
  two-channel transport table, how `Backend` provisions it into a frontend,
  and the differential parity suite that enforces "exactly" — is bedrock's
  in-process-client contract; keep implements it, this doc doesn't restate it.
- `docs` — the composed app's per-module OpenAPI documents (one entry per
  module included in the OpenAPI build, each carrying the `x-keep-process`
  metadata `@Endpoint` stamps), built at boot; empty when `swagger` is
  `false`. Under `{ filters: string[] }`, a filtered module contributes no
  entry — its routes still serve, but it has no `docs` entry and so is
  invisible to any consumer of `docs`, including the headless runner and the
  docs pages: excluding a module from the OpenAPI build also excludes it from
  discovery. `docs` is the sole discovery source the docs pages and the
  headless runner (`exerciseEndpoints({ api: { backend, docs } })`) read
  endpoint metadata from — see [07-cake.md](07-cake.md).

### Custom DI providers — `InjectValue` / `InjectFactory` / `InjectClass`

Beyond controllers, an app registers its own injectables through three
top-level provider-descriptor builders keep re-exports:

- `new InjectValue(token, value)` — bind a token to a ready-made value
  (`useValue`): a config object, a shared client, a constant.
- `new InjectFactory(token, factory)` — bind a token to a factory function
  (`useFactory`) invoked to build the value.
- `new InjectClass(token, Class)` — bind a token to a class (`useClass`) the
  container constructs.

Each is a thin carrier of `{ provide, useValue | useFactory | useClass }` — a
danet-shaped provider descriptor for a danet `@Module`'s `providers` list.
Keep's own `endpointModule(name, controllers)` and `appModule(name, modules)`
helpers take controllers/modules only — neither exposes a `providers` slot — so
registering a custom provider means declaring it on a danet `@Module` directly,
whose `providers` metadata the DI container reads to resolve tokens — this is
plain danet dependency injection, independent of the OpenAPI document builder
(which separately reads a module's metadata only to build its Swagger docs).
The bound service resolves by its `token` anywhere in the composed app
regardless of the `swagger` option — turning `swagger` off stops OpenAPI
document generation, not provider resolution.

## `@Endpoint` / `@EndpointController`

`keep/src/foundation/domain/business/endpoint-decorator/mod.ts` — "the one
place keep learns about an endpoint," and the surface rune generates into.
`@Endpoint(opts)` composes the danet route decorator, request-input wiring
(`@Body()`, or per-field path/query/header assembly when `sources` is present,
validated via assert), the Swagger request/response schemas, and stamps the
normalized options as `ProcessMetadata` — the process fields below plus the
route's `method`/`path`, and `sources` when non-empty — which rides into the
module's OpenAPI doc as **`x-keep-process`**. `opts` (`EndpointOptions`, every
field optional):

- `method` — HTTP verb, `"get" | "post" | "put" | "patch" | "delete"`;
  default `"post"`. `path` — sub-path under the controller surface (`""`,
  `":id"`); default `""`.
- `input` / `output` — the request/response DTO classes: `input` drives danet
  body injection plus the Swagger requestBody schema, `output` the 200
  response schema.
- `sources` — per-field input source (`Record<string, FieldSource>`, where
  `FieldSource` is exactly `"path" | "path*" | "query" | "header"` — `path*`
  is the slash-capturing catch-all, bound from a `:field{.+}` route segment;
  there is no `"body"` literal): a field
  named here is bound from the URL path / query string / request header
  instead of the JSON body, then merged back server-side so the handler still
  receives one validated input DTO; omitted from the map ⇒ body.
- `description` — the OpenAPI operation description.
- Process metadata for the emulator + headless runner: `order` (`number` —
  ascending position in the process walk); `dependsOn` (`string` or a list of
  endpoint ids — handler method names — that must succeed first; an inner
  array is an OR-group: `["a", ["b","c"]]` = `a AND (b OR c)`); `bind`
  (`Record<string, string | string[]>` — `"otherEndpoint.outputField"` fills
  from a captured response, `"$name"` declares an external input → seeds /
  Module-inputs card, an array lists alternatives, first-resolvable-wins);
  `flows` (`string | string[]` — named branch(es) of the module's process
  this endpoint belongs to; untagged endpoints are part of every flow);
  `optional` (`boolean` — run-all and the headless runner attempt it, but its
  failure neither stops the walk nor fails the report); `stub` (`boolean` — a
  generated stand-in minting placeholder values; the emulator badges it, and
  contract wiring treats it as a producer like any other).

`EndpointController(surface, opts?)` mounts the class as a danet controller at
the `surface` path (`opts.description` → the module's Swagger description; the
standalone class decorator `@SwaggerDescription("…")` sets that same OpenAPI
description directly — the mechanism `opts.description` uses under the hood);
`endpointModule(name, controllers)` builds the module; `appModule` composes
many modules into a root that never appears in the docs index. The WS twins
(`@WsEndpointController(path)` / `@WsEndpoint(opts)`)
compose danet's `@WebSocketController`/`@OnWebSocketMessage`: `path` mounts the
handshake route (must be non-empty — an empty path would silently fall back to
the HTTP router), and danet upgrades one handshake GET there, then dispatches
each inbound JSON envelope `{topic, data}` to the `@WsEndpoint` whose `topic`
matches. `opts` (`WsEndpointOptions`, `topic` required) declares the handler:
`topic` — the message topic this handler answers, matched against an inbound
frame's `topic`; `input` — the inbound message DTO, `data` validated against
it; `output` — the reply DTO (informational only — see below). A non-`void`
return is the reply — serialized to JSON and sent
**to the sender only** (no broadcast; a `void` handler sends nothing; binary
and streaming frames are out of scope — [02-language.md](02-language.md)).
Invalid `data` throws the usual `RuneAssertError` into danet's
exception-filter chain (a frame has no HTTP response for the 422 filter to
shape); the frame-level wire behavior past that — the reply/error frame
envelopes, a `topic` no `@WsEndpoint` declares — is `@danet/core`'s
WebSocket transport, out of scope for this spec. WS handlers never enter
OpenAPI.

## The assert runtime (`#assert`)

`keep/src/assert/mod.ts`, exported as `@mrg-keystone/rune/assert`, aliased to
`#assert` in generated projects (canonical doc: `docs/assert-runtime.md`).

- `assert(Cls, plain, context?)` → `plainToInstance` + `validateSync` with
  `whitelist: true` (undecorated properties are stripped — the DTO class *is*
  the contract) and `enableImplicitConversion: false` (no silent coercion).
  `[DTO:open]` classes (`static __keepOpen = true`) validate declared fields
  strictly, then re-attach the payload's extra top-level fields.
- Helpers: `assert.arrayOf` (index-prefixed failure paths), `assert.string`,
  `assert.number` (**finite only** — NaN/Infinity rejected), `assert.boolean`,
  `assert.uint8Array`.
- Failure throws `RuneAssertError { target, context, failures[{path,
  constraint, message}] }`. Bootstrap registers a global filter that maps it to
  **HTTP 422** with dotted paths (`lines.1.qty`) — detection is duck-typed on
  name + failures shape, so it works across module copies.
- `RUNE_ASSERT=off` turns every assert into a passthrough (trusted prod); read
  once at load; missing env permission fails safe (asserts stay on).
- The **single-copy invariant**: DTO classes and the assert runtime must
  resolve one copy of class-validator/class-transformer/reflect-metadata, or
  nested validation silently degrades. Guarded by the lockstep check
  ([01-architecture.md](01-architecture.md)).

## Logging, tracing, alerting

The three-part observability design — **Part 1** request/response logging to
Datadog (capture rules, redaction, `KEEP_REQUEST_LOG`, the Datadog gate),
**Part 2** the structured `logger` (+ the bottom-level `critical` catcher →
Postmark), and **tracing** (ring / KV / OTLP) — is **bedrock substrate**, not
restated here: it is
layer-neutral (a frontend-only app gets the identical substrate), and
in-process calls are logged and traced exactly like HTTP ones. Keep's part is
the backend-specific wiring and consumers: `bootstrapServer` initializes the
substrate and registers `appName` as the app tag; `backend.fetch` sub-calls
are auto-spanned; traces render at `/docs/_trace` via the docs module
(Part 3, below); and the `RuneAssertError` → 422 filter is keep's own (the
assert runtime above). Attribution is by `requestId`, never a caller
identity — keep has none.

## The docs surface — an addable module

**Part 3 — docs/cake.** The interactive `/docs/*` surface — the per-module cake
pages, the system map, the `/docs/_trace` viewer, and the headless runner
(`POST /docs/_run`) — is **no longer hardwired into `bootstrapServer`**. It is
an **addable `DocsModule`** you register on the Danet app alongside your own
modules, **gated behind `KEEP_DOCS`, off by default** (add it and set
`KEEP_DOCS` truthy to expose it). `/docs/*` is the backend's own route space —
paths are given relative to the backend mount throughout this doc, so on the
raw `bootstrapServer` handler (unprefixed) they serve at `/docs/*`, and
through `Backend`'s `/api/` mount they're externally reachable at
`/api/docs/*` (trace viewer `/api/docs/_trace`, runner
`POST /api/docs/_run`). It is **fully open — no auth gate of any
kind**: like everything keep serves, the docs surface is unauthenticated; an
app that layers auth and wants the docs restricted must gate or exempt it
deliberately. `bootstrapServer` still builds the per-module OpenAPI documents
(the `docs` return, gated by the `swagger` option); the module is what renders
and serves the pages from them. Full detail — the pages, the system map,
expectations, and scenarios — is in [07-cake.md](07-cake.md).

## Composition & serving

Keep's `Backend` is a **bedrock layer**: it intercepts `/api/`, delegates
everything else to the wrapped frontend handler, and provisions the
in-process client downward. The full serving contract — the three canonical
shapes, the `/api/` mount and wire-URL model, `port` being inert under
`Deno.serve`, `withBasePath` as the low-level mount primitive, and the
`onStart`/`onStop`/signal lifecycle — is bedrock's, as is the provisioned
client's contract; keep conforms, this doc doesn't restate them.

The keep-specific facts: `Backend` is a **keep export**, and
`Backend(appName, module, options?)` mirrors
`bootstrapServer(appName, module, options?)` exactly
(`swagger`/`onStart`/`onStop` all forward through unchanged) plus one
addition on `options`: `frontend`, an optional `Frontend` handler (a frontend framework's export) to
compose with. It calls `bootstrapServer` internally but never calls its
`listen()` — it takes only the `handler` and mounts it under `/api/` — so the
composed app's endpoint modules are registered the same way they are for
`bootstrapServer`, through `module`, and the docs module (when on) is
externally reachable at `/api/docs/*` through the mount.

Bundler-safe: the Swagger builder (and its CommonJS handlebars dependency) is
lazy-loaded so importing the backend into a bundled SSR frontend works.

## Package hygiene

`keep/deno.json`: exports `.` and `./assert`; tasks `test`, `test:browser`
(Playwright cake tests), `test:smoke`, `check:jsr`.
`keep/scripts/check-jsr-deps.ts` emulates JSR's server-side dependency
validation locally (subpath exports across every version matching each range)
so a bad package fails in seconds, not after a ~10-minute server round trip.
Publishing is CI-automated on push to main — see
[11-release-and-distribution.md](11-release-and-distribution.md).
