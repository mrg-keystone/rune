---
name: "rune:cake"
description: >-
  Prove a rune backend actually does what it's supposed to, end to end, through
  the per-module **cake** at `/docs/<module>` — real data, no mocks, real service
  connectivity — and fix the cake when a walk goes red. Use when the user says
  "run the cake", "exercise the endpoints", "walk the process", "does the app work
  end to end", "Emulate process / Run all in order", "the cake is red / a step
  fails / won't bind", "$input won't resolve", "run-all is red", "pin an
  expectation / save fixtures", "save/replay a scenario", "fix the heal rules /
  heal panel", or "drive the whole composed app headless" (`POST /docs/_run`,
  `exerciseEndpoints`). Covers serve-and-walk, the real-data e2e discipline,
  headless replay, Expectations→`spec/misc/cake.json`, Scenarios, response-diff,
  the system map, and the FIX-CAKE assist (stale entrypoint controller, missing
  schema example, unproduced `$input`, 422 assert failure, heal panel rules→Claude).
  NOT for writing/editing the `.rune` spec → use `rune:spec`; NOT for generating
  + filling bodies + unit/smoke tests + enriching heal-rules → use `rune:build`;
  NOT for runtime/auth/runner internals (`bootstrapServer`, 401/403, the
  `exerciseEndpoints` full option surface, mounting/deploy) → use `rune:framework`;
  NOT for per-endpoint Swagger examples → use `rune:docs`.
user-invocable: true
argument-hint: "[module to exercise, or the cake problem to fix]"
---

# Rune — exercise & fix the cake

The cake is rune's **end-to-end tier**: a per-module guided walk at `/docs/<module>`
that runs your real endpoints, in dependency order, against **real services with no
mocks**. Green on every step means the logic actually works — not that it merely
type-checks. This skill drives that walk, pins its contract, replays it headless,
and fixes it when it goes red.

## This skill vs its siblings

- **Writing/editing the `.rune` spec** (tags, granularity, DTO suffixes, `[TYP]`
  modifiers, `rune check`) → **`rune:spec`**. When a red walk traces to the spec
  (wrong order/deps/bind, a missing `[TYP:example=]`), hand the fix back there.
- **Generating + filling bodies + the unit/smoke test fleet + `rune lint` + enriching
  `spec/misc/heal-rules.json`** → **`rune:build`**. Build's smoke (`smk`) tests share
  this skill's real-connectivity premise; build *authors* the heal rules, this skill
  *uses* them and owns their schema. A red walk caused by an unimplemented body or a
  stale entrypoint controller is fixed by re-syncing/filling — hand back to `rune:build`.
- **The runtime the cake runs on** — `bootstrapServer`, auth/401/403, the
  `@Endpoint`/`@EndpointController` `order`/`dependsOn`/`bind` *semantics*, and the
  **full `exerciseEndpoints` option surface** (this skill cites only the e2e-relevant
  options) → **`rune:framework`**. Framework *mounts* the cake; this skill *serves and
  walks* it.
- **Swagger/OpenAPI per-endpoint examples** (`@ApiProperty`, `example=`,
  `/docs/<m>/swagger`, `/docs/<m>/json`) → **`rune:docs`**.
- You are in the **right** skill when the question is "does the composed app work
  right now, with real data?" or "the cake/heal/run-all is broken — get it green".

The seam from `rune:spec`: a `.rune` draft becomes a `rune check`-clean
`spec/runes/<m>.in-prog.rune`. **`rune:build` owns everything from finalize onward** —
dropping the `.in-prog` infix, `rune sync`, bodies, tests, lint, the green run-all.
This skill picks up *after* that, to prove the green build behaves end to end with
real services.

---

## 1. Serve and walk — the green-down-the-list loop

```text
deno run -A bootstrap/mod.ts          # serve the composed app (bootstrap/ is sync-generated)
open http://localhost:<port>/docs/<module>   # the cake for that module
        │
        ├─ Emulate process      # send the next step, read the response, capture its output
        └─ Run all in order     # walk the active flow top-to-bottom, stop at the first failure
        │
green ✓ on every step ⇒ the rune's logic actually works (not just type-checks)
```

Each module gets three pages (Swagger on by default):

| Path | What |
| ---- | ---- |
| `/docs/<module>` | **the cake** — a guided, ordered walk of the process chain |
| `/docs/<module>/swagger` | standard Swagger UI (→ `rune:docs`) |
| `/docs/<module>/json` | the raw OpenAPI spec (token-gated; → `rune:docs`) |

Page name = the module class lowercased without the `Module` suffix
(`endpointModule("Orders", …)` → `/docs/orders`). The endpoint **id** is the
handler method name; cake deep links are `/docs/<module>#<id>`.

How the walk behaves (the parts that bite when debugging):

- **Request bodies are generated from the input DTO schema.** Bound fields carry
  `{{step.field}}` references resolved *at send time* — your hand edits are never
  overwritten by a capture; the ref just resolves when the step fires.
- Every successful step **captures its outputs** and pre-fills dependent steps
  (`bind`). Captures + user variables are shared across all docs pages via
  `localStorage`, and a `storage` listener live-updates other open tabs.
- **Run all in order** walks the **active flow** and stops at the first failure with a
  banner naming the step and reason. Fix, then re-run to resume. The walk scrolls the
  active/stopped step into view but leaves every box collapsed — open one yourself to
  inspect it. **Run from here** clears that step and every later step, then runs from it.
- A module with `flows` shows a **flow selector** defaulting to **main** (untagged-only)
  — so a destructive `teardown` branch never runs unless you pick it. "All" runs
  everything; a named flow runs that branch plus untagged steps.
- **`/docs/_map`** is the whole composed app as one live process graph — module lanes,
  bind edges (dashed for cross-module `$input` contracts), status dots that recolor as
  you run steps anywhere. Click a node to land on its cake step. Its **Run all** button
  drives the server-side headless walk (below). The map's wiring/mechanics are owned by
  the **`rune:framework`** skill; the cake-side behavior is in `references/cake.md`.

For the edit loop prefer **`rune dev`** over re-serving by hand: it watches the
project, re-checks/re-syncs the spec on save, restarts the app, and the open docs
pages reload themselves (spec errors show in the page banner while the last-good server
keeps serving; cake session state survives the restart). Note `rune dev` does **not**
run `deno test` — it is the app reloader; the unit-test loop belongs to `rune:build`.

Full cake-page behavior — references resolution, type coercion, response-diff,
skips, stub/optional chips, the flow selector — is in **`references/cake.md`**.

## 2. Real data, no mocks — the e2e discipline

State this up front, because it is the whole point of the cake: **the cake hits real
services.** It is the e2e tier, not a unit harness. Do not stub the boundary, do not
mock the adapter, do not hand-fake a response to make a step go green. A green cake
walk is only meaningful because it proves the real call path — auth, the real
database/HTTP/queue adapter, the real DTO validation — works against a live dependency.

This shares the **smoke-connectivity premise** with the `smk` tests in **`rune:build`**:
both exist to exercise real service boundaries. The difference is tier — `smk` tests
prove a single adapter connects; the cake proves the *composed process* works
end to end with those connections chained. If a service genuinely isn't reachable in
this environment, that is an environmental failure to fix (or seed past, deliberately
and visibly), not a reason to mock.

## 3. Headless / unattended — ask a running server "does it work?"

Two doors run the same `exerciseEndpoints` machinery without a browser:

- **In code** — `exerciseEndpoints({ api })` against a bootstrapped app. With no
  `baseUrl` it dispatches in-process; with `baseUrl` it runs over real HTTP. This is
  the CI/test door. The **full option surface** (`flow`, `overrides.seeds` /
  `byEndpoint` / `auth`, `rateLimit`, `maxIterations`, `retry`, `dryRun`, `$name`
  resolution) is owned by the **`rune:framework`** skill — this skill uses it, framework
  owns it.
- **Over HTTP** — `POST /docs/_run` against a *running* server, so an agent, CI, a
  smoke check, or the map UI can ask "does the whole composed process work right now?"
  without importing the app. **Localhost-only** (403 otherwise); in-process dispatch
  is denied; `503` until the in-process backend exists. Body (all optional):
  `{ flow?, seeds?, byEndpoint?, rateLimit?, maxIterations?, dryRun?, scenario?, orderBy?, skip?, stream? }`.
  `dryRun: true` is a cheap pre-flight returning `{ order, cycles, unresolvedInputs }`
  with nothing sent — it names dependency cycles and unsatisfied `$inputs` before you
  spend a real call. See `references/cake.md` for the request/response shape and
  streaming, and `rune:framework` for the trust posture it shares with `/_mint`.

**Optional agent loop** (drive it unattended): `POST /docs/_run` → read the `failed[]`
rows → heal (rules first; see §5) → re-run until `ok`. A starting brief for that loop
is in `agents/e2e-driver.md`.

## 4. Pin the contract — Expectations, fixtures, scenarios

A green walk is ephemeral until you pin it. Two committable artifacts make the cake a
contract-test layer:

- **Expectations → `spec/misc/cake.json`.** Each step's Expect block pins an exact HTTP
  status and body checks (`path == / != / contains / exists value`; values may hold
  `{{refs}}`). With expectations pinned, "green" means the response *meets them* — a 200
  with a wrong body goes **red** (`expect ✗`). **Save fixtures** writes this module's
  setup steps + pinned expectations + persisted variables to `spec/misc/cake.json`, plain
  committable JSON. On load the cake applies it as the baseline even in a fresh browser.
- **Scenarios → `spec/misc/scenarios/<name>.json`.** The Scenarios card freezes the whole
  walk (active flow, every step's body + params with refs intact, skips) under a name —
  one committable file per scenario. **load** applies it; **run** is load + Run all. CI
  replays one headlessly: `POST /docs/_run {"scenario":"<name>"}`.

The full Expectations grammar, **Module setup** (cross-module setup steps, the
`{ module, id, body?, params? }` artifact shape), `persist`, the `/docs/_fixtures` and
`/docs/_scenarios` doors (localhost-only, need `--allow-write`), and response-diff are in
**`references/cake.md`**.

## 5. FIX-CAKE — diagnosing a red walk

This is the assist half. When a step goes red, find the cause, then route the fix to the
right owner. The common causes, with their tells:

| Symptom in the walk | Cause | Fix (and owner) |
| --- | --- | --- |
| run-all red right after a spec change to `order`/`dependsOn`/`bind` (e.g. flipping a `[TYP]` to ext) | a **stale entrypoint controller** — `mod.ts` is create-once, so spec-derived binds went stale | delete `entrypoints/<surface>/mod.ts` + re-sync for fresh binds → **`rune:build`** |
| a step 422s before logic even runs; the body names a missing required field | a **required, unbound DTO field with no schema `example`** — a guaranteed 422 in any walk | add `[TYP:example=V]` in the spec (→ `rune:spec`) or seed it; the *example* surfacing is **`rune:docs`** |
| a `{{$input}}` / `{{ref}}` never resolves (amber in **Module inputs**) | nothing in scope **produces** that field | run the producer step first, set the input from an existing capture, or compose the producing module so `auto:` satisfies it — heal panel offers all three (§ heal) |
| a 422 with a path + constraint in the body | **`#assert` / DTO validation rejected the body** — the body literally names the failing path + constraint | read the body, fix the offending field (seed/edit) or the body shape; if the *contract* is wrong, that's a spec/body fix → **`rune:spec`** / **`rune:build`** |
| a step is green but the response is wrong | logic bug in a body | implement/repair the body → **`rune:build`** |

**Echoes are not producers.** An endpoint that *outputs the field it consumes* can't
bootstrap a value — it's excluded from producer matching, `unresolvedInputs`, the
cake's `auto:` index, and map edges. If an `$input` won't auto-satisfy, check that the
intended producer actually *mints* the field rather than echoing it (this is a frequent
spec-side cause → `rune:spec`).

**The heal panel (rules → Claude).** A failure the heal rules can name gets a yellow **⚠**
dot (not red) and a **heal** panel of one-click fixes. It works in two tiers by design:

1. **Rules (instant, offline, free)** — deterministic, client-side. Structured failure
   shapes (unresolved ref, 422 assert, a project error slug) become Apply buttons. The
   project's slug vocabulary lives in `spec/misc/heal-rules.json` — `rune sync` scaffolds
   a starter from the spec's fault slugs (with `todo: true` markers); **`rune:build`**
   enriches those. This skill **owns the heal-rules schema**.
2. **Ask Claude (the long tail)** — `POST /docs/_heal` forwards the failure bundle + the
   whole composed process graph to the private-claude service for a structured diagnosis
   + suggestions. Localhost-only; `503` until configured; can take minutes and spends the
   operator's Claude plan — which is why rules run first.

The two tiers, `POST /docs/_heal`, and the **full heal-rules JSON schema** (every `kind`
+ its fields, the `todo: true` marker rune writes, the `/docs/_heal-rules` door) are in
**`references/heal-rules.md`**.

## The loop you own

```text
serve (deno run -A bootstrap/mod.ts) ─▶ open /docs/<module> ─▶ Run all in order
        │
   green? ──yes──▶ pin: Expectations → Save fixtures (spec/misc/cake.json) ─▶ freeze a Scenario ─▶ done
        │
        no ─▶ diagnose (§5) ─▶ heal (rules → Claude) ─▶ route the real fix:
                 spec   → rune:spec      bodies/controller/tests/heal-enrichment → rune:build
                 runner → rune:framework swagger example                          → rune:docs
              ─▶ re-run (or POST /docs/_run for headless) until green + confirmed
```

Use the sequential-thinking MCP to reason through a red walk step by step before acting:
name the failing step, read its banner + response body, classify the cause with §5, then
apply the smallest fix and re-run. Evidence (the response body, the banner reason, the
`dryRun` cycle/`unresolvedInputs` report), not vibes.
