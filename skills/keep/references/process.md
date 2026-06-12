# Process endpoints, the cake, the map, and the headless runner

The full reference for keep's process layer. Everything here derives from the
`x-keep-process` vendor extension that `@Endpoint` stamps into each module's
OpenAPI doc — the cake, the system map, and `exerciseEndpoints` are three
views of the same metadata.

## `@EndpointController(surface, opts?)` / `@Endpoint(opts)`

`@EndpointController("orders", { description: "Orders API" })` declares the
controller surface (the route prefix). `endpointModule("Orders",
[OrdersController])` wraps controllers into a module `bootstrapServer`
accepts. Module docs pages are named after the module class, lowercased,
without the `Module` suffix (`endpointModule("Orders", …)` → `/docs/orders`).

`EndpointOptions`:

| Option | Meaning |
| ------ | ------- |
| `method` | HTTP verb, default `"post"` |
| `path` | route segment, default: the handler method name |
| `input` / `output` | DTO classes (drive the Swagger schema AND the cake's generated request bodies) |
| `order` | process position, ascending |
| `dependsOn` | endpoint id(s) — handler method names — that must succeed first |
| `bind` | request autofill map (three value forms, below) |
| `flows` | named XOR branch(es) this endpoint belongs to |
| `optional` | attempted but never blocks the walk |
| `stub` | generated stand-in minting placeholder values (badged, excluded from "real process" reasoning) |
| `description` | endpoint description for Swagger |

The endpoint **id** is the handler method name — `dependsOn`/`bind`
references use it, and so do cake deep links (`/docs/<module>#<id>`).

`bind` value forms:

- `"otherEndpointId.outputField"` — fill this request field from that
  endpoint's captured response.
- `"$name"` — an **external input** nothing in this module produces. Shows
  under the cake's "Module inputs" card; the runner reads
  `overrides.seeds[name]`; composition auto-satisfies it (below).
- `["a.field", "b.field"]` — alternatives, first-resolvable-wins. This is the
  OR-join after a flow branch: endpoints in different flows produce the same
  field; the consumer binds to all of them.

DTO classes use either `@danet/swagger`'s `@ApiProperty()` or
class-validator decorators (`@IsString()` etc.) — both emit the
`design:type` metadata the schema builder needs.

## The cake — `/docs/<module>`

With Swagger on (the default), each module gets three pages:

| Path | What |
| ---- | ---- |
| `/docs/<module>` | the cake — a guided, ordered walk of the chain |
| `/docs/<module>/swagger` | standard Swagger UI |
| `/docs/<module>/json` | the raw OpenAPI spec (**token-gated**) |

Cake behavior worth knowing when debugging:

- Request bodies are generated from the input DTO schema. Bound fields hold
  **`{{step.field}}` references resolved at send time** — hand edits are
  never overwritten by a capture; the reference just resolves when sent.
- Reference forms: `{{step.field}}` (this page's captures), `{{name}}` (a
  shared user variable), `{{$name}}` (a declared module input),
  `{{module:step.field}}` (another module's capture), `{{a || b}}`
  (alternatives). Resolution is recursive (depth-capped).
- **Resolved body fields are coerced to their declared schema type.** After
  substitution, a top-level field whose DTO type is integer/number/boolean/
  object is coerced from a clean string form — so `"qbId": "{{$qbId}}"` is sent
  as a number however the value arrived (typed input, capture, env var), and the
  template stays strict JSON (refs stay quoted). The **Module inputs** card
  renders a number widget (storing a real number) for `$inputs` whose consumers
  are all numeric. The headless runner and `seeds` are **not** coerced — pass
  JSON-typed values there.
- Every successful run **captures outputs** into a live variables panel and
  also publishes them cross-module (`{{module:step.field}}`). Variables and
  captures are shared across all docs pages via `localStorage`, and a
  `storage` listener live-updates other open tabs.
- **Run all in order** walks the active flow and stops at the first failure
  with a banner naming the step and reason; fix and re-run to resume.
- A module with `flows` gets a **flow selector**; off-flow steps are hidden
  and don't gate.
- Declared `$inputs` appear in the **Module inputs** card. Unset inputs show
  amber; a composed producer flips the row to a dim
  **`auto: <module>:<endpoint>`** note — satisfied from that producer's
  shared capture, no typing. A typed value overrides; clearing returns to
  auto.
- `stub: true` endpoints carry an amber **`stub`** chip.
- Dependency cycles are reported in a banner instead of leaving steps locked.
- Each step shows the concrete request it will send, the response, and a
  paste-ready curl. **Reset session** clears the page's state.

## The system map — `/docs/_map`

One page for the whole composed app: every module's endpoints as nodes in
module lanes, columns by dependency depth. Solid edges = intra-module binds;
**dashed edges** = `$input` contracts satisfied by another module's producer;
an unproduced `$name` renders as an amber badge on its consumer. Flow edges
are tinted; optional/stub endpoints carry chips. The map is **live** — node
dots recolor from cake sessions in `localStorage`, any tab. Clicking a
node deep-links to `/docs/<module>#<endpointId>` with that step expanded.
(Underscore-prefixed so a module named "map" can still own `/docs/map`.)

## Dev mode — `KEEP_DEV` and `/docs/_dev`

Set `KEEP_DEV=<status-file path>` and `bootstrapServer`:

- serves `GET /docs/_dev` → JSON `{ bootId, ...statusFileContents }` (any
  read/parse failure degrades to `{ bootId }` alone);
- injects a poller into every cake/map page: polls `_dev` while the page
  is visible, **reloads on a changed `bootId`** (a new process is serving),
  renders status-file `errors` in the page banner, shows "server
  restarting…" while unreachable, and stops permanently on a 404 (prod
  guard).

Session state lives in `localStorage`, so statuses/captures/edits survive the
reload. `rune dev` drives this channel: watch → re-check/re-sync the spec →
restart the app under `KEEP_DEV` → pages reload themselves.

## `exerciseEndpoints(opts)` — the headless runner

Discovers endpoints from the bootstrapped app's docs (ALL composed modules),
orders them (`order` + `dependsOn`, topological), runs them chaining outputs
into inputs via `bind`, and loops until green (or `maxIterations`).

```ts
const report = await exerciseEndpoints({ api });
// { passed, failed, optionalFailed, iterations, order, cycles, unresolvedInputs }
// each result row: { id (bare op-id), module, method, path, status, attempts, … }
```

Options:

- `api` — the bootstrapped app. With no `baseUrl`, requests dispatch
  in-process via `backend.fetch` (no port, bypasses auth) — the default for
  tests/CI.
- `baseUrl` — run over real HTTP against a live server. Uses Playwright's
  `APIRequestContext` (HTTP client, not a browser) — Playwright must be
  provisioned (`deno run -A npm:playwright install`) for this path only.
- `flow` — walk one named branch (plus untagged endpoints).
- `overrides.seeds` — literal values by **field name**; the first resolution
  source for both plain fields and `$inputs`. A seed always wins.
- `overrides.byEndpoint` — per-endpoint body overrides by id; win over
  `bind`.
- `overrides.auth` — `{ kind: "in-process" }` (default), or
  `{ kind: "token" | "mint", … }` for network runs (mint uses `signToken`
  with `MANUAL_KEY`).
- `rateLimit` — `{ requestsPerSecond?, maxConcurrency? }`.
- `maxIterations` — default 5.
- `dryRun` — build `order` / `cycles` / `unresolvedInputs` (external `$inputs`
  with no seed and no producer) without sending a request; the run loop is
  skipped and `passed`/`failed` come back empty.

`$name` resolution order: `seeds[name]` → first captured response (run
order) owning a same-named field, from any composed module. The runner adds
a **synthetic dependency edge** consumer→producer so producers run first and
the fallback hits on pass one. `failed` excludes `optional` endpoints (those
land in `optionalFailed`).

Composition acceptance pattern (proves the snap-together contract — this is
keep's own e2e pattern):

```ts
const api = await bootstrapServer("checkout", [membersModule, httpModule]);
const report = await exerciseEndpoints({ api, flow: "card" }); // NO seeds
assertEquals(report.failed.map((r) => r.id), []);
// producer ordered before consumer:
assert(report.order.indexOf("create") < report.order.indexOf("start"));
```

## Headless run over HTTP — `POST /docs/_run`

The localhost-only HTTP door to `exerciseEndpoints` — so an agent, CI, a smoke
check, or the map UI can ask a *running* server "does the whole composed process
work right now?" without importing the app. Same trust posture as `/_mint`:
loopback socket only; in-process dispatch (no conn info) is denied; `503` until
the in-process backend exists.

- Body (all optional): `{ flow?, seeds?, byEndpoint?, rateLimit?, maxIterations?, dryRun? }`.
- `200` → `{ ok, passed[], failed[], optionalFailed[], order, cycles, iterations }`,
  where `ok = failed.length === 0 && cycles.length === 0` and every row carries
  its `module` (bare op-ids collide across composed modules).
- `dryRun: true` → `{ order, cycles, unresolvedInputs }` with nothing executed —
  a cheap pre-flight that names dependency cycles and unsatisfied `$inputs`.
- `seeds` ride in the request body, not the browser session (a headless caller
  can't see `localStorage`); pass JSON-typed values — the runner doesn't coerce.
