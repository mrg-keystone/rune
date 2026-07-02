# Resolution — all three issues fixed in the engine (2026-07-01)

`./repro.ts` against the rebuilt `rune` (this checkout): **0/3 issues reproduce, exit 0,
and `deno check` on the generated tree is CLEAN.** The whole "plumbing pass" class is gone:
the incremental scaffold type-checks, so the red-by-design TDD loop starts immediately.

## Issue 1 — dropped leading scalar on multi-arg write seams → FIXED (codegen)

`renderCoordinator` (rune-manifest) now binds **every** declared parameter at every
post-core call site, in order, from one shared resolution table — the same declarations
the adapter signature is built from, so call-site arity always equals adapter arity:

- input-DTO field → `validInput.<p>`
- hoisted producer local → `<p>`
- a pre-core read's output → that read's local
- a value an earlier post-core step produced → **its asserted local (chained)**
- else → `out.<p>` and the core's return type gains the field (core mints it — red by design)

`kv:role.set(roleId, RoleDto)` now emits
`await roleData.set(out.widgetId, assert(WidgetDto, out.set, "widget.set input"))`
with `widgetId: string` added to the core return — exactly the shape of the hand-written
`token-mint` "DRIFT FIX".

## Issue 2 — silent create-once drift on incremental growth → FIXED (option B + A)

`rune sync` now **additively extends** preserved create-once files with the members a
grown spec owes them (`planCreateOnceGrowth` in rune-sync): throwing-stub adapter/business
methods, spec-exact DTO fields, and `@Endpoint` delegators (+ their imports) are appended
before the class close — append-only, hand-filled bodies untouched. Every extension is
printed (`Extended N create-once file(s) … (+method widgetPartAttached)`); when a file has
drifted so far its class can't be located (e.g. renamed), sync prints the owed member list
instead of guessing (option A fallback) — never a corrupt write. The previously-invisible
missing `@Endpoint` bindings are covered: the repro's `widgetAttach` endpoint is reachable
(the run-all gate now exercises it).

## Issue 3 — mid-recipe kv mutation emitted in the reads block → FIXED (codegen)

Value-returning boundary verbs are classified read vs **mutation**
(read allowlist: `get/list/load/read/fetch/find/lookup/query/search/download/count/peek/
check/exists` + `is|has|can|assert` prefixes; everything else mutates). Mutations are
emitted **after the core** — the guard position — in **spec order**, under an explicit
marker: `// (guards run in the core above: a throw there prevents every call below)`.
A naive fill can no longer land the escalating write before the 403. Bonus: a later step
consuming a mutation's output chains the real result (`ledger.record(gatewayAuthorize)`),
and when the boundary steps produce all the flow's values the core is emitted as a
guard-only `void` function.

## Verification

- `feedback/infra/repro.ts` → `=== 0/3 issues reproduce ===`, exit 0, `deno check` clean
- `deno task verify` → GREEN (all gates; L3/L4 goldens regenerated + reviewed)
- engine test suite: 520 passed, 0 failed (incl. new regression tests pinning each issue:
  rune-manifest/test.ts — multi-arg write arity, post-core mutation placement, chained
  mutations; rune-sync/test.ts — 7 growth tests incl. renamed-class → owed fallback and
  brace-noise scanner hardening)
