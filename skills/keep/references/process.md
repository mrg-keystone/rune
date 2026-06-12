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
  with a banner naming the step and reason; fix and re-run to resume. The walk
  **scrolls the active (and any stopped) step into view but leaves every box
  collapsed** — nothing auto-expands, so the run is easy to follow; open a box
  yourself to inspect it. **Skipped** steps are excluded from the walk
  entirely — each step has a `skip` toggle, and a skipped step's state stays
  exactly where you parked it (the row renders dimmed). **Run from here** (in a
  step's Request panel) clears that step and every later step in the walk, then
  runs from it.
- A module with `flows` gets a **flow selector** that defaults to **main** —
  the untagged-only walk — so destructive branches (a teardown flow) never
  run unless explicitly selected; "All" runs everything, named flows run
  that branch plus untagged steps. Off-flow steps are hidden and don't gate.
  (The headless runner is unchanged: an unset `flow` option still means
  every endpoint.)
- A failed step whose failure the heal rules can name gets a yellow **⚠**
  dot instead of red and a **heal** panel of one-click fixes — see
  "Self-healing" below.
- Declared `$inputs` appear in the **Module inputs** card. Unset inputs show
  amber; a composed producer flips the row to a dim
  **`auto: <module>:<endpoint>`** note — satisfied from that producer's
  shared capture, no typing. A typed value overrides; clearing returns to
  auto.
- `stub: true` endpoints carry an amber **`stub`** chip.
- Dependency cycles are reported in a banner instead of leaving steps locked.
- Each step shows the concrete request it will send, the response, a
  paste-ready curl, and a **copy** button on the address bar that copies the
  route's full resolved URL. **Reset session** clears the page's state.
- **Expectations**: each step's Expect block pins an exact HTTP status and
  body checks (`path` `==`/`!=`/`contains`/`exists` `value`; values may hold
  `{{refs}}`). With expectations pinned, green means the response **meets
  them** — a 200 with a wrong body goes red (`expect ✗`), each check's
  verdict shows with the actual value, and run-all stops naming the failed
  expectation. Expectations persist with the session and ride **Save
  fixtures** into `fixtures/cake.json` — the committable contract-test layer.
- **Response diff**: re-running a step shows changed/added/removed paths vs
  the previous response (`old → new`, capped), or an explicit "unchanged vs
  previous run".

## Module setup + the `fixtures/cake.json` artifact

The cake's working session lives in `localStorage` (per page path) — ephemeral
and browser-local. Two surfaces make the deliberate configuration **durable**:

- **Module setup** — a rail card of calls that put the system in a known state
  **before** the process runs (seed a tenant, flip a flag, create a
  prerequisite). Steps can target **any composed module's endpoint**, not just
  this page's: the card's picker lists the whole app (grouped by module);
  picking a foreign endpoint generates a body whose bind refs are
  module-qualified (`{{mint:create.id}}`) so they resolve from the shared
  scope. Alternatively press **`+ setup`** in any step's Request panel to
  snapshot that request. Steps are editable in place (frozen body + params),
  reorderable, and individually runnable. **Run all** runs the setup steps
  first (in order, stopping with a banner on the first failure), then the
  normal process walk; **Run setup** fires them on their own. A local step
  runs through the page's normal send (main row updates); a **cross-module
  step writes its result into that module's session + the shared capture
  scope** (the map-write-back shape), so its outputs feed `$inputs` and
  cross-module refs immediately. In the artifact, a foreign step carries
  `module` (`{ module, id, body?, params? }`; absent = the slice's own
  module).
- **persist** — each environment variable in the Variables card has a
  **`persist`** checkbox. Ticked variables are written to the artifact.

**Save fixtures** writes `fixtures/cake.json`: this module's setup steps, its
pinned **expectations**, plus every persisted variable. It's plain, prettified
JSON meant to be committed, so a process's required setup and contract travel
with the repo. On load the cake fetches it and applies it as the baseline —
restoring setup + expectations + persisted variables even in a fresh browser
with empty `localStorage` (the saved config wins for the keys it carries). The
door is `GET`/`POST /docs/_fixtures`, **localhost-only** (same posture as
`/docs/_run` and `/_mint`); the file defaults to `<cwd>/fixtures/cake.json`
and `KEEP_FIXTURES_DIR` overrides the directory. The server needs
`--allow-write`; without it, **Save fixtures** reports a 500 with the reason.

**Scenarios — `fixtures/scenarios/<name>.json`.** The Scenarios rail card
freezes the whole walk (active flow, every step's body text + params with refs
intact, skips) under a name — one committable file per scenario. **load**
applies one over the page (overwrites editor state); **run** is load + Run
all. Saved/listed through the localhost-only `GET`/`POST /docs/_scenarios`
(same-name saves overwrite — that's updating). CI replays one headlessly with
`POST /docs/_run {"scenario":"<name>"}`: the saved flow runs with each step's
**literal** body fields as `byEndpoint` overrides; fields holding `{{refs}}`
are dropped so the runner's own bind machinery (which the refs mirror) fills
them.

## Self-healing — the heal panel and `POST /docs/_heal`

When a step fails, a **⚠ heal** panel opens under it. It works in two tiers,
by design: deterministic rules first (instant, offline, free), Claude for the
long tail the rules can't name.

**Tier 1 — the rules engine (client-side).** Every *structured* failure shape
becomes one-click fixes with Apply buttons:

| Failure shape | Offered fixes |
| --- | --- |
| unresolved `{{ref}}` / `{{$input}}` | run the step that outputs the field; set the input from an existing capture (any module's session); a plural capture (`tableNames`) feeds an element picker for the singular input (`tableName`); otherwise jump to the Module-inputs box |
| 422 assert failure (body names path + constraint) | remove an optional body key; "did you mean X?" for keys the DTO doesn't have; a required-but-unsatisfiable field reuses the missing-ref fixes |
| error slug with a **project rule** (below) | whatever the rule declares: run a prerequisite step, set/pick an input, edit the body, retry, or guidance |
| `timeout` / `unauthorized` / `rate-limited` (no project rule) | retry-with-reason |
| anything else | run the declared dependencies that aren't green |

**Project rules — `fixtures/heal-rules.json`.** Slug diagnosis is project
vocabulary, not framework knowledge (which endpoint un-blocks `not-enabled`
is *this app's* business), so keep ships no domain slugs. The project
declares them in a committed file keep loads through the localhost-only
`GET /docs/_heal-rules`:

```json
{
  "v": 1,
  "slugs": {
    "not-enabled": [
      { "kind": "run-step", "match": "/enable/i", "why": "the table must be tracked first" },
      { "kind": "pick", "target": "tableName", "fromPlural": "tableNames", "why": "pick a table that exists" }
    ],
    "not-armed": [
      { "kind": "note", "label": "Set WRITES_ARMED=1 and restart", "retryAfter": true }
    ]
  }
}
```

Rule kinds: `run-step` (`target` exact endpoint id, or `match` as
`/regex/flags` over endpoint ids), `set-input` (`target` + `value`), `pick`
(`target` + `fromPlural`, an exactly-named array field in any capture),
`remove-key` / `set-body-field` (`target`, `value`), `retry`, and `note`
(`label`, optional `retryAfter: true` adds a retry button). Every rule may
carry `why`. Unknown kinds and extra fields (e.g. rune's `todo: true`
scaffold marker) are ignored — forward compatible. When a slug has project
rules, they own it; the generic tier is only the fallback. **rune generates a
starter file** from the spec's declared fault slugs during `rune sync`
(merge-don't-clobber: hand edits and appended rules survive re-syncs).

**Tier 2 — Ask Claude.** The panel's button POSTs the failure bundle —
endpoint metadata, resolved request, response, missing refs, module inputs,
step statuses, captures (pruned/truncated), and the rule fixes already
offered — to **`POST /docs/_heal`**. The server forwards bundle + the **whole
composed process graph** (every module) to `PRIVATE_CLAUDE_URL/v1/prompt`
(the private-claude service; `PRIVATE_CLAUDE_TOKEN` adds a bearer header)
with a JSON schema, so the verdict comes back structured:

```json
{
  "diagnosis": "plain-language root cause, <120 words",
  "suggestions": [
    { "kind": "set-input", "target": "qbId", "value": "12", "why": "…" }
  ]
}
```

`kind` is one of `set-input` / `run-step-first` / `edit-body`
(machine-applicable — rendered with Apply buttons) or `switch-flow` /
`set-env` / `explain` (advice). Claude is prompted to find root causes the
rules can't — cross-module causality (a teardown step wiped state a later
module reads), real implementation bugs — and never to propose destructive
steps as runnable.

Trust posture mirrors `/_mint` and `/docs/_run`: **localhost-only** (403
otherwise), `503` until `PRIVATE_CLAUDE_URL` is configured on the server,
`502` wraps upstream errors. The upstream call can take minutes (180 s
timeout) and spends the operator's Claude plan — another reason rules run
first.

## The system map — `/docs/_map`

One page for the whole composed app: every module's endpoints as nodes in
module lanes, columns by dependency depth. Solid edges = intra-module binds;
**dashed edges** = `$input` contracts satisfied by another module's producer;
an unproduced `$name` renders as an amber badge on its consumer. Flow edges
are tinted; optional/stub endpoints carry chips. The map is **live** — node
dots recolor from cake sessions in `localStorage`, any tab. A **Run all**
button runs the whole composed process server-side via the localhost-only
`POST /docs/_run` walk; nodes pulse while it runs, then the report is
**written back into each module's cake session** (statuses, response bodies,
timings, captures — including the shared cross-module capture scope). The
cake sessions stay the one source of truth: map colors survive a reload, open
cake tabs update live via the storage event, and a cake opened afterwards has
its steps already green with responses and captures pre-filled. Clicking a
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

- Body (all optional): `{ flow?, seeds?, byEndpoint?, rateLimit?, maxIterations?, dryRun?, scenario? }`.
- `200` → `{ ok, passed[], failed[], optionalFailed[], order, cycles, iterations }`,
  where `ok = failed.length === 0 && cycles.length === 0` and every row carries
  its `module` (bare op-ids collide across composed modules) plus the response
  `body` and per-call `ms` — enough to show/replay outcomes, not just verdicts
  (the map's write-back is built on this).
- `scenario: "<name>"` replays a saved `fixtures/scenarios/` file: its flow
  (an explicit `flow` in the body wins) and each step's literal body fields as
  `byEndpoint` overrides (`{{ref}}`-holding fields are left to bind). Unknown
  name → `404`.
- `dryRun: true` → `{ order, cycles, unresolvedInputs }` with nothing executed —
  a cheap pre-flight that names dependency cycles and unsatisfied `$inputs`.
- `seeds` ride in the request body, not the browser session (a headless caller
  can't see `localStorage`); pass JSON-typed values — the runner doesn't coerce.
