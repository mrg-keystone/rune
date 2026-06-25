---
name: "rune:framework"
description: >-
  The runtime that rune-generated Deno backends run on — the "back end" half of
  rune's world. Use when you tune or debug the *running* app rather than the
  `.rune` spec: `bootstrapServer` (the `{ listen, stop, backend, handler }`
  return), the in-process `backend.fetch` client, forwarding conn info to
  `Deno.serve`, and why a request 401s/403s. Covers the trust model (in-process
  + localhost trusted, network deny-by-default), `@Public`/`@Roles`, signed
  tokens + minting (`signToken`/`verifyToken`, `MANUAL_KEY`, `GET /_mint`),
  Firebase ID tokens (`FIREBASE_PROJECT_ID`), the `#assert`→`RuneAssertError`→HTTP
  422 mapping, the `@Endpoint`/`@EndpointController` option semantics
  (`order`/`dependsOn`/`bind`), the `exerciseEndpoints` headless runner +
  `POST /docs/_run`, the `/docs/_map` system map, and deployment (standalone,
  `embed` under Fresh 2, `withBasePath`, Deno Deploy, logging). Trigger phrases:
  "why is auth failing / 401 / 403", "forward remoteAddr / conn info",
  "embed the backend under Fresh", "deploy to Deno Deploy", "mint a token",
  "what does bootstrapServer return", "run exerciseEndpoints in CI". NOT the
  `.rune` language or modeling → use `rune:spec`; NOT generating/filling/testing
  a module → use `rune:build`; NOT the interactive cake walk / `/docs/<m>` UI /
  heal panel → use `rune:cake`; NOT Swagger examples / `@ApiProperty` /
  `/docs/<m>/json` doc content → use `rune:docs`.
---

# rune:framework — the runtime the generated code runs on

The DSL and the codegen are upstream; this skill is the backend the generated
code becomes once it runs. You rarely write runtime wiring by hand — `rune sync`
generates `bootstrap/` — but when you tune a running app, debug a 401, wire
`@Endpoint` metadata, run the headless runner, or mount/deploy, the runtime
facts here are what bite.

## This skill vs its siblings

- **`rune:spec`** — author/edit the `.rune` DSL (tags, scope, DTO suffixes,
  `[TYP]` modifiers, how the spec *expresses* order/deps/flows). The seam: a
  `rune check`-clean `spec/runes/<m>.in-prog.rune`. Come here once you're tuning the
  app it generates.
- **`rune:build`** — finalize that spec (`.in-prog` → `.rune`), `rune sync`,
  fill bodies, the TDD fleet, `rune lint`, green run-all. `rune:build` *runs*
  the app; this skill explains what the app *is*.
- **`rune:framework`** (here) — `bootstrapServer`, the in-process `backend`,
  `handler`/`listen` + conn-info forwarding, auth (401/403, `@Public`/`@Roles`,
  tokens, Firebase), the `#assert`→422 mapping, `@Endpoint` semantics, the
  headless runner, deploy/Fresh-embed/Deno Deploy.
- **`rune:cake`** — the interactive cake at `/docs/<module>`: Emulate/Run-all,
  expectations, scenarios, module setup, the heal panel. This skill *mounts*
  the cake and owns the headless runner under it; `rune:cake` drives the UI.
- **`rune:docs`** — the Swagger/Danet doc content: `@ApiProperty`, `example=`,
  `/docs/<m>/swagger` and `/docs/<m>/json`. This skill owns the auth *posture*
  on those routes (see `references/auth.md`); `rune:docs` owns the doc surface.

## `bootstrapServer` — initializes, does not listen

`bootstrapServer(appName, module | modules[], options?)` **initializes but does
NOT listen.** It returns `{ listen, stop, backend, handler }`:

- `listen()` — bind a real port.
- `backend.fetch(...)` — usable immediately (no `listen()` needed) for
  in-process calls (tests, SSR) with **no token** — it dispatches through the
  full server pipeline (controllers, guards, pipes, interceptors, filters,
  middleware) with no port or TCP, and is recognized as in-process so it
  bypasses token auth. It is `typeof fetch` — a true drop-in for client code.
- `handler` — mount it to serve without binding a port.

No `import "reflect-metadata"` needed — the package loads the polyfill itself.
Because it only initializes, bootstrap **once** in a shared module and import
the `api` everywhere (standalone server, tests, Fresh embed). Full mounting
shapes, the `backend` client, and logging live in `references/deployment.md`.

**Forward the conn info.** When you serve via your own `Deno.serve`, pass
`info` through:

```ts
Deno.serve((req, info) => api.handler(req, info));   // or: await api.listen();
```

`api.handler` takes `(req, info?)` and `info` carries `remoteAddr` — which
localhost trust, the token-auth localhost exemption, and the `/_mint` guard all
rely on. Drop it and every request looks origin-less: localhost stops being
recognized and `/_mint` becomes unreachable.

## Auth: deny-by-default, two trusted origins

Auth is a **global guard** — deny-by-default on every controller route. The
common "401 in my project" cases:

| Caller | Credential needed |
| --- | --- |
| `backend.fetch(...)` | none — in-process trust (a process-private header, unforgeable) |
| localhost | none by default (`TRUST_LOCALHOST=false` to require) |
| network | `Authorization: Bearer <token>` or `?token=` |

- `MANUAL_KEY=<secret>` signs/verifies tokens (set it per deployment; tests use
  any value, e.g. `MANUAL_KEY=k`, to silence the warning).
- `FIREBASE_PROJECT_ID=<id>` additionally accepts Firebase ID tokens
  (browser/frontend callers; verified against Google's public certs — only the
  project id, no service account).
- Mint a signed token at `GET /_mint` (localhost-only, 403 from the network) or
  with `signToken`.
- `@Public()` makes a route **auth-optional** (a valid credential is still
  attributed for logging; an invalid one is ignored, not rejected).
- `@Roles("admin")` requires a role. It **implies authentication**: no
  credential → 401; valid credential without the role → 403. Roles are
  namespaced `appName:role` and scoped to the app.

**Never route inbound network traffic through `backend.fetch`** — it's the
trusted channel and skips auth. Expose the API by mounting `api.handler`
(which strips the in-process trust header from every inbound request, so no
network request can impersonate an in-process call).

The full trust model — the in-process key, the localhost/loopback-proxy
caveat, the token shape + minting, `@Public`/`@Roles` rules, Firebase claims,
the docs-page browser token flow, and `signToken`/`verifyToken`/
`createFirebaseVerifier` — is in **`references/auth.md`**. Read it before
touching auth, roles, or anything returning 401/403.

## `#assert` → `RuneAssertError` → HTTP 422

The bodies you fill in are validated at the coordinator shell: whatever your
adapter or core returns must satisfy the DTO contract before it crosses a seam.
A failed contract throws `RuneAssertError { target, context, failures }` with
dotted failure paths (`"lines.1.qty"`); **the runtime maps it to HTTP 422** with
that body. Entrypoint controllers stay validation-free — validation lives in the
coordinator, the runtime maps the 422. `RUNE_ASSERT=off` turns every assert into
a passthrough (trusted prod mode). The *authoring* side of `#assert` — where you
place asserts in the spec and how `[TYP]` modifiers drive them — is the
**`rune:spec`** skill.

## `@Endpoint` semantics — the runtime view

Endpoints in a module run as a *process*. The `@Endpoint` metadata is the
contract the runner, the cake, and the map all read:

- `order` — position in the sequence (ascending).
- `dependsOn` — endpoint id(s) (the handler method names) that must run first.
- `bind` — `{ thisInputField: "otherEndpointId.outputField" }`: fill this
  request from an earlier response.

```ts
@Endpoint({ input: CreateOrderDto, output: OrderDto, order: 1 })
create(body: CreateOrderDto) { /* … */ }          // outputs { id }

@Endpoint({ path: "pay", input: PayDto, output: ReceiptDto, order: 2,
            dependsOn: "create", bind: { orderId: "create.id" } })
pay(body: PayDto) { /* … */ }
```

This metadata orders the cake's bullets and auto-chains `create`'s `id` into
`pay`'s `orderId` (and drives the headless runner). **You rarely write it by
hand:** `rune sync` derives `order`/`dependsOn`/`bind` from the DTO field graph
(same-named output→input fields chain automatically) when it generates the
entrypoint. The endpoint **id** is the handler method name. A *stale* generated
entrypoint controller is the classic cause of wrong order/deps — delete it and
re-sync.

The full `@EndpointController`/`@Endpoint` option tables, the three `bind`
value forms (`"id.field"`, `"$name"` external inputs, `["a","b"]` OR-joins),
and the `$name` resolution rules are in **`references/endpoints.md`**. How the
*spec* expresses order/deps/flows is the **`rune:spec`** skill.

## Verifying a running app — the headless runner

Serve the app (`deno run -A bootstrap/mod.ts`, generated by sync) and open
`/docs/<module>` for the interactive cake — that walk is the **`rune:cake`**
skill. For CI / unattended runs, call the same thing in code:

```ts
import { exerciseEndpoints } from "@mrg-keystone/rune";
const report = await exerciseEndpoints({ api });   // in-process; { passed, failed, … }
```

It discovers endpoints from the bootstrapped app's docs (ALL composed modules),
orders them topologically, chains outputs into inputs via `bind`, and loops
until green. Pass `overrides.seeds` / `overrides.byEndpoint` for values the
chain can't produce (and `overrides.auth` to bootstrap a token for a network
run), and `rateLimit` so retries don't hammer the server. Re-run after every
spec change. The localhost-only `POST /docs/_run` is the HTTP door to the same
runner (so an agent/CI can ask a *running* server "does the whole composed
process work right now?"), and `/docs/_map` renders the whole composed app as
one live process graph. Every option, the `$name` resolution order, the
composition acceptance pattern, the map mechanics, and the `/docs/_run` body
shape are in **`references/endpoints.md`**. `rune:cake` drives this runner for
real-data e2e; `rune:build` calls it as a CI gate.

## Deployment and embedding

`bootstrapServer` is bundler-safe and serves three ways:

- **Standalone** — `Deno.serve((req, info) => api.handler(req, info))` (forward
  `info`!) or `await api.listen()`.
- **Embedded under Fresh 2** — one `embed(api, { at: "/api" })` middleware
  exposes the token-gated backend at `/api/*` and puts the in-process client on
  `ctx.state.api`. Register it **before** `.fsRoutes()`. Fresh server code calls
  the backend in-process (`await ctx.state.api.fetch(...)` — no token);
  browser-side island calls to `/api` need a credential.
- **Anything else** — `withBasePath(prefix, handler)` dispatches `prefix`-rooted
  requests with the prefix stripped, 404s the rest.

**Deno Deploy:** set `MANUAL_KEY` and/or `FIREBASE_PROJECT_ID` (plus
`DD_API_KEY` / `POSTMARK_*`) in the project env; `/_mint` is unreachable in
production (403s off-localhost) — mint locally or with `signToken`. The full
mounting recipes, the in-process `backend` client surface, request/`log`
logging internals, the smaller exports (`setupWithSwagger`, `Server`,
`DanetDocumentBuilder`, the DI builders), and the keep-repo release flow are in
**`references/deployment.md`**.

## References

- **`references/auth.md`** — the complete trust model, token shape + minting,
  `@Public`/`@Roles`, docs access, the browser/frontend token pattern,
  `signToken`/`verifyToken`/`createFirebaseVerifier`. Read before touching auth,
  roles, or anything returning 401/403.
- **`references/deployment.md`** — standalone vs Fresh-embedded mounting,
  `embed`/`withBasePath`, the in-process `backend` client, logging internals,
  Deno Deploy, and the JSR release flow. Read when deploying or embedding.
- **`references/endpoints.md`** — every `@Endpoint`/`@EndpointController`
  option, the `bind` value forms, the `exerciseEndpoints` runner (options,
  `$name` resolution, composition acceptance), `/docs/_map`, and `POST /docs/_run`.
  Read when wiring process chains, running the headless runner, or gating CI.
