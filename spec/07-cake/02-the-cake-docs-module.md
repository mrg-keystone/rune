## The cake (`/docs/<module>`)

An interactive, self-contained HTML page listing the module's endpoints in
process order.

### Render data (`window.__KEEP_EMULATOR__`)

The page renders from data inlined into the shell server-side — nothing is
fetched to draw it; the open doors ([→00](00-overview.md)) are for the live
actions the page takes afterward (running steps, fixtures, scenarios, heal).
That inlined object is this page's read contract:

| Field | Contents | Backs |
| --- | --- | --- |
| `title` | the module's display name | the page header |
| `endpoints` | this module's endpoints in process order, each with its DTO schema, `dependsOn`, `bind`, flows, and `optional`/`stub` flags — an optional endpoint's row carries an `optional` chip (alongside the amber `stub` chip when it's also a stub) and its failure is advisory: it does not halt Run-all (see Run all, below) | the step list (Step anatomy, below) |
| `cycles` | dependency cycles detected in this module's process graph | the cycle banner (Flows, module inputs, and cycles, below) |
| `producers` | the highest-ranked producer per declared `$input` field (specificity first, encounter order as tiebreak), statically indexed across the composed app | the `auto:` label on Module-inputs rows (Cross-module auto-wiring, below) |
| `appEndpoints` | every endpoint in the composed app, module-qualified | the Module setup rail's endpoint picker — setup can target **any endpoint in the composed app** (below) |

This is a separate artifact from the session state in `localStorage` —
statuses, captures, edited bodies, and everything else a run mutates live in
the browser, never inlined at render time (see Session state, below).

### Step anatomy

Each step shows the concrete request it will send (body generated from the
DTO schema, bound fields holding `{{step.field}}` references resolved against
captured responses at send time), the response, a paste-ready curl, and a
full-URL copy.

### Running a step

Running a step drops a checkmark with status + timing, captures its outputs
into the captures scope — shown live in the panel's captures view, never
merged into shared variables — and unlocks its dependents; re-running shows
a **diff against the previous response**.

### Golden path

Take a two-endpoint module: `create-order` (`POST /orders`,
no `dependsOn`, mints `orderId`) and `get-order` (`GET /orders/:id`,
`dependsOn: "create-order"`, `bind: { id: "create-order.orderId" }`). The cake
generates `create-order`'s request body straight from its input DTO schema —
e.g. `{ "customerId": "cust_1", "items": [...] }` — since it has no bound
fields to resolve. Pressing **Run** sends that body, drops a green checkmark
(`201`, timing), and captures the response into the captures scope —
visible in the panel's captures view — as `create-order.orderId` →
`"ord_9"`. That capture is what unlocks `get-order`:
its `id` field is bound to `{{create-order.orderId}}`, so the moment
`create-order` goes green the row unlocks and the generated request resolves
to `GET /orders/ord_9` at send time (the field still shows the token; only the
outgoing request carries the resolved value). Pressing **Run** on `get-order`
sends that request and drops its own checkmark (`200`, timing); nothing
depends on it, so nothing further unlocks. **Run all in order** walks both in
one pass — `create-order` first, then `get-order` with the same resolved
`id` — ending with two green checkmarks.

### Run all

**Run all in order** walks the chain and stops at the first **required**
failure with a banner saying where and why. An `optional` step's failure is
advisory: it drops its own red checkmark, but the walk continues past it —
mirroring the runner's `optionalFailed` handling (never counted in `failed`,
[→07-cake/04](04-the-headless-runner-exerciseendpoints-opts.md)) and the
run-all gate's treatment of optional failures
([→04-codegen/06](../04-codegen/06-the-run-all-gate.md)).

### Skip

Each step row also carries a **skip** toggle: a skipped step is excluded from
the Run-all walk entirely — its status and captures stay exactly where you
parked them (dependents still gate on that parked status, and its individual
Run button still fires it). Skips are what the map's Run all forwards
(module-qualified) as the runner's `skip` list and what scenarios freeze per
step.

A skipped step's parked status still gates its dependents during the walk:

| Parked status | Dependent state | Run-all outcome |
| --- | --- | --- |
| Green | any | Dependent runs normally — the parked step counts as satisfied |
| Not green | Not yet green | Halts with the "Stopped — … is waiting on …" banner naming the skipped step — exactly as for any other unmet dependency |
| Not green | Already green | Walked past — the dependent stays green and the walk continues |

### Flows, module inputs, and cycles

Flows get a selector — one branch at a time, plus **All** and **main**, the
untagged-only pseudo-flow (stored as `__main`), the default whenever flows
exist, so destructive branches never run unless explicitly selected;
declared `$inputs` appear on a **Module inputs** card; dependency cycles are
called out in a banner.

### Reference resolution

Bodies resolve five token forms — recursive, depth-capped:

| Token form | Reads | Example |
| --- | --- | --- |
| `{{step.field}}` | this page's captures | `{{create-order.orderId}}` |
| `{{name}}` | shared variables (**Variables** panel) | `{{tenantId}}` |
| `{{$name}}` | module inputs (**Module inputs** card) | `{{$tenantId}}` |
| `{{module:step.field}}` | another module's capture | `{{billing:create-invoice.invoiceId}}` |
| `{{a \|\| b}}` | alternatives — first resolvable wins | `{{tenantId \|\| $tenantId}}` |

The panel has two views over two distinct scopes: a **variables** view
holding shared variables — user-created (applied heal fixes write them too),
shared across every docs page, saved into the fixtures file only when marked
`persist` — and a separate **captures** view holding this page's captures,
keyed `step.field`, which are never auto-copied into the shared-variable
scope.

Precedence, in order:

1. **Exact variable-name match wins.** A token that exactly matches a
   variable name resolves as the variable before anything else — a variable
   shadows a same-named capture path.
2. **Explicit variable beats auto-producer.** An explicitly set shared
   variable beats a `$input`'s auto producer.
3. **Explicit Module-inputs value beats a same-named variable.** When a
   `$input` has both an explicitly typed Module-inputs value and a
   same-named shared variable, the Module-inputs value wins — it is a
   deliberate, per-input override a builder set on that exact field, whereas
   the variable is a page-wide default that yields to it, matching the
   general pattern that the more specific source wins.

### Session state

Session state lives in `localStorage` under two kinds of key:

| Key | Scope | Contents | Who reads it |
| --- | --- | --- | --- |
| `keep:emulator:<page path>` (e.g. `keep:emulator:/docs/orders`) | page-local, per module | statuses, captures, response metas, edited bodies, param values, skips, setup steps, pinned expectations, previous responses (for the diff), the flow choice, expanded rows, Module-inputs `$input` values (this module's seeds) | the map's status dots, which recolor from these per-module keys, and the map's Run all, which reads the Module-inputs values back out as the seeds it forwards ([→07-cake/03](03-the-system-map-docs-map.md)) |
| `keep:emulator:globals` | cross-page, one shared key | shared variables, their `persist` flags, module-qualified captures (`"<module>:<endpointId>"` → response body, published on every successful run) | `{{module:step.field}}` and cross-module `$input` auto-fill |

Both survive reloads and `rune dev` restarts. **Reset session** starts fresh
(clearing this module's session key and its module-qualified captures from
the shared scope; shared variables stay).

**Cross-module auto-wiring:** when any endpoint in the composed app mints a
declared `$input`'s field — exactly, or as its plural collection (the literal
`name + "s"`, no linguistic pluralization; `$tableName` ← `tableNames[0]`,
first element, scalars only) — the Module-inputs row shows
`auto: <module>:<endpoint>` and satisfies itself from that producer's capture;
an explicitly typed value always overrides that auto-fill, and per the
precedence order above, it also beats a same-named shared variable.
Producers are discovered
**statically** from the schemas' declared output fields, ranked by two
criteria applied in order: **specificity first** — an exact-field producer
always beats a plural-collection producer for the same `$input`, regardless
of which is encountered first — and **encounter order as the tiebreak**
among producers of the same specificity — the first encountered walking the
composed docs (module order, then declaration order) wins. A consumer never
counts as its own producer. An **echo** — an
endpoint whose output field is also one of its own input or bound fields —
never counts as a producer (it can't bootstrap a value; at run time an echo's
capture still resolves references). The cake's index (which the map's dashed
edges mirror) keeps only the highest-ranked producer per field (specificity
first, encounter order as tiebreak) and applies **no downstream exclusion**;
the headless runner indexes every producer and skips those already
downstream of the consumer (see its `$`-input resolution order) — so when
the highest-ranked producer transitively depends on its consumer, the
`auto:` label names that producer while the runner orders a later one first
(or none). Stub endpoints (ghost stubs,
[04-codegen.md](../04-codegen/00-overview.md)) carry an amber `stub` chip and produce like
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
suggestions from the same closed `kind` vocabulary: action kinds render
behind an **Apply** button — nothing auto-executes — while guidance kinds
render as guidance text with no Apply. Run all never auto-resumes after a
heal: the banner tells you to fix and press **Run all in order** again (it
resumes from the first non-green step).

- **Tier 1** — keep's built-in generic diagnosis (missing inputs, validation
  shapes, transient retries).
- **Tier 2** — the project's declarative rules from
  `spec/misc/heal-rules.json` (rune generates the starter file from the
  spec's fault slugs; served at `GET /docs/_heal-rules`, fetched once at page
  load): error slug → suggestions, where the slug is the failing response's
  `body.message` used verbatim as the lookup key (exact string equality — no
  substring or regex matching). The lookup is gated: it only fires when
  `body.message` is kebab-case-shaped (matches
  `/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/`) or is exactly `timeout` or
  `unauthorized`; a message with spaces/uppercase or a single hyphenless word
  is never consulted even if a rule's key equals it — rune-generated slugs
  are kebab-case by convention, so this rarely bites.
- **Tier 3** — the long tail: **Ask Claude**. `POST /docs/_heal` forwards the
  failure bundle plus the whole composed process graph to a private Claude
  service (`PRIVATE_CLAUDE_URL`; 503 when unset — with an optional
  `PRIVATE_CLAUDE_TOKEN` sent as a `Bearer` authorization header when set,
  omitted otherwise), returning `{ diagnosis, suggestions[] }` whose kinds
  map onto the same client actions (below).

The `kind` vocabulary and its payload fields are owned by
[04-codegen.md § Fix kinds](../04-codegen/04-heal-rules.md#fix-kinds); this
panel is what executes them:

| `kind` | Renders as | What Apply does (panel-specific) |
| --- | --- | --- |
| `run-step` | Action (Apply) | Runs the matched not-yet-green step |
| `set-input` | Action (Apply) | Writes into the named shared variable |
| `pick` | Action (Apply) | Aggregates the array field's elements across **every** capture holding it — this page's captures first, then the shared module-qualified captures, each in insertion order (at most 30 elements read, duplicates collapsed) — Apply writes the picked element into the **shared variable**, no body field is touched |
| `retry` | Action (Apply) | Re-sends the failing step; retry-kind slugs also feed `/docs/_run`'s transient retries |
| `note` | Guidance (no Apply) | Renders `label`/`why` as guidance text; `retryAfter: true` appends a Retry offer alongside it |
| `remove-key` | Action (Apply) | Deletes the top-level body key, then re-sends the step |
| `set-body-field` | Action (Apply) | Sets the top-level body key, then re-sends the step |

Unknown kinds are ignored (forward compat). Any rule may carry `why`,
rendered beside its label.

Tier 3's Claude response maps its own kinds onto the table above before
rendering:

| Claude's kind | Maps to panel kind | Notes |
| --- | --- | --- |
| `run-step-first` | `run-step` | same `target`/`match` payload |
| `edit-body` | `set-body-field` | same `target`/`value` shape |
| `set-input` | `set-input` | unchanged |

`switch-flow` / `set-env` / `explain` are guidance kinds with no panel
mapping — they render as guidance text with no Apply, the same as `note`
without `retryAfter: true`.

