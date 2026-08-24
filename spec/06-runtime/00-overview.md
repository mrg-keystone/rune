# The Runtime Layer (`keep/` — `@mrg-keystone/rune`)

> Part of the [project spec series](../README.md). Source: `keep/` — the
> publishable JSR package only. Reference doc: `keep/README.md` (the standalone
> surface). Current version: 4.x, built on **bedrock** (which builds on
> `@danet/core`). The interactive docs
> surface (cake, system map, runner) has its own file: [07-cake.md](../07-cake/00-overview.md).

Keep is the Deno backend framework rune-generated code targets — and a
perfectly usable standalone framework. It builds on **bedrock**, the
foundation framework. Keep conforms to bedrock's rules and does not restate
them; this doc, and its siblings, cover only what keep adds:

| bedrock owns | keep owns |
| --- | --- |
| The layer-neutral substrate — handler/layer composition and serving; the in-process client; observability | The backend semantics — `@Endpoint`/`x-keep-process` (route declaration + the OpenAPI document build); the assert runtime + its → 422 mapping; the docs module |

Public API is exported from
`keep/src/bootstrap/mod.ts` (which loads the `reflect-metadata` polyfill once
for all consumers); the `./assert` subpath exports the assert runtime.

**`x-keep-process` is the connective contract that threads the rest of this
section together.** [`@Endpoint`](02-endpoint-endpointcontroller.md) stamps
every route with `ProcessMetadata` — `order`, `flows`, `method`, and `path`
are always present (defaulted when a hand-authored endpoint omits them),
`dependsOn` rides along when the endpoint consumes a field another endpoint
produces, and `bind` when it consumes a produced *or* external (`$`-seeded)
field — an external-only endpoint carries `bind` with no `dependsOn`;
[`bootstrapServer`](01-bootstrapserver-appname-module-options.md)
folds that metadata into each module's OpenAPI document as `x-keep-process`
at boot; and the `docs` return it builds is the **sole discovery source** the
[docs pages and the headless runner](../07-cake/00-overview.md) read endpoint
metadata from — nothing else walks a module's routes to build the cake, the
system map, or a run-all pass. Most `@Endpoint`s are therefore discoverable
by all three, even a bare one with no process fields wired — it shows up
with its defaulted `order`/`flows`/`method`/`path` and no `dependsOn`/`bind`;
see
[02-endpoint-endpointcontroller.md](02-endpoint-endpointcontroller.md#emitted-x-keep-process)
for the exact shape. Two exclusions apply: an endpoint marked
`@Internal`/`@InProcessOnly` is omitted from the OpenAPI document and so
carries no `x-keep-process`, and a module excluded from the OpenAPI build
(`swagger: false`, or named in a `{ filters: string[] }` exclusion)
contributes no `docs` entry at all — both are undiscoverable by the docs
pages and the headless runner (see
[02-endpoint-endpointcontroller.md § `@Internal` /
`@InProcessOnly`](02-endpoint-endpointcontroller.md#internal--inprocessonly)).
A builder wiring `order`, `dependsOn`, `bind`, and `flows` is therefore not
annotating for documentation's sake — it is authoring the process-graph
input those downstream consumers walk.

**Keep is auth-agnostic — bring your own auth.** It neither provides nor
assumes authentication: keep mints and verifies no credentials, carries no
session store, no caller identity, and no trust boundary, and leaves every
route it serves open. An app that wants auth layers its own (a danet guard,
its own middleware) over keep — keep never gets in the way of one and never
supplies one.

The section's content lives in its sibling files, in the order a request
actually walks them — compose/boot, route, validate, observe, discover,
publish:

- [`bootstrapServer(appName, module, options?)`](01-bootstrapserver-appname-module-options.md)
  — the composition root: wires logging, tracing, and the 422 filter, builds
  each module's OpenAPI document, and boots and serves the app.
- [`@Endpoint` / `@EndpointController`](02-endpoint-endpointcontroller.md) —
  route declaration: composes the danet route and request-input wiring, and
  stamps a route's process fields into `x-keep-process`.
- [The assert runtime (`#assert`)](03-the-assert-runtime-assert.md) —
  validates every input DTO and throws `RuneAssertError`, which the
  bootstrap filter maps to 422.
- [Logging, tracing, alerting](04-logging-tracing-alerting.md) — the
  backend-specific observability wiring over bedrock's substrate.
- [The docs surface — an addable module](05-the-docs-surface-an-addable-module.md)
  — the addable `DocsModule` that discovers endpoints through
  `x-keep-process` and renders them. `bootstrapServer` auto-registers it, so
  a bare `KEEP_DOCS=1` suffices there; a hand-composed Danet app registers it
  explicitly and it self-gates on `KEEP_DOCS`.
- [Composition & serving](06-composition-serving.md) — `Backend`, the
  bedrock layer that mounts the composed app under `/api/` alongside a
  frontend.
- [Package hygiene](07-package-hygiene.md) — `keep/deno.json`'s exports and
  tasks, and the JSR dependency check that gates publishing.

