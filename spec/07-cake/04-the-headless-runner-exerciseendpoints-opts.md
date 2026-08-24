## The headless runner — `exerciseEndpoints(opts)`

The same metadata, run programmatically
(`coordinators/exercise-harness/mod.ts`): discovers endpoints from
`api.docs` (below), orders them topologically, runs them while chaining
outputs into inputs via `bind`, rate-limits, and loops until every endpoint
is green or the iteration cap is reached — mechanics under The green loop,
below.

```
exerciseEndpoints(opts: ExerciseOptions): Promise<Report>
```

### Options

| Member | Type | Required / default | Meaning |
|---|---|---|---|
| `api` | `{ backend, docs }` | required | The relevant slice of a `bootstrapServer(...)` return. `docs` is the sole discovery source — there is no over-HTTP discovery, a `baseUrl` run still needs the locally bootstrapped app's docs; `backend` is the in-process `fetch` client. |
| `baseUrl` | `string` | optional | Transport toggle. Absent → in-process via `api.backend.fetch` (no port, no auth; the CI default). Present → real HTTP via Playwright's `APIRequestContext` (Playwright is an optional peer, loaded only then). Endpoint metadata always comes from `api.docs`, either way. |
| `rateLimit` | `{ requestsPerSecond?, maxConcurrency? }` | optional | A minimum spacing between request starts plus an in-flight cap; every call, retries included, runs under it. |
| `rateLimit.requestsPerSecond` | `number` | default `20` | Minimum spacing between request starts. |
| `rateLimit.maxConcurrency` | `number` | default `4` | In-flight request cap. |
| `overrides` | `{ seeds?, byEndpoint?, auth? }` | optional | A literal key nesting. `/docs/_run`'s body takes `seeds`/`byEndpoint` flat and nests them itself — see The door, below. |
| `overrides.seeds` | `Record<field, value>` | optional | Literal values by field name. |
| `overrides.byEndpoint` | `Record<bareOperationId, value>` | optional | Keyed by **bare** operationId; wins over seeds and bind. Because the key is bare while working ids are module-qualified, one entry applies to **every** composed endpoint sharing that operationId, in every module. |
| `overrides.auth` | implementation-defined | default `in-process` | Any request auth the target app happens to expect on a network run; the `in-process` default (keep itself) requires none. |
| `maxIterations` | `number` | default `5` | The green-loop cap — see The green loop, below. |
| `skip` | `string[]` (working ids, `"<module>:<operationId>"`) | optional | Endpoints excluded from the walk entirely: they appear nowhere in the report, and steps depending on them are deferred — never fired, no request sent — while their binds can't resolve (the runner has no step gating; see The green loop, below). See Note on ids, below, for why `skip` takes working ids while `byEndpoint` takes bare ones. |
| `flow` | `string` | optional | Forwarded by `/docs/_run` under the same name — semantics specified once, under The door, below. |
| `orderBy` | `string` | optional | Forwarded by `/docs/_run` under the same name — semantics specified once, under The door, below. |
| `dryRun` | `boolean` | optional | Forwarded by `/docs/_run` under the same name — semantics specified once, under The door, below. |
| `onResult` | `(result: Row) => void` | optional | Per-result streaming hook. Called with a **snapshot** of an endpoint's report row (never the live object, so later iterations can't mutate what was streamed) each time its call settles — once per endpoint per pass (transient retries within a pass collapse into that one emission; a step re-run on a later iteration emits again). Not a door option — an HTTP body can't carry a callback; `/docs/_run`'s `stream: true` is its door-side correspondence, supplying its own `onResult` that writes each snapshot as an ndjson `result` line. |
| `retry` | `{ slugs, delayMs?, attempts? }` | optional | A failure whose `body.message` **exactly equals** a slug (whole-string equality — no substring or regex matching; a non-string or absent `message` never matches) is re-attempted after `delayMs` up to `attempts` extra times. |
| `retry.slugs` | `string[]` | required within `retry` | The slugs matched against `body.message`. `/docs/_run` derives its slugs from the project's heal rules plus built-ins (`timeout`, `rate-limited`) — heal knowledge feeds the runner, not just the UI. |
| `retry.delayMs` | `number` | default `800` | Delay before a retry attempt. |
| `retry.attempts` | `number` | default `3` | Extra attempts allowed beyond the first. |

With `retry`, the table above is the whole of `ExerciseOptions` — it has no other members.

**Note on ids.** `operationId` (the OpenAPI term, used throughout this section) is the endpoint's `surface.action` id — per
[06-runtime/02](../06-runtime/02-endpoint-endpointcontroller.md), an
endpoint's only identifier — and it's exactly the cake/map's `endpointId`:
the map's node id and deep-link anchor, and the cake's per-step capture key,
name that same `surface.action` identifier and share one key space
([07-cake/03](03-the-system-map-docs-map.md)). `skip` takes working ids
because a bare `operationId` (`surface.action`) still isn't unique across
composed modules, while `byEndpoint` (and the report's `id` column) use that
bare `operationId` on its own — "bare" meaning without the working id's
module qualifier, not without the surface component, which is already
folded into `operationId` itself — with the report's `module` column
disambiguating. A working id `"<module>:<operationId>"` here is exactly the
cake's module-qualified capture key `"<module>:<endpointId>"` and the map's
deep-link `<module>#<endpointId>`, which is why the map's Run all can
forward its skipped steps straight into the runner's `skip` list and why
runner result rows write back into the matching cake session unmodified.
Examples elsewhere in this section (`ping`, `linkOrder`, `createOrder`,
`notifyPartner`) are shortened standalone names for readability; a real
`operationId` is always the full `surface.action` form — `orders.create`,
never a bare `create`.

### Report

```
{
  passed: Row[],               // endpoints that went green
  failed: Row[],                // non-optional endpoints that never went green
  optionalFailed: Row[],        // optional endpoints that never went green — never counted in `failed`
  iterations: number,           // passes actually run (≤ maxIterations; fewer once the loop stops early)
  order: string[],              // computed run order, bare operationIds
  cycles: string[][],           // dependency cycles found while ordering, each a list of bare operationIds
  unresolvedInputs: string[],   // sorted, $-prefixed names — computed statically, before any request fires
}
```

`order` and each `cycles` component list **bare** operationIds (working ids stripped back to their operationId), so under composition a duplicated id can appear more than once with nothing disambiguating it there — the per-row `module` column (below) exists only on result rows. `unresolvedInputs` names every external `$`-input referenced by some bind that no seed covers and no composed producer mints — neither the exact field nor its `name + "s"` plural; echoes never count (see `$`-input resolution & producer discovery, below): nothing will satisfy them. It is included in every report, even when empty.

Row shape (every entry in `passed`, `failed`, and `optionalFailed`):

```
{
  id: string,          // bare operationId
  module: string,      // owning module — the only place duplicate bare ids are disambiguated
  method: string,
  path: string,
  ok: boolean,          // true once the endpoint went green
  optional: boolean,    // always present and load-bearing — routes this row into optionalFailed vs failed
  status: number,
  attempts: number,     // request attempts made, including transient retries
  error?: string,        // failure string; present only when the row didn't go green
  ms: number,
  body: unknown,
}
```

A non-optional endpoint that never fires — its bind never resolves across every pass, so no request is ever sent — still lands in `failed` once the loop stops; its row carries the sentinel values `status: 0, ms: 0, body: null, attempts: 0`, the same "no request was issued" signal a builder or report-consumer checks for regardless of whether the endpoint is required or optional (an optional endpoint in the same state lands in `optionalFailed` with the same sentinels).

### The green loop

`exerciseEndpoints` orders the endpoint set topologically (surfaced as the report's `order`, tie-broken deterministically), respecting both structural dependencies and any synthetic `$`-input edges added during producer discovery (below). It then works the set pass by pass until every endpoint is green:

- Each pass considers **only the not-yet-green endpoints** — passed steps are never re-sent, so non-idempotent POSTs don't repeat.
- Within a pass, a not-yet-green endpoint whose bind can't yet resolve is **deferred**, not fired: no request is sent, so nothing is added to its `attempts`. It stays not-yet-green and is reconsidered next pass; it is fired — and attempted for the first time — only once its binds resolve, typically because a producer captured on an earlier pass.
- The loop stops early once a pass makes no new progress — even short of `maxIterations` (default 5).
- Optional endpoints ride the same loop, with no special-cased gating: a failed optional counts as not-yet-green (re-sent every pass), but its failure is not "progress" — so persistent optional failures alone hit the early stop, never spin out the iteration cap. An optional endpoint locks nothing: the runner has no step gating, so its dependents are deferred, not fired, while their binds can't resolve without its capture — once resolvable, they fire and can succeed or fail on their own terms. In the report its failure lands in `optionalFailed`, never `failed` — an empty `failed` means the process works, optional failures notwithstanding.

### `$`-input resolution & producer discovery

Resolution order: seed first; else **composition fulfills the contract**: at run time, the first captured response *in run order* owning a same-named field — else the first owning the `name + "s"` collection, whose first element supplies the value (scalars only, same rule as the cake: a non-scalar first element yields nothing; no scan for a later scalar) — fills it.

Producer discovery is static (the schemas' declared output fields, before any request fires; exact-field producers considered before plural ones): the runner adds a synthetic dependency edge to the first producer that is neither the consumer itself nor already downstream of it — the downstream exclusion the cake's `auto:` index lacks — so the producer runs first; when no producer survives that filter, no edge is added and the run-time capture fallback above still applies. Echoes (as defined for the cake) never count as producers. A composed app with stub or real producers needs no seeds at all.

Required fields with no seed/bind fill from their schema `example` (typed zeros count; the empty-string placeholder doesn't) — matching the cake's generated bodies.

### Worked example

Two composed modules, `catalog` (docs order 1) and `checkout` (docs order 2). Both declare a `ping` operation (a bare-id collision by design); `catalog` also declares `linkOrder`, a consumer that binds its body's `orderId` field to `$orderId`; `checkout` declares the producer, `createOrder` (its response body exact-matches `orderId`), plus an optional `notifyPartner` that always fails in this run. (Ids below are shown as the short standalone names above for readability — see Note on ids, above; each is really its module's `surface.action` operationId, e.g. `checkout.createOrder`.)

```
exerciseEndpoints({
  api,
  orderBy: "module",
  overrides: {
    seeds: { widgetId: "w-1" },
    byEndpoint: { createOrder: { customerId: "c-42" } },
  },
})
```

With `orderBy: "module"`, lane order beats every dependency edge, so the walk is lane-by-lane rather than producer-first:

```
order: ["ping", "linkOrder", "ping", "createOrder", "notifyPartner"]
```

— `ping`'s bare id appears twice, once per module, disambiguated only by the `module` column on the eventual result rows.

**Pass 1** works the whole order: `catalog:ping` and `checkout:ping` are independent and go green. `catalog:linkOrder`'s turn comes before `checkout:createOrder` — lane order, not producer order — but its bind for `$orderId` has no capture to resolve against yet, so it's deferred: no request sent, no attempt recorded. `checkout:createOrder` then runs, its body seeded from `overrides.byEndpoint`, and returns `{ orderId: "ord-1", total: 42 }` — captured. `checkout:notifyPartner` runs and fails (a non-transient partner error). Progress: 3 newly green; not-yet-green = `{ linkOrder, notifyPartner }`.

**Pass 2** reconsiders only those two. `catalog:linkOrder` now finds `createOrder`'s capture, resolves `$orderId` to `"ord-1"`, fires for the first time, and goes green — its only attempt. `notifyPartner` fires again and fails again. Progress: 1 newly green; not-yet-green = `{ notifyPartner }`.

**Pass 3** re-runs `notifyPartner` alone; it fails again, identically — no new progress, so the loop stops early at `iterations: 3`, well under the default cap of 5.

Final report:

```
{
  passed: [
    { id: "ping", module: "catalog", ok: true },
    { id: "ping", module: "checkout", ok: true },
    { id: "createOrder", module: "checkout", ok: true },
    {
      id: "linkOrder", module: "catalog", method: "POST",
      path: "/widgets/{widgetId}/link", ok: true, optional: false,
      status: 200, attempts: 1, ms: 6, body: { linked: true },
    },
  ],
  failed: [],
  optionalFailed: [
    { id: "notifyPartner", module: "checkout", ok: false, optional: true, status: 503 },
  ],
  iterations: 3,
  order: ["ping", "linkOrder", "ping", "createOrder", "notifyPartner"],
  cycles: [],
  unresolvedInputs: [],
}
```

`unresolvedInputs` is empty here because `$orderId` had a composed producer; it's included regardless, per the Report contract above.

### The door — `POST /docs/_run`

```
{
  flow?: string,
  seeds?: Record<field, value>,
  byEndpoint?: Record<bareOperationId, value>,
  rateLimit?: { requestsPerSecond?: number, maxConcurrency?: number },
  maxIterations?: number,
  dryRun?: boolean,
  scenario?: string,
  orderBy?: string,        // "module" triggers lane-by-lane ordering — see below
  skip?: string[],
  stream?: boolean,
}
```

| `ExerciseOptions` member | `/docs/_run` field | Relationship |
|---|---|---|
| `flow` | `flow` | Same-name forward. |
| `orderBy` | `orderBy` | Same-name forward. |
| `dryRun` | `dryRun` | Same-name forward. |
| `maxIterations` | `maxIterations` | Same-name forward. |
| `skip` | `skip` | Same-name forward (working ids, as in `ExerciseOptions`). |
| `rateLimit` | `rateLimit` | Same-name forward, same `{ requestsPerSecond?, maxConcurrency? }` shape. |
| `overrides.seeds` | `seeds` | Transformed: the door takes it flat and nests it into `overrides.seeds` itself. |
| `overrides.byEndpoint` | `byEndpoint` | Transformed: the door takes it flat and nests it into `overrides.byEndpoint` itself. |
| `onResult` | `stream` | Transformed: an HTTP body can't carry a callback, so `stream: true` is the door-side correspondence — it supplies its own `onResult` that writes each snapshot as an ndjson `result` line. |
| `retry` | — | Derived, not forwarded: the door derives `retry.slugs` itself from the project's heal rules plus built-ins (see `retry.slugs`, above); there is no `retry` body field. |
| `api` | — | Runner-only: the door already runs in-process against its own bootstrapped app. |
| `overrides.auth` | — | Runner-only: auth only matters for a `baseUrl` network run, which the door never does. |
| `baseUrl` | — | Runner-only: the door **is** the HTTP surface; it always runs in-process. |
| — | `scenario` | Door-only: replays a saved `spec/misc/scenarios/` file server-side — see below. |

`flow` filters one name across **every** composed module: endpoints tagged with other flows are excluded, untagged endpoints (part of every flow) stay — so same-named flows in several modules all match, and there is no per-module flow selector here. `__main` is not special-cased: the pseudo-flow rides this same filter — untagged endpoints stay, tagged endpoints are excluded unless a module literally declares a flow named `__main` (the cake's selector already reserves that name, so by convention none does) — yielding the cake's untagged-only default walk.

`dryRun` returns just `order`/`cycles`/`unresolvedInputs` (as defined in the Report contract, above).

`orderBy: "module"` walks lane-by-lane: modules in docs order, each lane internally in topological order. Lane order beats every dependency edge — synthetic `$`-input edges included (they are added before ordering and are never dropped, but only break ties within a lane) — so a consumer whose surviving producer lives in a later module lane comes up first, is deferred that pass (its bind has nothing to resolve against yet), and goes green on a later iteration once the producer's capture exists (see Worked example, above).

`stream: true` returns ndjson: one result line per call — the same Row snapshot `onResult` receives, written as its own JSON line — then a terminal summary line, `{ done: true, passed, failed, optionalFailed, iterations, unresolvedInputs }`, the same-named fields from the Report contract above (minus `order`/`cycles`, which the map has no use for mid-stream). The `done` key is what distinguishes the terminal line from a Row line (no Row carries it), and is what tells the map (07-cake/03) the stream is finished and rolls the summary into its session.

`scenario` replays a saved `spec/misc/scenarios/` file server-side (unknown name → 404): its `flow` (an explicit body `flow` wins) plus each step's **literal** body fields as `byEndpoint` overrides — bare-id-keyed, so although the scenario is module-scoped, a step's overrides also reach same-id endpoints in **other** modules (the `byEndpoint` collision rule above); fields holding `{{refs}}` are dropped for the runner's own bind machinery to fill, a step's frozen **params** are not read at all (headlessly, params fill from `seeds` and schema examples as usual — frozen params replay only through the page's *load*), and a step the scenario marks `skip` contributes no overrides but is *not* excluded from the walk (pass `skip` for that).

That file and `heal-rules.json` (retry slugs, above) are the door's **only** fixture reads: neither `exerciseEndpoints` nor `/docs/_run` ever loads `cake.json`, so no setup steps run, no persisted variables seed, and no pinned expectations evaluate headlessly.

