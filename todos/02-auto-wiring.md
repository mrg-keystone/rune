# Task 02 — Contract auto-wiring at compose time + `stub` metadata

Repo: **keep** (`/Users/raphaelcastro/Documents/programming/rune/keep`). Read `00-context.md` first.
No prerequisites. Later tasks (03–06) build on this one — its shapes are load-bearing.

## Goal

Today a `bind: { memberId: "$memberId" }` external input resolves ONLY from explicitly set
values (the cake's shared `globals.vars`; the runner's `overrides.seeds`). Make composition
fulfill the contract automatically: when ANY module in the app has an endpoint whose output
carries a same-named field, the `$input` resolves from that producer's capture — explicit values
still win. Also add a `stub: true` endpoint marker (task 03 generates stub modules that need
badging and bookkeeping).

## Part A — `stub` metadata

1. `src/foundation/domain/business/endpoint-decorator/mod.ts`: add `stub?: boolean` to
   `EndpointOptions` (doc comment: "a generated stand-in endpoint minting placeholder values —
   not part of the real process") and `stub: boolean` to `ProcessMetadata`; stamp
   `stub: opts.stub ?? false` in `Endpoint()` next to `optional`.
2. `src/foundation/domain/business/endpoint-decorator/test.ts`: the test
   `Endpoint - Swagger doc carries paths and DTO schemas` asserts the exact `x-keep-process`
   shape — add `stub: false` to the expected object.
3. `src/foundation/domain/business/endpoint-spec/mod.ts`: add `stub: boolean` to `SpecEndpoint`,
   extracted as `process?.stub ?? false`. Add an assertion to an existing case in
   `endpoint-spec/test.ts`.
4. `src/foundation/dto/types.ts`: add `stub?: boolean` to `ProcessExtension`.

## Part B — producers index (server side)

In `src/foundation/domain/coordinators/bootstrap-server/mod.ts`, inside the `if (swagger)` block
where `docs` holds ALL modules' entries and the per-module routes are registered in a loop:

1. Before the loop, flatten every doc with `endpointsFromDoc` (already imported transitively via
   emulator-ui; import directly from `@foundation/domain/business/endpoint-spec/mod.ts`) and
   build `producersByField: Map<string, string>` — field name → `"<module>:<endpointId>"` where
   `<module>` is the doc's path segment without the leading slash (the same `moduleName` the
   loop already computes). First producer wins. Include stub endpoints (they're producers too).
2. For each module page, compute the slice relevant to it: the module's own `$` input names
   (walk its endpoints' binds for `$`-prefixed values, arrays included) → an object
   `{ [name]: "module:endpointId" }`, omitting names with no producer or whose only producer is
   the module itself.
3. Change `emulatorShellHtml(title, doc)` (in `src/foundation/domain/business/emulator-ui/mod.ts`)
   to `emulatorShellHtml(title, doc, opts: { producers?: Record<string, string>; dev?: boolean } = {})`
   — `dev` is reserved for task 05; only add the field, don't implement it. Put `producers`
   (default `{}`) into the inlined payload: `JSON.stringify({ title, endpoints, cycles, producers })`.
   Update the call site to pass the slice.

## Part C — cake client fallback + affordances

In `src/foundation/domain/business/emulator-ui/client.ts` (REMINDER: the JS lives inside
`String.raw` strings — never type a backtick or `${` in there):

1. In `lookupRef`, the `$` branch currently returns only `globals.vars[name]`. Extend: if the
   var is unset (or empty string), fall back to `DATA.producers[name]` — split the qualified id,
   look up `globals.captured[qualifiedId]`, return its `[name]` field if present.
2. Module-inputs card (`renderInputs`): when an input has no explicit value but
   `DATA.producers[name]` exists, render the row's status as `auto: <module:endpointId>.<name>`
   (a dim, non-amber treatment — it is satisfied, not missing) while keeping the text input
   usable (typing a value overrides; clearing returns to auto).
3. Stub badge: in `bindChipsHtml` (or beside it), when `ep.stub` is true add a
   `<span class="chip">stub</span>`-style chip with a title explaining it's a generated
   stand-in. Add minimal CSS consistent with existing `.chip` variants.

## Part D — headless runner fallback + ordering

In `src/foundation/domain/coordinators/exercise-harness/mod.ts`:

1. `buildValues`: in the `$` candidate branch, after the seeds check misses, scan the `store`
   (Map endpointId → captured object) for the first captured object that owns the field name;
   use it. Seeds keep absolute priority.
2. Synthetic ordering edges: between the flatten (`opts.api.docs.flatMap(...)`) and
   `processOrder(endpoints)`, build a field→producerId map from `outputFields`, then for every
   endpoint with a `$name` bind whose name has a producer, push the producer id into that
   endpoint's `dependsOn` (avoid duplicates; skip self). This makes producers run first so the
   fallback hits in pass one. The objects are fresh per call — mutation is safe.

## Tests

- Harness (`exercise-harness/test.ts`): composed two-module app (follow the existing
  `chains across modules in a composed app` test pattern) where module B has
  `bind: { memberId: "$memberId" }` and module A's endpoint outputs `memberId`. Assert: green
  with NO seeds, A's endpoint ordered before B's, and that providing
  `overrides.seeds.memberId` still wins (B receives the seeded value — have B echo it back so
  the test can tell).
- Browser (`emulator-ui/browser.test.ts`, gated on `KEEP_BROWSER=1`, follow the existing
  cross-module test): compose producer+consumer modules; on the consumer page assert the
  module-inputs row shows the `auto:` affordance after the producer page's step has run, and the
  consumer step goes green without typing anything.
- Unit (`emulator-ui/test.ts`): `emulatorShellHtml` with a producers arg embeds
  `"producers"` in the payload; without it, `"producers":{}`.

## Verification (the whole task)

```
deno task test                       # all unit tests green
deno task test:browser               # all browser tests green
KEEP_BROWSER=1 deno task test:e2e    # cake + checkout fixtures green (no regressions)
deno fmt --check src/ && deno lint src/foundation/domain/business/emulator-ui/ src/foundation/domain/business/endpoint-spec/ src/foundation/domain/business/endpoint-decorator/ src/foundation/domain/coordinators/exercise-harness/ src/foundation/domain/coordinators/bootstrap-server/
deno task check:jsr                  # publish dry-run green
```

## Definition of done

- [ ] `stub` flows decorator → x-keep-process → SpecEndpoint, default false, exact-shape test updated
- [ ] Cake `$` resolution: explicit value → producer capture fallback; `auto:` shown in Module inputs
- [ ] Runner `$` resolution: seeds → store scan; synthetic edges order producers first
- [ ] New harness + browser + unit tests green; every command in Verification green
- [ ] `emulatorShellHtml` third param is a single `opts` object with a reserved `dev` field
- [ ] No commits made
