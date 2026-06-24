---
name: "rune:docs"
description: >-
  The Swagger/Danet OpenAPI documentation surface of a rune-generated keep
  backend: set up the docs, and make a generated swagger doc more specific and
  useful per endpoint. Covers how DTO classes drive the schema (`@ApiProperty`
  and class-validator both emit the `design:type` the builder reads), the
  `[TYP:example=V]` modifier → `@ApiProperty({ example })` and why a required
  unbound field needs an example (else a guaranteed 422 in any walk), the three
  per-module pages `/docs/<m>` / `/docs/<m>/swagger` / `/docs/<m>/json` (the JSON
  is token-gated), the `@docs <url>` line on a `[SRV]` surfacing as an `@see`
  JSDoc tag on the generated adapter method, the smaller swagger exports
  (`@SwaggerDescription`, `DanetDocumentBuilder`, `setupWithSwagger`), and a
  summary of the browser docs-access token flow. Trigger when the user says "the
  swagger docs for this endpoint need a better example", "set up / customize the
  API docs", "the OpenAPI example is wrong", "document this endpoint", or names
  `@ApiProperty`, `example=`, `/docs/<m>/swagger`, `/docs/<m>/json`, or "@docs
  url". NOT the interactive cake walk at `/docs/<m>` (run/exercise the endpoints,
  red walk, heal) → use `rune:cake`; NOT the auth/trust posture on the docs
  routes (who may read `/json`, localhost/token rules) → use `rune:framework`;
  NOT the `[SRV]` declaration or the `@docs` REQUIREMENT itself, nor the
  `example=` modifier as a spec construct → use `rune:spec`.
---

# rune:docs — the Swagger/Danet documentation surface

The OpenAPI docs a rune-generated keep backend serves, and how to make them
sharper. The schema is **derived from your DTO classes** — you tune it by
tuning the spec's `[TYP]`/`[DTO]` declarations, not by hand-editing generated
code.

## This skill vs its siblings

- **`rune:spec`** — author/edit the `.rune` DSL itself: the `[TYP:example=V]`
  modifier as a spec construct, the `[SRV]` block, and the `@docs <url>`
  *requirement*. You change a swagger example by editing the spec there; come
  here to know *where it surfaces* and *what to set it to*.
- **`rune:build`** — `rune sync` (the codegen that emits the DTO classes,
  decorators, and `@ApiProperty` from your spec), filling bodies, the test
  fleet, lint.
- **`rune:framework`** — the runtime that serves the docs routes and the trust
  posture on them (who may read `/docs/<m>/json`, localhost/token rules); its
  `references/auth.md` owns the docs-access *trust model*. This skill only
  summarizes the browser token flow.
- **`rune:cake`** — the interactive page at `/docs/<m>`: the guided ordered
  walk, Emulate/Run-all, expectations, scenarios, heal, `/docs/_map`. That's
  exercising the app; this skill is the *static OpenAPI/swagger doc* the same
  module also publishes.
- **`rune:docs`** (you are here) — the Swagger UI + raw OpenAPI spec, per-endpoint
  examples and descriptions, the `@docs`→`@see` adapter JSDoc, and the
  doc-setup exports.

## The three pages per module

With Swagger on (the default), each composed module gets three pages, named
after the module class lowercased without the `Module` suffix
(`endpointModule("Orders", …)` → `/docs/orders`):

| Path | What | This skill |
| ---- | ---- | ---------- |
| `/docs/<module>` | the cake — a guided, ordered walk of the chain | defer to **`rune:cake`** |
| `/docs/<module>/swagger` | standard Swagger UI | **you own** |
| `/docs/<module>/json` | the raw OpenAPI spec (**token-gated**) | **you own** |

The `/json` page is the only gated one — doc *pages* load publicly, the
OpenAPI *spec* is served only to a genuine loopback caller or a valid token.
See `references/swagger.md` for the browser token flow that feeds it, and
defer the full trust posture (in-process bypass is NOT honored on docs, the
401-wipes-token rule) to **`rune:framework`**'s `references/auth.md`.

## How the schema gets built

Everything in the swagger doc derives from the `@Endpoint`'s `input`/`output`
DTO classes plus the metadata `x-keep-process` that `@Endpoint` stamps. The
DTO classes carry the schema because their fields are decorated — and **both**
`@danet/swagger`'s `@ApiProperty()` and class-validator decorators
(`@IsString()` etc.) emit the `design:type` reflection the schema builder
reads. You don't choose one or the other: rune's codegen emits the validators
(from `[TYP]` constraint modifiers) and merges everything documentable into a
single `@ApiProperty({…})` umbrella per field (description, example, required,
isArray, minimum/maximum, format, minLength, enum, binary).

You make a doc more specific by enriching the **spec**, then `rune sync`
(see **`rune:build`**) regenerates the DTOs:

- a `[TYP]` description becomes the field's `@ApiProperty({ description })`;
- `[TYP:example=V]` becomes `@ApiProperty({ example: V })`;
- `[TYP:uuid|email|url]` becomes `format: "uuid"|"email"|"uri"`;
- `[TYP:min=N,max=N]` becomes `minimum`/`maximum`; `(s)` → `isArray: true`;
  `?` → `required: false`.

The full mapping (and the maximal "every discarded AST field becomes a
doc-comment" story — `[NON]` descriptions, faults as `@throws`, `[TYP]`
descriptions on DTO fields) lives in
`/Users/raphaelcastro/Documents/programming/rune/lang/docs/codegen-enrichment.md`
— point at it rather than reproducing it.

## The example that prevents a 422

`[TYP:example=V]` is **not a validator** — it emits the swagger example that
the runtime's headless runner and the cake fill required, unbound input fields
from. A required field with no producer, no `bind`, and no example is a
**guaranteed 422 in any headless walk** (`rune sync` warns about exactly those
fields). So a good per-endpoint example is not cosmetic: it is what lets the
cake/runner construct a valid request body at all. Pick a realistic value
typed by the declared primitive (`[TYP:example=3,min=1] qty: number` →
`example: 3`). When a red walk blames a missing example, the fix is a spec
edit — see **`rune:cake`** for diagnosing the walk, **`rune:spec`** for the
`example=` syntax.

## `@docs <url>` → `@see` on the adapter

Every `[SRV]` in `src/core/core.rune` requires an `@docs <url>` line (the
requirement and the `[SRV]` block itself belong to **`rune:spec`**). Its
payoff lives here: codegen surfaces that url as an **`@see <url>` JSDoc tag on
the generated data-adapter method**, so a dev hovering the adapter call jumps
straight to the backing service's API docs. That is the doc-surface half of
the `[SRV]` story — the URL the spec demands is what becomes navigable IDE
documentation.

## Setting up / customizing docs (the exports)

Swagger is on by default through `bootstrapServer`. The lower-level knobs:

- `setupWithSwagger(server)` — configure an existing `Server` with the Swagger
  routes, **without starting it**.
- `@SwaggerDescription(text)` — a module-level Swagger description.
- `DanetDocumentBuilder` — the lower-level OpenAPI builder (and `Server`, the
  registry) when you need to construct the doc by hand.

`@Endpoint`'s `description` option (and `@EndpointController(surface,
{ description })`) sets the endpoint/controller description text in the doc.
`bootstrapServer` is bundler-safe — it lazy-loads the Swagger builder and its
CJS `handlebars` dep, so importing the backend from Fresh works in both `deno
task dev` and the production build.

See `references/swagger.md` for the consolidated detail: the DTO→schema
mechanics, the full `@ApiProperty` merge, the browser docs-access token flow,
and the doc-setup exports.
