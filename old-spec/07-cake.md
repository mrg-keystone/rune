# The Cake, the System Map, and the Headless Runner

> Part of the [project spec series](README.md). Source:
> `keep/src/foundation/domain/business/{emulator-ui,map-ui,trace-ui,
> fixtures-store,heal,endpoint-spec,process-graph}/` and
> `keep/src/foundation/domain/coordinators/exercise-harness/`. These are the
> self-verification surfaces built on the `x-keep-process` metadata
> ([06-runtime.md](06-runtime.md)), shipped as the addable **`DocsModule`**
> (below).

With the docs module added, every module gets three docs pages:

| Path | What |
| --- | --- |
| `/docs/<module>` | the **cake** — a Postman-style guided walk of the module's process |
| `/docs/<module>/swagger` | standard Swagger UI |
| `/docs/<module>/json` | the raw OpenAPI spec |

**Every `/docs/*` route is open** — no auth, no bearer, no gate. keep is
auth-agnostic (the runtime enforces nothing; [06-runtime.md](06-runtime.md)),
and the docs surface is no exception: a browser can always load any page, and
every `/docs/_*` data door (`_run`, `_fixtures`, `_scenarios`, `_heal`,
`_heal-rules`, `_traces`, `_dev`) answers any caller. The cake and map render
from data **inlined into the shell server-side**: the cake embeds
`{ title, endpoints, cycles, producers, appEndpoints }` as
`window.__KEEP_EMULATOR__`, the map its whole positioned graph
`{ app, nodes, edges, lanes, flows, width, height }` as `window.__KEEP_MAP__`
— neither page fetches anything to render. Everything else the pages need,
they fetch straight off the open doors: the cake fires live endpoint calls
(steps and setup steps), generates paste-ready curl, and links the raw
OpenAPI JSON; the Swagger page fetches its spec — all uncredentialed, because
nothing on the surface asks for a credential. The runner's `api` option
carries the same in-process `backend.fetch` client `bootstrapServer` returns
as the headless path to the same walk.

With no gate in the way, every page-side feature the data doors back works
end to end: the fixtures on-load baseline and **Save fixtures**, the
**Scenarios** card, heal tiers 2–3, the map's **Run all** (and its live
write-back into cake sessions), and the `/docs/_trace` page's data. (These
were dead in the pre-module build, where a control-plane gate the pages
couldn't satisfy blocked their own fetches; the gate is gone.) The opt-in
browser suite (`emulator-ui/browser.test.ts`, `KEEP_BROWSER=1`), which
expects uncredentialed browser saves and restores to succeed, now passes as
written.

## The docs module (`DocsModule`)

The docs surface is **not hardwired into `bootstrapServer`** — it is an
addable Danet module. Import **`DocsModule`** into your Danet app and it
auto-wires the whole `/docs/*` tree: the per-module cake (`/docs/<m>`),
Swagger, the raw OpenAPI JSON, the system map (`/docs/_map`), the headless
runner door (`/docs/_run`), the trace waterfall page (`/docs/_trace`) and its
data door (`/docs/_traces`), fixtures (`/docs/_fixtures`), scenarios
(`/docs/_scenarios`), heal (`/docs/_heal`, `/docs/_heal-rules`), and the docs
index (`/docs`).

It is **opt-in and OFF by default**, gated behind the env var **`KEEP_DOCS`**.
Turn it on either by adding `DocsModule` to your app's module imports, or by
setting `KEEP_DOCS` (which `bootstrapServer` honors by registering the module
for you); with neither, no `/docs/*` route exists — the production default,
so the cake never ships to prod unless you opt in. The module pulls its
dependencies from DI: the app's OpenAPI/process metadata (the `docs` object),
the in-process backend client (for `/docs/_run`), and the fixtures, scenarios,
heal, and tracer stores. The UI shell builders and handler factories are
already standalone pure functions — only the wiring moves into the module.

## The cake (`/docs/<module>`)

An interactive, self-contained HTML page listing the module's endpoints in
process order. Each step shows the concrete request it will send (body
generated from the DTO schema, bound fields holding `{{step.field}}`
references resolved against captured responses at send time), the response, a
paste-ready curl, and a full-URL copy. Running a step drops a checkmark with
status + timing, captures its outputs into a live variables panel, and unlocks
its dependents; re-running shows a **diff against the previous response**.
**Run all in order** walks the chain and stops at the first failure with a
banner saying where and why. Each step row also carries a **skip** toggle:
a skipped step is excluded from the Run-all walk entirely — its status and
captures stay exactly where you parked them (dependents still gate on that
parked status, and its individual Run button still fires it). When that
parked status is not green, Run all does **not** pass over the dependents:
the walk halts at the first not-yet-green dependent with the
"Stopped — … is waiting on …" banner naming the skipped step, exactly as for
any other unmet dependency (a dependent already green stays green and is
walked past). Skips are what
the map's Run all forwards (module-qualified) as the runner's `skip` list and
what scenarios freeze per step. Flows get a selector — one branch at a time, plus **All** and **main**, the
untagged-only pseudo-flow (stored as `__main`), the default whenever flows
exist, so destructive branches never run unless explicitly selected;
declared `$inputs` appear on a **Module inputs** card; dependency cycles are
called out in a banner.

Reference resolution in bodies: `{{step.field}}` (page captures), `{{name}}`
(shared variables), `{{$name}}` (module inputs), `{{module:step.field}}`
(another module's capture), `{{a || b}}` (alternatives) — recursive,
depth-capped. Shared variables are user-created in the **Variables** panel
(applied heal fixes write them too — captures are a separate scope, never
auto-copied in), shared across every docs page, and saved into the fixtures
file only when marked `persist`. Precedence: a token that exactly matches a
variable name resolves as the variable before anything else — so a variable
shadows a same-named capture path — and an explicitly set variable beats a
`$input`'s auto producer.

> **[DECIDE]** When a `$input` has *both* an explicitly typed Module-inputs
> value and a same-named shared variable, which one wins? This doc states
> each beats the auto producer (this paragraph for the variable, the
> cross-module auto-wiring section for the typed value) but never orders the
> two against each other. Recommended default: the explicitly typed
> Module-inputs value wins — it is a deliberate, per-input override a builder
> set on that exact field, whereas the variable is a page-wide default that
> should yield to it, matching the general pattern that the more specific
> source wins.

Session state lives in `localStorage` under two
kinds of key. Per module, `keep:emulator:<page path>` (e.g.
`keep:emulator:/docs/orders`) holds everything page-local: statuses,
captures, response metas, edited bodies, param values,
skips, setup steps, pinned expectations, previous responses (for the diff),
the flow choice, and expanded rows — these per-module keys are what the
map's status dots recolor from. One shared key, `keep:emulator:globals`,
holds the cross-page scope: shared variables, their `persist` flags, and
module-qualified captures (`"<module>:<endpointId>"` → response body,
published on every successful run) — what `{{module:step.field}}` and
cross-module `$input` auto-fill read. Both survive reloads and `rune dev`
restarts. **Reset session** starts fresh (clearing this module's session key
and its module-qualified captures from the shared scope; shared variables
stay).

**Cross-module auto-wiring:** when any endpoint in the composed app mints a
declared `$input`'s field — exactly, or as its plural collection (the literal
`name + "s"`, no linguistic pluralization; `$tableName` ← `tableNames[0]`,
first element, scalars only) — the Module-inputs row shows
`auto: <module>:<endpoint>` and satisfies itself from that producer's capture;
an explicitly typed value always overrides that auto-fill (its precedence
against a same-named shared variable is the open question marked above).
Producers are discovered
**statically** from the schemas' declared output fields; when several
endpoints mint the same field, the first encountered walking the composed docs
(module order, then declaration order) wins, exact-field producers before
plural ones, and a consumer never counts as its own producer. An **echo** — an
endpoint whose output field is also one of its own input or bound fields —
never counts as a producer (it can't bootstrap a value; at run time an echo's
capture still resolves references). The cake's index (which the map's dashed
edges mirror) keeps only the first-encountered producer per field and applies
**no downstream exclusion**; the headless runner indexes every producer and
skips those already downstream of the consumer (see its `$`-input resolution
order) — so when the first-encountered producer transitively depends on its
consumer, the `auto:` label names that producer while the runner orders a
later one first (or none). Stub endpoints (ghost stubs,
[04-codegen.md](04-codegen.md)) carry an amber `stub` chip and produce like
any other.

### Expectations — green means *right*, not just 2xx

Every step has an **Expect** block: pin an exact status plus body checks
(`path == / != / contains / exists value`, values may hold `{{refs}}`). With
expectations pinned, a 200 with a wrong body turns the step red (`expect ✗`)
and stops Run all with the failing check named. Expectations ride **Save
fixtures** into `spec/misc/cake.json` — a committed artifact. Both the save
and the on-load restore are page logic on the open `/docs/_fixtures` door, so
the "clone, open, Run all" contract-test replay works from a browser. No
**headless** path replays the artifact, though — neither `exerciseEndpoints`
nor `POST /docs/_run` reads `cake.json`, and a runner step passes on any 2xx
(pinned checks are evaluated only by the page) — so headlessly the pinned
expectations don't apply.

### Module setup & `spec/misc/cake.json`

The **Module setup** rail card holds durable setup steps — calls that put the
system in a known state before the walk (seed a tenant, create a prerequisite
record) — targeting **any endpoint in the composed app**. Run setup fires them
all; Run all runs setup first. **Save fixtures** POSTs this page's patch —
`{ module, setup, asserts, variables }`, where `variables` is the complete
persisted-variable set (that scope is shared by every docs page, so any page
holds the whole picture) — to `/docs/_fixtures`. The door **merges** a posted
patch into the artifact re-read from disk: `variables` is replaced wholesale,
`modules[<m>]` is replaced by the posted slice, and **every other module's
slice is kept**. On disk the artifact is
`{ v: 1, variables, modules: { <m>: { setup, asserts } }, savedAt }` in
`spec/misc/cake.json` (door: `GET/POST /docs/_fixtures`). A `setup` entry is
`{ id, module?, body?, params? }` — bare endpoint id, the owning module when
it is **not** the slice's own (absent ⇒ the slice's module; this is how setup
targets any composed endpoint), body **text** (refs intact, resolved at send
time), and path/query param values by name — the same frozen-request shape as
a scenario step, plus `module`. `asserts` maps endpoint id →
`{ status?, checks }`: the exact expected status as text (`"200"`;
empty/absent ⇒ any 2xx) plus checks `{ path, op, value? }` — a dot path into
the response body, an op from the Expect block's `==` / `!=` / `contains` /
`exists` (unknown ops are kept for forward compat but fail closed), and the
expected value as text (may hold `{{refs}}`, resolved at evaluation time).
Normalization on read drops setup entries without a string `id`, checks
without a string `path` and `op`, and assert specs left with neither a status
nor a check. One **fixtures
directory** holds `cake.json`, `heal-rules.json`, and `scenarios/`; it
resolves to the nearest git root's `spec/misc` when that root has a `spec/`,
else `<cwd>/spec/misc` when the cwd has one, else the legacy `<cwd>/fixtures`
— which is then read *and* written, not a read-only fallback.
`KEEP_FIXTURES_DIR=<dir>` overrides the directory wholesale (so
`$KEEP_FIXTURES_DIR/cake.json`, `…/heal-rules.json`, and `…/scenarios/`
relocate together). On load the cake fetches the artifact and applies it as the
baseline: its persisted variables, this module's setup, and its pinned
expectations **overwrite the local session's versions of exactly those keys**
(the committed file wins over local edits; statuses, captures, edited
bodies, and skips stay local) — restoring a fresh session from the file alone.
That fetch hits the open `/docs/_fixtures` door and the baseline applies. Any
caller can read and write the artifact through the door, but the
apply-as-baseline logic lives only in the page.

### Scenarios — record and replay whole walks

The **Scenarios** card freezes an entire walk — active flow, every step's body
and params (refs intact), skips — one JSON file per scenario under
`spec/misc/scenarios/` (door: `GET/POST /docs/_scenarios`). The card lists
saved scenarios, and *load* (apply one), *run* (load, then Run all), and save
all work from the browser off the open door. Headless replay works too: CI
replays one with `POST /docs/_run {"scenario": "happy-path"}`, which reads the
file server-side (see the runner).

A scenario file — the artifact CI can hand-author — is
`{ v: 1, name, module, flow?, steps, savedAt? }`, where `module` is the
owning docs path segment, `flow` is the walk's flow name (absent = all), and
each `steps` entry is `{ id, body?, params?, skip? }`: bare endpoint id,
body **text** (refs intact, resolved at send time), path/query param values
by name, and the frozen skip toggle. It lives at
`spec/misc/scenarios/<slug(name)>.json` (the name lowercased with non-
alphanumerics collapsed to `-`; same-name saves overwrite). A file missing
`name` or `module` is ignored on read; steps without a string `id`, and any
other fields, are dropped by normalization.

### The heal panel

When a step fails, heal takes over, in tiers. Every tier renders one-click
suggestions: action kinds render behind an **Apply** button — nothing
auto-executes — while guidance kinds (`note` without `retryAfter: true`, and
Tier 3's `switch-flow` / `set-env` / `explain`) render as guidance text with
no Apply. Run all never auto-resumes after a heal: the banner tells you to
fix and press **Run all in order** again (it resumes from the first
non-green step). Tier 1 is
keep's built-in generic diagnosis (missing inputs, validation shapes,
transient retries). Tier 2 is the project's declarative rules from
`spec/misc/heal-rules.json` (rune generates the starter file from the spec's
fault slugs; served at `GET /docs/_heal-rules`, fetched once at page load):
error slug → suggestions, where
the slug is the failing response's `body.message` used verbatim as the
lookup key (exact string equality — no substring or regex matching). The
lookup is gated: it only fires when `body.message` is kebab-case-shaped
(matches `/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/`) or is exactly `timeout` or
`unauthorized`; a message with spaces/uppercase or a single hyphenless word is
never consulted even if a rule's key equals it — rune-generated slugs are
kebab-case by convention, so this rarely bites. The suggestion kinds:
`run-step` offers to run a not-yet-green endpoint (`target` exact id, or
`match` — a `"/regex/flags"` or bare substring — over ids), `set-input` sets a
shared variable (`target`, `value`), `pick` offers the string/number elements of the
`fromPlural` array field as a dropdown — aggregated across **every** capture
holding it (this page's captures first, then the shared module-qualified
captures, each in insertion order; at most 30 elements read per array;
duplicates collapsed) — Apply writes
the picked element into the **shared variable** named `target` (no body
field is touched), `retry` re-sends the failing step (retry-kind slugs also feed
`/docs/_run`'s transient retries), and `note` is guidance text
(`label`/`why`; `retryAfter: true` appends a Retry offer); `remove-key`
deletes the top-level body key named `target`, and `set-body-field` sets
top-level body key `target` to `value` — both re-send the step on Apply;
unknown kinds are ignored (forward compat). Any rule may carry `why`,
rendered beside its label.
Tier 3 is the long tail: **Ask Claude** — `POST /docs/_heal` forwards the
failure bundle plus the whole composed process graph to a private Claude
service (`PRIVATE_CLAUDE_URL`; 503 when unset — with an optional
`PRIVATE_CLAUDE_TOKEN` sent as a `Bearer` authorization header when set,
omitted otherwise), returning
`{ diagnosis, suggestions[] }` whose kinds map onto the same client actions:
`run-step-first` → run-step, `edit-body` → set-body-field (same
`target`/`value` shape), `set-input` as itself; `switch-flow` / `set-env` /
`explain` render as guidance with no Apply.

## The system map (`/docs/_map`)

The whole composed app as one process graph: every module's endpoints as
nodes in module lanes, ranked left-to-right by dependency depth. The graph
and its layout are computed server-side and inlined into the shell as
`window.__KEEP_MAP__` — the client only draws, fetching nothing to render.
Solid edges are intra-module binds; **dashed edges**
are `$input` contracts satisfied by another module's producer; an unproduced
`$name` is an amber badge on its consumer. Flows tint edges;
optional/stub endpoints carry chips. The map is **live**: node status dots
recolor from the cake sessions in `localStorage` (any tab). Its **Run
all** POSTs `/docs/_run` with
`{ stream: true, orderBy: "module", flow: "__main" }` (the untagged-only
pseudo-flow — the cake's default walk) plus the sessions' seeds (literal
shared-variable values) and skips. Each streamed result is written back into
that module's cake session as it lands — already-open cake tabs updating live,
a cake opened afterwards finding its steps green with responses pre-filled,
failed steps deep-linking into their cake step with the heal panel lit. A
headless caller (curl, CI) hitting the same door gets the same ndjson stream
but runs no page, so that write-back has no executor.
Clicking a node deep-links
`/docs/<module>#<endpointId>`. (Underscore-prefixed so a module named "map"
can still own `/docs/map`.)

## The headless runner — `exerciseEndpoints(opts)`

The same metadata, run programmatically
(`coordinators/exercise-harness/mod.ts`): discovers endpoints from
`api.docs` (below), orders them topologically (`order` tie-break), runs
them while chaining outputs into inputs via `bind`, rate-limits, and loops
until green (default `maxIterations: 5`; each pass re-runs **only the
not-yet-green endpoints** — passed steps are never re-sent, so non-idempotent
POSTs don't repeat — and the loop stops early once a pass makes no new
progress). Optional endpoints ride the same loop: a failed optional counts as
not-yet-green (re-sent every pass, and its failure is not progress — so
persistent optional failures alone hit the early stop, never spin out the
iteration cap), and it locks nothing — the runner has no step gating, so
dependents still fire each pass and fail only while their binds can't
resolve without its capture. In the report its failure lands in
`optionalFailed`, never `failed` — an empty `failed` means the process
works, optional failures notwithstanding. Report:
`{ passed, failed, optionalFailed, iterations, order, cycles,
unresolvedInputs }` with per-row
`{ id, module, method, path, ok, optional, status, attempts, error, ms, body }`
(`optional` is always present and load-bearing — it's what routes a row into
`optionalFailed` vs `failed`; `error` is the failure string when a row didn't
go green). `order` and
each `cycles` component list **bare** operationIds (working ids stripped back
to their operationId), so under composition a duplicated id can appear more
than once with nothing disambiguating it there — the per-row `module` column
exists only on result rows.
`unresolvedInputs` is a sorted list of `$`-prefixed names — every external
`$`-input referenced by some bind that no seed covers and no composed
producer mints (neither the exact field nor its `name + "s"` plural; echoes
never count): nothing will satisfy them. It is computed statically before any
request fires and included in every report.

- **`api`** (required) — `{ backend, docs }`, the relevant slice of a
  `bootstrapServer(...)` return: `docs` is the sole discovery source (there
  is no over-HTTP discovery — a `baseUrl` run still needs the locally
  bootstrapped app's docs), `backend` the in-process `fetch` client.
- **Transport** — no `baseUrl` → in-process via `api.backend.fetch` (no port,
  no auth; the CI default). With `baseUrl` → real HTTP via Playwright's
  `APIRequestContext` (Playwright is an optional peer, loaded only then);
  endpoint metadata still comes from `api.docs`.
- **`rateLimit`** — `{ requestsPerSecond?, maxConcurrency? }` (defaults 20
  and 4): a minimum spacing between request starts plus an in-flight cap;
  every call, retries included, runs under it.
- **`overrides`** — a literal key nesting `{ seeds?, byEndpoint?, auth? }`:
  `seeds` (literal values by field name), `byEndpoint` (keyed by bare
  operationId; wins over seeds and bind — and because the key is bare while
  working ids are module-qualified, one entry applies to **every** composed
  endpoint sharing that operationId, in every module), `auth` (`in-process`
  default, or any request auth the target app happens to expect on a network
  run — keep itself requires none). `/docs/_run`'s body takes `seeds`/
  `byEndpoint` flat and nests them itself.
- **`maxIterations`** — the green-loop cap (default 5, as above).
- **`skip`** — module-qualified working ids (`"<module>:<operationId>"`)
  excluded from the walk entirely: skipped endpoints appear nowhere in the
  report, and steps depending on them simply fail while their binds can't
  resolve (the runner has no step gating). Note the id asymmetry: `skip`
  takes working ids because operationIds aren't unique across composed
  modules, while `byEndpoint` (and the report's `id` column) use the bare
  operationId, with the report's `module` column disambiguating. `operationId`
  (the OpenAPI term, used throughout this section) and the cake/map's
  `endpointId` name the same identifier and share one key space: a working id
  `"<module>:<operationId>"` here is exactly the cake's module-qualified
  capture key `"<module>:<endpointId>"` and the map's deep-link
  `<module>#<endpointId>`, which is why the map's Run all can forward its
  skipped steps straight into the runner's `skip` list and why runner result
  rows write back into the matching cake session unmodified.
- **`flow`**, **`orderBy`**, and **`dryRun`** are the same-named options
  `/docs/_run` forwards — their semantics are specified once, under the door
  below.
- **`onResult`** — `(result) => void`, the per-result streaming hook: called
  with a **snapshot** of an endpoint's report row (never the live object, so
  later iterations can't mutate what was streamed) each time its call settles
  — once per endpoint per pass (transient retries within a pass collapse into
  that one emission; a step re-run on a later iteration emits again). Not a
  door option — an HTTP body can't carry a callback; `/docs/_run`'s
  `stream: true` is its door-side correspondence: the door supplies its own
  `onResult` that writes each snapshot as an ndjson `result` line.
- **`$`-input resolution order** — seed first; else **composition fulfills the
  contract**: at run time the first captured response *in run order* owning a
  same-named field — else the first owning the `name + "s"` collection, whose
  first element supplies the value (scalars only, same rule as the cake: a
  non-scalar first element yields nothing; no scan for a later scalar) —
  fills it. Producer discovery is
  static (the schemas' declared output fields, before any request fires;
  exact-field producers considered before plural ones): the runner adds a
  synthetic dependency edge to the first producer that is neither the
  consumer itself nor already downstream of it — the downstream exclusion the
  cake's `auto:` index lacks — so the producer runs first; when no producer
  survives that filter, no edge is added and the run-time capture fallback
  above still applies. Echoes (as defined for the cake) never count as
  producers. A composed app with stub or real producers needs no seeds at
  all.
- Required fields with no seed/bind fill from their schema `example` (typed
  zeros count; the empty-string placeholder doesn't) — matching the cake's
  generated bodies.
- **Transient retries** — `retry: { slugs, delayMs?, attempts? }`; a failure
  whose `body.message` **exactly equals** a slug (whole-string equality — no
  substring or regex matching; a non-string or absent `message` never
  matches) is re-attempted after `delayMs` (default 800) up to `attempts`
  (default 3) extra times. `/docs/_run` derives
  slugs from the project's heal rules plus built-ins (`timeout`,
  `rate-limited`) — heal knowledge feeds the runner, not just the UI. With
  `retry`, the members above are the whole of `ExerciseOptions` — it has no
  others.

`POST /docs/_run` is the HTTP door to the same walk:
`{ flow?, seeds?, byEndpoint?, rateLimit?, maxIterations?, dryRun?, scenario?,
orderBy?, skip?, stream? }`. `rateLimit` takes the runner's
`{ requestsPerSecond?, maxConcurrency? }` shape. `flow` is one name filtered
across **every**
composed module: endpoints tagged with other flows are excluded, untagged
endpoints (part of every flow) stay — so same-named flows in several modules
all match, and there is no per-module flow selector here. `__main` is not
special-cased: the pseudo-flow rides this same filter — untagged endpoints
stay, tagged endpoints are excluded unless a module literally declares a flow
named `__main` (the cake's selector already reserves that name, so by
convention none does) — yielding the cake's untagged-only default walk. `dryRun` returns
just `order`/`cycles`/`unresolvedInputs` (as defined in the runner's report
above); `orderBy: "module"` walks
lane-by-lane: modules in docs order, each lane internally in topological
order. Lane order beats every dependency edge — synthetic `$`-input edges
included (they are added before ordering and are never dropped, but only
break ties within a lane) — so a consumer whose surviving producer lives in
a later module lane runs first, fails that pass, and goes green on a later
iteration once the producer's capture exists; `stream: true` returns ndjson (one result line per call, then a
done summary — what the map consumes). `scenario` replays a saved
`spec/misc/scenarios/` file server-side (unknown name → 404): its `flow` (an
explicit body `flow` wins) plus each step's **literal** body fields as
`byEndpoint` overrides — bare-id-keyed, so although the scenario is
module-scoped, a step's overrides also reach same-id endpoints in **other**
modules (the `byEndpoint` collision rule above); fields holding `{{refs}}` are
dropped for the
runner's own bind machinery to fill, a step's frozen **params** are not read
at all (headlessly, params fill from `seeds` and schema examples as usual —
frozen params replay only through the page's *load*), and a step the
scenario marks `skip` contributes no overrides but is *not* excluded from
the walk (pass `skip` for that). That file and `heal-rules.json` (retry slugs, above) are the door's
**only** fixture reads: neither `exerciseEndpoints` nor `/docs/_run` ever
loads `cake.json`, so no setup steps run, no persisted variables seed, and no
pinned expectations evaluate headlessly.

## Dev mode and tracing pages

- **`KEEP_DEV=<status file>`** — serves `/docs/_dev` (status + `bootId`; the
  injected poller fetches it from the browser, and it exposes only the
  watcher's status file plus the boot id) and injects a poller into every
  cake/map page: pages auto-reload when the `bootId` changes, show spec errors
  in a red banner, and show a "server restarting…" notice while unreachable.
  This is the channel `rune dev` drives ([03-cli.md](03-cli.md)). `KEEP_DEV`
  is orthogonal to `KEEP_DOCS`: it governs the dev poller and `/docs/_dev`,
  and takes effect only when the docs module is serving.
- **`/docs/_trace`** — recent requests as bars; expand for the full span
  waterfall (request / backend / your functions, ✖ on the crash point), with
  route/method/status/user filters. Its sole data source is the open
  `/docs/_traces` door, polled from the page. That door: `GET` (query `?user=`
  scopes to one user server-side, `?limit=`
  caps the page — default 200, ceiling 1000) returns
  `{ app, enabled, persistent, users, traces }` — `enabled` mirrors
  `KEEP_TRACE`, `persistent` says whether the sink is Deno KV vs the
  in-memory ring, `users` is the distinct user values seen (the page's user
  filter dropdown), and `traces` is newest-first, one record per request:
  `{ id, app, method, route, user?, status?, startedAt, durationMs, ok,
  crashedSpanId, spans }`, each span
  `{ id, parentId, name, kind: "request" | "backend" | "user", start, end,
  error?, meta? }` (span times are ms offsets from the trace start; the root
  span is id 1, `parentId: null`). A trace's `user` is whatever app code sets
  via `traceUser(...)` / `tracer.setUser(...)`; keep attaches no identity of
  its own, so it is absent unless the app sets it.
  `POST /docs/_traces {"clear": true}` empties the buffer.
