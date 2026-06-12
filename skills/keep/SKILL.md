---
name: keep
description: >-
  Build Deno backend APIs with @mrg-keystone/keep (the danet-based framework:
  bootstrapServer, @Endpoint process chains, auto Swagger, the per-module
  cake at /docs, token/Firebase auth, in-process backend client,
  Fresh embedding). Use this whenever code imports @mrg-keystone/keep, calls
  bootstrapServer or exerciseEndpoints, decorates with @Endpoint /
  @EndpointController, works inside the keep repo or a rune-generated project,
  or the user asks about keep's cake, /docs pages, /docs/_map, token
  minting, @Public/@Roles, or embedding an API under Fresh. Trigger even for
  "add an endpoint", "wire these two modules together", or auth/401 debugging
  in any keep-based app — keep's process metadata, trust model, and mounting
  rules are non-obvious and easy to get wrong without this skill.
---

# keep

keep (`@mrg-keystone/keep` on JSR) is an opinionated Deno backend framework on
top of `@danet/core`. One call — `bootstrapServer` — gives you: routed
controllers, per-module Swagger docs, an interactive **cake** per
module, a live **system map**, deny-by-default token auth with localhost and
in-process trust, request-scoped structured logging (Datadog), and an
in-process HTTP client. It is the runtime that `rune`-generated projects
target, but it works standalone.

## Mental model

- **`bootstrapServer(appName, module | modules[], options?)` initializes but
  does NOT listen.** It returns `{ listen, stop, backend, handler }`. Call
  `listen()` for a real port; use `backend.fetch(...)` immediately for
  in-process calls (tests, SSR); mount `handler` to serve without binding.
- **Endpoints declare their process.** `@Endpoint({ order, dependsOn, bind,
  flows, optional, stub })` metadata rides into the module's OpenAPI doc
  (`x-keep-process`) and drives the cake, the map, and the headless
  runner. The metadata IS the contract — write it deliberately.
- **Auth is deny-by-default for network callers**; in-process (`backend`) and
  localhost callers are trusted. Everything else needs a signed token
  (`MANUAL_KEY`) or a Firebase ID token (`FIREBASE_PROJECT_ID`).
- **Composition is by field name.** A `bind: { memberId: "$memberId" }`
  external input auto-wires to ANY composed module whose endpoint outputs a
  `memberId` field — cake and runner both snap together with zero glue.

## Quick start — a process module

```ts
import {
  bootstrapServer,
  Endpoint,
  EndpointController,
  endpointModule,
} from "@mrg-keystone/keep";
import { ApiProperty } from "jsr:@danet/swagger@2/decorators";

class CreateOrderDto {
  @ApiProperty()
  item!: string;
}
class OrderDto {
  @ApiProperty()
  id!: string;
}
class PayDto {
  @ApiProperty()
  orderId!: string;
}
class ReceiptDto {
  @ApiProperty()
  receipt!: string;
}

@EndpointController("orders", { description: "Orders API" })
class OrdersController {
  @Endpoint({ input: CreateOrderDto, output: OrderDto, order: 1 })
  create(body: CreateOrderDto): OrderDto {
    return { id: "o_1" };
  }

  // Runs after create; its orderId fills from create's captured id.
  @Endpoint({
    path: "pay",
    input: PayDto,
    output: ReceiptDto,
    order: 2,
    dependsOn: "create",
    bind: { orderId: "create.id" },
  })
  pay(body: PayDto): ReceiptDto {
    return { receipt: `paid ${body.orderId}` };
  }
}

export const api = await bootstrapServer(
  "shop",
  endpointModule("Orders", [OrdersController]),
);
// await api.listen();           // real port (default 3000)
// await api.backend.fetch("/orders"); // in-process, no listen, no token
```

Type the handler param as the input DTO — `@Endpoint` wires `@Body()` for
you (don't add it). Method defaults to `"post"`; `path` defaults to the
handler name. Plain danet `@Controller`/`@Get` modules work too and get
Swagger pages; `@Endpoint` adds the process layer on top.

To compose several modules into one app, pass an array:
`bootstrapServer("shop", [ordersModule, membersModule])` — each keeps its own
`/docs/<module>` page and they share one process graph.

## The process contract (`bind` forms and friends)

- `order: number` — position in the walk (ascending).
- `dependsOn: string | string[]` — endpoint ids (handler method names) that
  must succeed first.
- `bind: { field: ... }` — request autofill. Three value forms:
  - `"otherEndpointId.outputField"` — fill from a captured response;
  - `"$name"` — an **external input** nothing in this module produces. The
    cake shows it under a "Module inputs" card; the headless runner reads
    `overrides.seeds[name]`; a composed producer of a same-named field
    satisfies it automatically (seed/typed value always wins).
  - `["payCard.paymentId", "payCash.paymentId"]` — alternatives, first
    resolvable wins (the join after a branch).
- `flows: string | string[]` — named XOR branches. Untagged endpoints belong
  to every flow; within an active flow, dependencies on endpoints outside it
  don't gate.
- `optional: true` — attempted but never blocks a run (failures land in
  `report.optionalFailed`, not `report.failed`).
- `stub: true` — a generated stand-in minting placeholder values (what rune's
  ghost-stub module emits); badged in the cake, treated as a producer by
  the auto-wiring, not part of the real process.

## Verify the work — cake first, then headless

After wiring endpoints, **prove the chain runs, don't just type-check**:

1. Serve the app and open **`/docs/<module>`** — the cake. "Run
   all in order" walks the chain, stops at the first failure with the exact
   step and reason; every green step captures outputs that pre-fill
   dependents. Session state survives reloads.
2. **`/docs/_map`** shows the whole composed app as one live graph — module
   lanes, solid bind edges, dashed `$input` contracts, status dots that
   recolor as you run steps in any tab. Click a node to deep-link into its
   cake step.
3. In tests/CI, run the same walk headlessly:

```ts
import { exerciseEndpoints } from "@mrg-keystone/keep";
const report = await exerciseEndpoints({ api }); // in-process, no token
// { passed, failed, optionalFailed, iterations, order, cycles, unresolvedInputs }
await exerciseEndpoints({
  api,
  flow: "card",
  overrides: { seeds: { memberId: "m-7" } },
});
```

`$name` resolution order: `overrides.seeds[name]` first; with no seed, the
first captured response owning a same-named field (from any composed module)
— the runner adds a synthetic edge so producers run before consumers. A
composed app with real or stub producers needs **no seeds at all**.

4. Against a *running* server, **`POST /docs/_run`** (localhost-only, like
   `/_mint`) runs the same walk over HTTP and returns the JSON report — for an
   agent / CI / the map UI to verify a live app. `{ dryRun: true }` returns just
   `order` / `cycles` / `unresolvedInputs` (a pre-flight naming cycles and
   unsatisfied `$inputs`) without firing a request.

For the edit loop, run the server under **`KEEP_DEV=<status-file>`** (or let
`rune dev` drive it): `/docs/_dev` serves a bootId, the docs pages poll it
and auto-reload on restart with session state intact.

## Auth in one minute

| Caller                       | Credential needed                     |
| ---------------------------- | ------------------------------------- |
| `backend.fetch(...)`         | none — in-process trust               |
| localhost                    | none by default (`TRUST_LOCALHOST=false` to require) |
| network                      | `Authorization: Bearer <token>` or `?token=` |

- `MANUAL_KEY=<secret>` signs/verifies tokens (set it for every deployment;
  tests use any value, e.g. `MANUAL_KEY=k`, to silence the warning).
- `FIREBASE_PROJECT_ID=<id>` additionally accepts Firebase ID tokens.
- Mint tokens at **`GET /_mint`** (localhost-only UI) or with `signToken`.
- `@Public()` makes a route auth-optional; `@Roles("admin")` requires a role
  (namespaced `appName:role` in the credential; implies authentication).
- **Never route inbound network traffic through `backend.fetch`** — it is the
  trusted channel and skips auth. Expose the API by mounting `api.handler`;
  it strips the trust header from inbound requests by construction.

Read `references/auth.md` before changing anything auth-related — the trust
model, token shape, docs gating, and browser token flow live there.

## Environment variables (all optional, warn-once)

| Var | Effect |
| --- | ------ |
| `MANUAL_KEY` | token signing secret — without it no token can be minted/verified |
| `FIREBASE_PROJECT_ID` | accept Firebase ID tokens (verified against Google certs) |
| `TRUST_LOCALHOST` | `false` → localhost also needs a token |
| `DD_API_KEY` | ship structured logs to Datadog (else console only) |
| `POSTMARK_SERVER_TOKEN` / `POSTMARK_FROM` / `POSTMARK_TO` | log-failure alert emails |
| `KEEP_DEV` | path to a dev status file → `/docs/_dev` + page auto-reload |

## Pitfalls

- `bootstrapServer` only initializes — nothing serves until `listen()` or you
  mount `handler`. Conversely, `backend` works *before* any listen.
- When serving via your own `Deno.serve`, forward the conn info:
  `Deno.serve((req, info) => api.handler(req, info))` — dropping `info` makes
  every request origin-less, so localhost trust and `/_mint` break.
- The OpenAPI spec endpoint `/docs/<module>/json` is token-gated even though
  the doc *pages* load publicly — a 401 there means the token in
  `localStorage` is stale (reopen with a fresh `?token=` link).
- `exerciseEndpoints` with a `baseUrl` needs Playwright provisioned (it uses
  `APIRequestContext` over real HTTP); in-process runs need nothing.
- Logging awaits Datadog delivery just before each response — slow responses
  with `DD_API_KEY` set are usually that round-trip, not your handler.

## References (read on demand)

- `references/process.md` — full `@Endpoint`/`EndpointController` options,
  cake features ({{refs}}, variables, flows, cross-module captures), the
  system map, dev mode, and every `exerciseEndpoints` option. Read when
  authoring process chains, debugging the cake, or wiring CI runs.
- `references/auth.md` — the complete trust model, token shape and minting,
  `@Public`/`@Roles` semantics, docs access flow, browser/frontend token
  pattern, `signToken`/`verifyToken`/`createFirebaseVerifier`. Read before
  touching auth, roles, or anything that returns 401/403.
- `references/deployment.md` — standalone vs Fresh-embedded mounting,
  `embed`/`withBasePath`, the in-process `backend` client, logging internals,
  Deno Deploy notes, and the JSR release flow. Read when deploying, embedding
  under Fresh, or composing the handler into another server.

The package README carries the same material in long form; in a rune-generated
project, see the `rune` skill for the spec-side workflow (keep is the runtime
those specs target).
