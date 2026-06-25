# @mrg-keystone/rune

An opinionated Deno backend framework built on
[`@danet/core`](https://jsr.io/@danet/core). It bundles server bootstrapping
with automatic OpenAPI/Swagger docs, a unified auth/identity layer (signed
tokens, Firebase, roles), an in-process API client with a private-key trust
channel, request-scoped structured logging to Datadog, and first-class Fresh
frontend embedding.

> This package is the **runtime layer** of
> [rune](https://github.com/mrg-keystone/rune) — rune-generated projects target it.
> It also runs perfectly well standalone; this README documents that standalone
> surface.

## Quick Start

```typescript
import "reflect-metadata";
import { bootstrapServer, log, SwaggerDescription } from "@mrg-keystone/rune";
import { Controller, Get, Module } from "@danet/core";

@Controller("health")
class HealthController {
  @Get()
  check() {
    return { status: "ok" };
  }
}

@SwaggerDescription("Users API")
@Controller("users")
class UsersController {
  @Get()
  list() {
    return [{ id: 1, name: "Alice" }];
  }
}

@Module({ controllers: [HealthController] })
class HealthModule {}

@Module({ controllers: [UsersController] })
class UsersModule {}

@Module({ imports: [HealthModule, UsersModule] })
class AppModule {}

const server = await bootstrapServer("my-api", AppModule, { port: 3000 });
await server.listen();
```

This starts a server on port 3000 with:

- `/health` and `/users` endpoints
- `/docs` landing page with links to per-module Swagger specs
- ingress/egress logging for every request, shipped to Datadog (when
  `DD_API_KEY` is set)
- access-token authorization on every **network** request (in-process and
  localhost callers are exempt) — see
  [Access tokens & authorization](#access-tokens--authorization)

## API

### `bootstrapServer(appName, module, options?)`

Creates and configures a server with optional Swagger documentation and request
logging.

- `appName` — used in every log line and as the Datadog `service`
- `module` — root application module class, or an **array of modules** (composed
  into one root internally via `appModule`; each keeps its own `/docs/<module>` page)
- `options.port` — port number (default: 3000)
- `options.swagger` — `true` (default), `false`, or `{ filters: string[] }` to
  exclude modules

Returns `{ listen(), stop(), backend, handler }`:

- `listen()` / `stop()` — start/stop the server on the configured port
- `backend` — in-process HTTP client (see
  [`backend`](#backend--in-process-http-client))
- `handler` — the raw `(Request) => Response` dispatcher (the same pipeline
  `listen()` serves); use it to serve without binding a port
  (`Deno.serve(handler)`) or to compose the backend into another app (see
  [Deployment](#deployment))

#### Logging environment variables

Logging is driven entirely by environment variables — nothing is passed in code:

| Variable                | Enables              | If missing                                                   |
| ----------------------- | -------------------- | ------------------------------------------------------------ |
| `DD_API_KEY`            | Datadog logging      | warns once, logs to console only                             |
| `POSTMARK_SERVER_TOKEN` | failure-alert emails | warns once, failures fall back to console                    |
| `POSTMARK_FROM`         | failure-alert emails | (required with the token) must be a verified Postmark sender |
| `POSTMARK_TO`           | —                    | alert recipient; defaults to `POSTMARK_FROM`                 |

The Datadog site is fixed to `us5.datadoghq.com`, and alert emails use a
5-minute cooldown.

#### Authorization environment variable

| Variable              | Enables                                                                                 | If missing/blank                                                                              |
| --------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `MANUAL_KEY`          | the secret that **signs and verifies** signed access tokens                             | warns once; tokens can't be minted (mint UI fails closed) and signed tokens can't be verified |
| `FIREBASE_PROJECT_ID` | accepting **Firebase Auth** ID tokens as an alternative credential                      | warns once; Firebase path off (signed tokens only)                                            |
| `TRUST_LOCALHOST`     | set to `false` to require a token even from localhost (in-process key trust unaffected) | defaults to `true` — localhost callers are trusted                                            |

`MANUAL_KEY` is the per-app signing secret; `FIREBASE_PROJECT_ID` is your
Firebase project id (only the project id is needed — ID tokens are verified
against Google's public certs, so no service-account `FIREBASE_CLIENT_EMAIL` /
`FIREBASE_PRIVATE_KEY` is required). Both are read from the environment so they
never live in the (public) package source. If **neither** is set, no network
request can authorize. See
[Access tokens & authorization](#access-tokens--authorization).

### Access tokens & authorization

Every **network** request must present a valid credential; requests from the
in-process `backend` client and from `localhost` are trusted and need none.

| Caller                            | How it's recognized                                               | Credential required?                       |
| --------------------------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| In-process (`backend.fetch(...)`) | a process-private key stamped on the request (`x-danet-internal`) | **No** — trusted                           |
| `localhost`                       | loopback peer address                                             | **No** — trusted                           |
| Network (anything else)           | neither of the above                                              | **Yes** — `401` without a valid credential |

The Swagger docs are **token-gated** — see [Docs access](#docs-access) for how
the browser flow works. The localhost `/_mint` UI is always blocked from the
network.

The in-process key is a random value minted at boot (`crypto.randomUUID()`),
shared only between the `backend` client and the auth middleware. It never
leaves the process — not an env var, not sent over the network, and redacted
from logs — so a network client cannot forge it. It's compared in constant time,
and is regenerated every boot.

> **On localhost trust.** The loopback check uses the connection's real TCP peer
> address (`remoteAddr`), never the spoofable `X-Forwarded-For` header. A remote
> client cannot make a connection appear to come from `127.0.0.1` (the OS drops
> loopback-sourced packets from external interfaces, and TCP can't complete a
> handshake against a spoofed source). The one caveat is a reverse proxy
> **running on the same host**: it connects over loopback, so its remote clients
> would ride in on a genuinely-local connection and bypass the token. Don't
> front the app with a same-host loopback proxy while relying on this — expose
> it directly, or set **`TRUST_LOCALHOST=false`** to require a token even from
> localhost (the in-process key trust stays, so SSR / `backend.fetch` keeps
> working). It's also handy for testing the gated path.

> ### ⚠️ Security: the in-process bypass and how to mount safely
>
> `backend.fetch(...)` is a **trusted channel** — anything dispatched through it
> skips auth (that's how SSR calls your own API without a token). This is
> correct for _originating_ your own calls, but it is a footgun if you use it to
> **proxy inbound network traffic**: routing external requests through
> `backend.fetch` would serve them auth-exempt. **Never route inbound requests
> through `backend.fetch`.** To expose the API over the network, mount
> **`api.handler`** (via `Deno.serve` or `withBasePath`) — that's the network
> entry point.
>
> The framework makes the safe path safe by construction:
>
> - **`api.handler` strips the in-process trust header** from every inbound
>   request. So a network request — whatever it sends, however it's mounted or
>   proxied — can **never** impersonate an in-process call. In-process trust is
>   only granted to `backend.fetch`, which dispatches through a separate
>   non-stripping path.
> - **Swagger docs do not honor the in-process bypass at all.** The spec
>   (`/docs/<module>/json`) is served only to a genuine loopback caller or a
>   valid token — so even if you wrongly route docs through `backend.fetch`, the
>   API surface stays gated.
> - The in-process key is unguessable, never sent to the network, and redacted
>   from logs.
>
> Net: if you mount with `api.handler`, an integrator **cannot** accidentally
> expose the API or the docs. The only way to bypass auth is to deliberately
> pipe inbound traffic through `backend.fetch` — don't.

A network caller authorizes by sending a credential in the `Authorization`
header:

```
Authorization: Bearer <credential>
```

The same credential is also accepted as a **`?token=<credential>`** query param.
That's for callers that can't set a header — a plain link, a first browser
navigation, or a WebSocket upgrade. Prefer the header where you can: a token in
a URL can leak via history and `Referer`, so the query value is **redacted from
request logs**, and the Fresh frontend pattern below seeds it once from
`?token=` then sends it as a header thereafter.

The credential may be **either** of two things — whichever validates first
authorizes the request:

1. **A signed access token** (HS256, keyed by `MANUAL_KEY`) — for
   service-to-service callers. Mint one with the localhost UI or `signToken`
   (below).
2. **A Firebase Auth ID token** — for browser/frontend callers. When
   `FIREBASE_PROJECT_ID` is set, the backend verifies the ID token against
   Google's public certs (RS256 + `aud`/`iss`/ `exp` checks). This is what lets
   a Fresh frontend's island/`fetch` calls hit `/api` using the user's Firebase
   login, with no signed token.

The resolved identity is attributed to every log emitted during the request (it
appears as a `source` attribute alongside `requestId`): the token's `source` for
a signed token, or the user's email (falling back to uid) for a Firebase token.

#### `@Public()` — opt a route out of auth

Auth is enforced as a **global guard**, so it's **deny-by-default** on every
controller route. Mark a controller or a single handler `@Public()` to make a
credential optional there:

```ts
import { Public } from "@mrg-keystone/rune";

@Controller("inbound")
class WebhookController {
  @Public() // gated by its own webhook secret, not a danet token
  @Post()
  receive() {/* ... */}
}
```

- Class-level `@Public()` exempts every route on the controller; method-level
  exempts one.
- **Public means auth-optional, not auth-ignored**: a valid credential on a
  `@Public` route is still verified and its `source` attached for logging — it
  just isn't required (an invalid one is ignored rather than rejected).
- It only covers **controllers** (DI routes). The framework's own direct routes
  (`/docs`, `/_mint`) aren't controllers — they self-gate, so they don't need
  `@Public`.
- Grep `@Public` to enumerate every unauthenticated route.

`@Public` is about **authentication** (is a credential required). For
**authorization** by role, use `@Roles` (below).

#### `@Roles()` — restrict a route by role

Limit a controller or handler to callers holding **at least one** of the listed
roles. The same global guard enforces it right after authentication:

```ts
import { Roles } from "@mrg-keystone/rune";

@Controller("users")
class UsersController {
  @Roles("admin") // only callers with the "admin" role
  @Delete(":id")
  remove() {}
}
```

- **`@Roles` implies authentication** — a role-gated route always needs a valid
  credential (it overrides `@Public`). No credential → `401`; valid credential
  without a listed role → `403`.
- Method-level `@Roles` overrides class-level; trusted origins (in-process /
  localhost) bypass it like all auth (use `TRUST_LOCALHOST=false` to enforce
  roles locally too).

**Roles are namespaced `appName:role`.** A single user can hold roles across
several apps, so each role is stored prefixed with the app it belongs to (e.g.
`billing:admin`, `orders:editor`). The guard knows its own `appName` and
**scopes** to it: `@Roles("admin")` on the `billing` app matches the claim
`billing:admin` and ignores `orders:*`. `getIdentity(ctx)` returns the scoped
(bare) roles for this app.

**Where roles come from** — they ride _in_ the verified credential, no extra
lookup:

- **Firebase**: set them as **custom claims** with the Admin SDK (from your
  admin tooling / Cloud Function — verifying needs only `FIREBASE_PROJECT_ID`,
  setting needs the service account):
  ```ts
  admin.auth().setCustomUserClaims(uid, {
    roles: ["billing:admin", "orders:viewer"],
  });
  ```
  The backend reads `roles` (array) and/or `role` (string) from the ID token.
  Note custom-claim changes only apply once the client's ID token refreshes.
- **Signed tokens**: include namespaced `roles` in the payload —
  `signToken({ source, appName, expiry, roles: ["billing:admin"] }, key)`.

The resolved caller is attached to the request; read it in a handler with
`getIdentity(ctx)` → `{ source, roles }` (roles scoped to this app).

#### Token shape

A token is a compact JWT (`HS256`) signing these claims:

```ts
interface TokenPayload {
  source: string; // who the token was minted for — used for log attribution
  expiry?: number; // Unix epoch in SECONDS; the token is rejected once passed.
  // OMIT for a token that never expires.
  appName: string; // the app the token grants access to
  roles?: string[]; // namespaced `appName:role` entries, checked by @Roles
}
```

> A token with no `expiry` **never expires** and can only be invalidated by
> rotating `MANUAL_KEY` (which invalidates all signed tokens). Mint these
> sparingly.

The signature is keyed by `MANUAL_KEY`, so neither the expiry nor any claim can
be altered without invalidating the token. `verifyToken` rejects a token that is
malformed, mis-signed, or expired.

#### Minting tokens — the localhost UI

`bootstrapServer` mounts a token-minting UI at **`GET /_mint`** that works on
`localhost` only (any non-loopback request gets `403`). Open it in a browser,
fill in `source`, `appName`, and `expires in` (seconds from now — with a live
Eastern-time preview of the expiry, or tick **never expires**), and submit to
receive a token (auto-copied to your clipboard). The result page also shows a
ready-to-share **`…/docs?token=…` link** (with copy buttons) — derived from the
page's own location, so it's correct whether the app runs standalone or mounted
under Fresh at `/api`. The signing key is read from `MANUAL_KEY` on the server —
it is never entered into or returned by the form. If `MANUAL_KEY` is unset,
minting fails closed.

#### Docs access

The Swagger docs are gated, but a browser navigating to `/docs` can't send an
`Authorization` header — so docs use a **query-param → localStorage** flow:

- The doc pages (`/docs` and the per-module Swagger UI shells) are served
  **publicly** so they always load. The actual OpenAPI spec lives at a **gated**
  `/docs/<module>/json` endpoint.
- Open any doc page with `?token=<signed token>`. A small inline script saves
  the token to `localStorage` and strips it from the URL.
- Swagger UI then fetches the spec over XHR with `Authorization: Bearer <token>`
  from `localStorage` — which **persists across same-origin navigation**, so
  once seeded you can move between modules without re-supplying it.
- If the spec request returns `401` (token missing, invalid, or expired), the
  script **wipes** the stored token and shows a message to reopen with a fresh
  `?token=…` link.

So you share a `…/docs?token=…` link once; the token is reused from
`localStorage` until it stops working. This also works mounted under Fresh — the
shell derives the spec URL from its own path, so `/api/docs/<module>` fetches
`/api/docs/<module>/json`.

#### Browser access to your own API (frontend token)

The same query-param → `localStorage` flow works for your app's `/api`, so a
browser/island can call the gated API without you wiring a token into every
`fetch`. Drop this in a client entry (e.g. a Fresh `client.ts`) — it seeds the
token from `?token=`, attaches it to same-origin `/api/*` requests, and drops it
when one comes back `401`:

```ts
const KEY = "danet:token";

// Seed once from ?token=, then strip it from the URL.
const url = new URL(location.href);
const seeded = url.searchParams.get("token");
if (seeded) {
  localStorage.setItem(KEY, seeded);
  url.searchParams.delete("token");
  history.replaceState(history.state, "", url.toString());
}

// Auto-attach on /api/* requests; clear on a 401 (stale/expired).
const isApi = (u: string) =>
  new URL(u, location.origin).pathname.startsWith("/api/");
const native = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const req = new Request(input as RequestInfo, init);
  const token = localStorage.getItem(KEY);
  if (token && isApi(req.url) && !req.headers.has("authorization")) {
    req.headers.set("authorization", `Bearer ${token}`);
  }
  const res = await native(req);
  if (token && isApi(req.url) && res.status === 401) {
    localStorage.removeItem(KEY);
  }
  return res;
};
```

You hand someone a `…/probe?token=…` link once; the browser remembers it and
authorizes every subsequent API call until it stops working. (Server-side
rendering should still prefer `api.backend.fetch(...)` — in-process, no token.
This is only for calls the browser itself makes over the network.) See the
runnable [`examples/fresh-project`](../examples/fresh-project) for a working
`client.ts` + `/probe` page.

> **Use a short-lived token in the link.** A token in a URL can be
> shoulder-surfed, kept in history, or forwarded in a `Referer`. Mint link
> tokens with a **short expiry** (`signToken({ …, expiry })`, minutes/hours) —
> they're moved to a header and stripped from the URL immediately, and a stale
> one is dropped on the next `401`. Don't seed a **never-expiring** token this
> way.

#### Programmatic sign / verify

The primitives are exported for use outside the UI:

```ts
import { signToken, TokenError, verifyToken } from "@mrg-keystone/rune";

const token = await signToken(
  {
    source: "ci-runner",
    appName: "my-api",
    expiry: Math.floor(Date.now() / 1000) + 3600,
  },
  Deno.env.get("MANUAL_KEY")!,
);

try {
  const payload = await verifyToken(token, Deno.env.get("MANUAL_KEY")!);
  // payload: { source, appName, expiry }
} catch (err) {
  if (err instanceof TokenError) { /* malformed, mis-signed, or expired */ }
}
```

#### Verifying Firebase ID tokens directly

`bootstrapServer` wires Firebase verification automatically when
`FIREBASE_PROJECT_ID` is set. The verifier is also exported if you need it
standalone:

```ts
import { createFirebaseVerifier, FirebaseAuthError } from "@mrg-keystone/rune";

const firebase = createFirebaseVerifier({
  projectId: Deno.env.get("FIREBASE_PROJECT_ID")!,
});

try {
  const { uid, email } = await firebase.verify(idTokenFromClient);
} catch (err) {
  if (
    err instanceof FirebaseAuthError
  ) { /* missing, malformed, mis-signed, or expired */ }
}
```

Signing keys are fetched from Google and cached (honoring the certs'
`Cache-Control`).

### `backend` — in-process HTTP client

The returned `backend` runs requests against the **exact** server pipeline
(controllers, guards, pipes, interceptors, exception filters, middleware) by
dispatching through the underlying handler — no port binding, no TCP, just an
`async` call. `bootstrapServer` itself only initializes (it does **not**
`listen()`), so `backend` is usable immediately, and importable from anywhere:

```typescript
// server.ts
export const app = await bootstrapServer("my-api", AppModule); // init only — non-blocking
// elsewhere.ts
import { app } from "./server.ts";
await app.backend.fetch("/users"); // ✅ no listen() required
```

#### `backend.fetch(input, init?)` — drop-in for global `fetch`

Mirrors the global `fetch` signature exactly and returns the raw `Response`.
Relative paths resolve against the server's origin, so they work here even
though global `fetch` would reject them:

```typescript
const res = await backend.fetch("/users"); // → Response
const json = await res.json();

await backend.fetch("/users", { // full RequestInit
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Bob" }),
});

await backend.fetch(new Request("http://localhost/users")); // Request object also works
```

Because it's `typeof fetch`, it's a true drop-in: swap `fetch` → `backend.fetch`
and any existing client code (your own wrappers, etc.) keeps working,
in-process.

Requests made through `backend` are recognized as in-process and **bypass token
auth** automatically (see
[Access tokens & authorization](#access-tokens--authorization)) — no token is
needed to call your own API from within the process.

### Logging

Every request is wrapped by a logging middleware that emits two correlated
entries:

```
[ingress my-api 8f3c…] GET /users     + { headers, query, body, routePath }   (structured)
[egress  my-api 8f3c…] GET /users     + { status, headers, body }             (structured)
```

The message carries the `[ingress|egress <appName> <requestId>]` tag; the
structured data is attached as log attributes — the expandable JSON ("the
zippy") in Datadog. The request id is taken from an inbound `x-request-id` /
`x-correlation-id` header, or generated, and is echoed back on the response's
`x-request-id` header. Egress level is derived from the status (`>=500` → error,
`>=400` → warn, else info). `authorization` / `cookie` headers are redacted.

#### `log` — request-scoped structured logger

Import `log` anywhere and call `log.<level>(message, data?)`. Inside a request
it is **automatically** tagged with `[<appName> <requestId>]` (matching the
surrounding ingress/egress) and `data` becomes the structured attributes:

```typescript
import { log } from "@mrg-keystone/rune";

class UsersService {
  create(dto: CreateUser) {
    log.info("creating user", { email: dto.email });
    // → console + Datadog: "[my-api 8f3c…] creating user"  { email, requestId }
  }
}
```

Levels: `log.debug`, `log.info`, `log.warn`, `log.error`. Outside a request the
tag is `[<appName>]`.

**Calls are synchronous** — `log.*` writes to the console and fires the Datadog
request, but never awaits the network itself. Each entry is stamped at **call
time** with an ISO `timestamp` and a monotonic `seq`, so ordering reflects when
`log()` was called, not when it was sent.

**Delivery** — each log fires its Datadog request **immediately, as the log
happens** (fire-and-forget), and the in-flight promises are collected on the
request. Just before the response is sent — on **any** status code, success or
error — the middleware `await`s them all (`Promise.all`), so every log request
has returned before the client gets its response. Sends started early (ingress,
mid-handler) overlap with the handler's work; the wait at the end is dominated
by the egress log, which is sent at the boundary.

A log request **never throws** into your code: each send is wrapped, and on
failure (network error or non-2xx from Datadog) the logger **falls back to
console** (surfacing the failure and the log) **and** raises a **Postmark alert
email** — the email throttled to one per `POSTMARK_ALERT_COOLDOWN_MS` window
(default 5 min) so an outage can't flood your inbox. Logs emitted outside a
request fire fire-and-forget.

> Note: awaiting before responding guarantees delivery but adds roughly one
> Datadog round-trip to each response (the egress send starts at the boundary).
> If you'd rather not block the response, the alternative is to let the sends
> complete off the response path (event loop on a long-running server, or
> `waitUntil` on serverless) — ask and it's a small switch.

#### Shipping to Datadog — environment gating

Having `DD_API_KEY` set means you *have* credentials, not that every run should
*ship*. Shipping is gated on environment so the key can live everywhere (a
deploy "just works") without local dev polluting production logs:

- **On Deno Deploy** (`DENO_DEPLOY=1`, set automatically) → ships, tagged
  `env:production`.
- **Locally, by default** → console only, even with the key present.
- **Locally with `KEEP_DD_LOCAL=1`** → ships, tagged `env:local` and prefixed
  `[LOCAL]` in the message, so it stays segmented from production in Datadog.

The `env` value rides on every entry as an `env:` Datadog tag (the reserved
environment facet). The site is `us5.datadoghq.com`. `KEEP_DD_LOCAL` gates both
logs and [traces](#shipping-to-an-apm-datadog-over-otlp) the same way.

### `embed(api, { at })`

One-call Fresh 2 integration: returns a middleware that exposes the token-gated
backend under `at` (default `/api`) — with Fresh's conn info forwarded so
loopback detection keeps working — and puts the in-process client on
`ctx.state.api` for every other request. Extend your Fresh `State` with the
exported `KeepState` to get `ctx.state.api` typed. See
[Deployment](#deployment).

### `withBasePath(prefix, handler)`

The low-level mount `embed` builds on. Wraps a root-based `handler` so it can be
mounted under `prefix`: requests whose path is `prefix` or starts with
`prefix + "/"` are dispatched with the prefix stripped (so the root-registered
routes still match); anything else returns `404`. Reach for it directly when
composing the handler into something other than Fresh.

### `createFirebaseVerifier({ projectId })`

Returns a verifier whose `verify(idToken)` validates a Firebase Auth ID token
(RS256 against Google's public certs, plus `aud`/`iss`/`exp`) and resolves
`{ uid, email? }`, or throws `FirebaseAuthError`. `bootstrapServer` uses it
automatically when `FIREBASE_PROJECT_ID` is set; exported for standalone use.
See [Access tokens & authorization](#access-tokens--authorization).

### `setupWithSwagger(server)`

Lower-level alternative. Takes an existing `Server` instance and returns a
configured `HttpAdapter` with Swagger routes registered, without starting it.

### `@SwaggerDescription(description)`

Decorator to attach a custom description to a module's Swagger documentation.

### `Server`

Module registry. Create with `Server.create()`, register modules with
`registerModule()`.

### `DanetDocumentBuilder`

Generates OpenAPI 3.0 specification objects from module metadata.

### `InjectValue`, `InjectFactory`, `InjectClass`

Dependency injection container builders for configuring injectable services.

## Process endpoints, the cake, and the exercise harness

A module's endpoints can declare their **process order** and **data
dependencies** right on the handler, so keep can (1) serve them, (2) document
them in Swagger, (3) render an interactive **cake** per module, and
(4) drive them headlessly. This is the surface the
[`rune`](https://github.com/mrg-keystone/rune) workflow generates into.

### `@EndpointController` / `@Endpoint`

Write a thin controller whose handler delegates to your logic. `@Endpoint`
composes danet's route

- body decorators with `@danet/swagger`'s schema decorators, and records the
  process metadata. Type the handler's parameter as the input DTO — `@Endpoint`
  wires `@Body()` for you.

```ts
import { ApiProperty } from "jsr:@danet/swagger@2/decorators";
import {
  bootstrapServer,
  Endpoint,
  EndpointController,
  endpointModule,
} from "@mrg-keystone/rune";

class CreateOrderDto {
  @ApiProperty()
  item!: string;
}
class OrderDto {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  item!: string;
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
    return { id: "o_1", item: body.item };
  }

  // Runs after `create`; its request's `orderId` is filled from create's `id` output.
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
```

`EndpointOptions`: `method` (default `"post"`), `path`, `input`/`output` DTO
classes, `order` (ascending), `dependsOn` (endpoint id(s) — handler method
names), `bind`, `flows`, `optional`, `stub`, `description`. The metadata rides
into each module's OpenAPI doc as an **`x-keep-process`** vendor extension.

`bind` values come in three forms:

- `"otherEndpointId.outputField"` — fill this field from a captured response;
- `"$name"` — an **external input** nothing in this module produces (an id
  minted by another module, a tenant key): the cake lists it under
  **Module inputs** and the runner takes it from `overrides.seeds[name]`;
- `["payCard.paymentId", "payCash.paymentId"]` — **alternatives**, first
  resolvable wins (the join after a branch).

`flows: "card"` puts the endpoint in a named branch — untagged endpoints belong
to every flow; the cake gets a flow selector and dependencies on endpoints
outside the active flow don't gate (so a join can depend on every alternative).
`optional: true` marks a step that's attempted but never blocks the walk.
`stub: true` marks a **generated stand-in** endpoint that mints placeholder
values — not part of the real process. The cake badges it with a `stub`
chip, and the contract auto-wiring treats it as a producer like any other (this
is what [`rune`](https://github.com/mrg-keystone/rune)'s ghost-stub module
generates for external inputs nothing produces yet).

### The cake (per module)

With Swagger on (default), each module gets three docs pages:

| Path                     | What                                                                 |
| ------------------------ | -------------------------------------------------------------------- |
| `/docs/<module>`         | the **cake** — a Postman-style guided walk of the chain |
| `/docs/<module>/swagger` | the standard Swagger UI (deep inspection)                            |
| `/docs/<module>/json`    | the raw OpenAPI spec (token-gated; see [Docs access](#docs-access))  |

The cake lists endpoints in `order`/`dependsOn` order. Each step's request
body is generated from the DTO schema, with bound fields holding
**`{{step.field}}` references** that resolve against captured responses when
the request is sent — so your hand edits are never overwritten, and any value
can reference any earlier output (or a variable you define yourself). Run a
step and on success it drops a checkmark with status + timing, **captures its
outputs into a live variables panel**, and unlocks its dependents. A
**Run all in order** button walks the chain and stops on the first failure
with a banner saying exactly where and why; fix the step and run again to
resume. The walk **scrolls the active step into view and leaves boxes
collapsed** — nothing auto-expands, so the list stays easy to follow; open a
box yourself to inspect its request or response. Each step shows the concrete
request it _will send_, the response, a paste-ready curl, and a one-click
**copy of the route's full URL**. Re-running a step shows a **diff against the
previous response** (changed/added/removed paths, `old → new`) so "did my code
change break anything" is visible at a glance. The session (statuses, captured
outputs, variables, edited bodies) survives reloads — **Reset session** starts
fresh. Walking the list and eyeballing each response verifies the module's
logic end-to-end.

#### Expectations — green means *right*, not just 2xx

Every step has an **Expect** block under its response: pin an exact HTTP
status and any number of body checks (`path` `==`/`!=`/`contains`/`exists`
`value`, where the value may hold `{{refs}}` — e.g. `id == {{create.id}}`).
With expectations pinned, a step only goes green when the response **meets
them**: a 200 whose body is wrong turns the step red (`expect ✗`), shows each
check's verdict with the actual value, and stops Run all with the failing
expectation named in the banner. Expectations ride **Save fixtures** into
`spec/misc/cake.json`, so a committed artifact is a clickable contract test:
clone the repo, open the cake, Run all — green now means the process behaves,
not merely responds.

#### Scenarios — record and replay whole walks

The **Scenarios** rail card freezes the entire walk — the active flow, every
step's body text and params (refs intact), and skips — under a name, one JSON
file per scenario in **`spec/misc/scenarios/`** (`happy-path.json`,
`refund-flow.json`, …). **load** applies one over the page; **run** loads it
and runs all. They're served and saved through the localhost-only
`GET`/`POST /docs/_scenarios`, and CI can replay one headlessly:
`POST /docs/_run {"scenario": "happy-path"}` runs the saved flow with each
step's **literal** body fields as overrides (fields holding `{{refs}}` are left
to the runner's own bind machinery, which the refs mirror).

Beyond the chain: a module with `flows` gets a **flow selector** (walk one
branch at a time; run-all walks the active flow); declared `$inputs` appear in
a **Module inputs** card. Variables are shared **across modules**: every
captured output is also published as `{{module:step.field}}`, user variables
form a global environment, and references resolve recursively — point a module
input at `{{members:create.memberId}}` once and every re-run upstream feeds it
fresh. Dependency cycles are called out in a banner instead of leaving steps
mutely locked.

Composed modules **snap together** without any of that typing: when an
endpoint anywhere in the app (this module included) outputs a declared
`$input`'s field — **exactly, or as its plural collection** (`$tableName` ←
`tableNames[0]`) — the Module-inputs row shows a dim **`auto:
<module>:<endpoint>`** note instead of the amber "not set" state, and the
input is satisfied automatically from that producer's capture — run the
producer once (in any tab) and the consumer just works. Endpoints that merely
echo the field they consume never count as producers. Typing a value
overrides the auto-wiring; clearing it back to empty returns to auto.
Endpoints declared `stub: true` carry an amber **`stub`** chip marking them as
generated stand-ins minting placeholder values, not part of the real process.

#### Module setup & the `spec/misc/cake.json` artifact

`localStorage` keeps the working session, but a session is browser-local and
disappears with the cache. The **Module setup** rail card is the durable
counterpart. It holds **setup steps** — calls that put the system in a known
state _before_ the process runs (seed a tenant, flip a flag, create a
prerequisite record) — and they can target **any endpoint in the composed
app, not just this module**: the card's picker lists every module's endpoints,
so one cake page can stand up the whole app's state. Pick from the app
(generated bodies qualify their refs — `{{mint:create.id}}` — so they resolve
from the shared scope), or press **`+ setup`** in any step's Request panel to
snapshot its current request. Each step is editable in place (frozen body +
params), reorderable, and runnable alone; **Run setup** fires them all, and
**Run all** runs setup first, then the process walk, stopping with a banner if
a setup call fails. A cross-module setup step writes its result into **that
module's** session and the shared capture scope (the same write-back the
map's Run all uses), so every page agrees on what happened.

**Save fixtures** writes the whole configuration to **`spec/misc/cake.json`**:
this module's setup steps, its pinned **expectations**, plus every environment
variable you ticked **`persist`** (a checkbox next to each variable in the
Variables card). The file is plain JSON you can commit, so the setup and the
contract a process needs travel with the repo. On load, the cake reads it
back — even in a fresh browser with no `localStorage` — restoring setup,
expectations, and persisted variables as the baseline. The read/write door is
`POST`/`GET /docs/_fixtures`, **localhost-only** like `/_run` and `/_mint`;
the default path is `<cwd>/spec/misc/cake.json` when the project has a `spec/`
dir, else the legacy `<cwd>/fixtures/cake.json` (`KEEP_FIXTURES_DIR` overrides
the directory).

A sibling artifact, **`spec/misc/heal-rules.json`**, holds the project's tier
of the cake's heal panel: a declarative map from your API's **error slugs**
(`"not-enabled"`, `"not-armed"`, …) to one-click fixes (`run-step`,
`set-input`, `pick`, `retry`, `note`, …). keep ships only generic diagnosis
(missing inputs, validation shapes, transient retries) and executes your
rules for everything domain-specific; rune generates a starter file from the
spec's declared fault slugs. Served read-only at `GET /docs/_heal-rules`
(localhost-only); unknown rule kinds and extra fields are ignored, so the
file is forward-compatible.

### The system map — `/docs/_map`

`/docs/_map` renders the **whole composed app as one process graph**: every
module's endpoints as nodes grouped into module lanes, ordered left-to-right
by dependency depth. Solid edges are intra-module binds (`"step.field"`
autofill); **dashed edges** are `"$input"` contracts satisfied by a producer
in another module; a `$name` nothing produces shows as an amber input badge on
its consumer. Flows tint their edges, and optional/stub endpoints carry chips.
The map is **live**: each node's status dot recolors from the cake
sessions in `localStorage` — run a step on any docs page (any tab) and the map
updates. A **Run all** button runs the whole composed process server-side (the
localhost-only `/docs/_run` walk) **module by module, endpoint by endpoint**,
in the order the lanes draw — and it runs under the cake's own defaults: the
untagged-only walk (destructive flow branches never auto-run), your typed
environment variables as seeds, and each module's per-step skips honored.
Results **stream**: every call's outcome is written into that module's cake
session as it lands (status, response body, timing, captures + the shared
scope) and its node settles green/red while the rest keep pulsing. One source
of truth for run state: colors survive a reload, **already-open cake tabs
update live**, and opening a cake afterwards finds its steps green with
responses and captures pre-filled. When steps fail, **heal takes over**: each
failed name in the banner is a deep-link into its cake step, where the heal
panel is already lit with that run's actual failure.
Clicking a node **deep-links** into that module's cake with the step expanded
(`/docs/<module>#<endpointId>`). (Underscore-prefixed so a module named "map"
can still own `/docs/map`.)

### Dev mode — `KEEP_DEV` and `/docs/_dev`

Set **`KEEP_DEV=<status-file path>`** and `bootstrapServer` serves a
**`/docs/_dev`** JSON endpoint (the status file's contents plus the process's
`bootId`) and injects a small poller into every cake/map page. The pages
poll `_dev` while visible and **auto-reload when the `bootId` changes** (a new
process is serving); status-file `errors` render in the page banner, and a
"server restarting…" notice appears while the server is unreachable. Session
state lives in `localStorage`, so statuses, captures, and edited bodies
survive the reload. This is the channel
[`rune dev`](https://github.com/mrg-keystone/rune) drives — its watcher
checks/re-syncs the spec on save, restarts the app under `KEEP_DEV`, and the
open docs pages pick up the new boot by themselves.

### Request tracing — `/docs/_trace`, Deno KV, and Datadog APM

Every inbound request is captured as a **trace**: a tree of timed **spans**.
The root span is the whole request (opened automatically by the logging
middleware); each in-process `backend.fetch` sub-call becomes a span; and you
wrap your own hot functions so they show up as their own segment. A span that
throws is recorded as the trace's **crash point**. The same instrumentation
feeds two outputs — a zero-config local waterfall **and** your APM.

#### Instrumenting

```typescript
import { span, Traced, traceUser } from "@mrg-keystone/rune";

class Checkout {
  async run(cart: Cart) {
    traceUser(cart.memberId);                       // label this trace by user
    const total = await span("priceCart", () => priceCart(cart)); // inline span
    await span("chargeCard", () => charge(total));
    return total;
  }
}

class Pricing {
  @Traced()                                          // whole-method span "Pricing.price"
  async price(items: Item[]) { /* … */ }
}
```

`span(name, fn, meta?)` times `fn` as a child of the current span and is a
**pass-through outside a request**, so it's always safe to leave in. `@Traced()`
is the method-decorator form. `traceUser(id)` labels the trace with your own
identity; absent that, the trace is labeled with the verified token identity
(the logger `source`). The request root and `backend.fetch` sub-calls are
captured automatically — no annotation needed.

#### The waterfall — `/docs/_trace`

`/docs/_trace` renders recent requests as bars; expand one for the full
waterfall — every span positioned by start time, sized by duration, coloured by
kind (request / backend / your function), with a ✖ on the span that crashed.
A filter bar narrows by **route**, **method**, **status** (ok / crashed) and
**user** (selecting a user re-queries server-side); each row carries a clickable
user chip. The page polls the **localhost-only** `/docs/_traces` JSON route
(traces carry route paths and error messages, so the data is never exposed to
the network; the page shell loads publicly like the other docs pages).

#### Storage — in-memory ring or Deno KV

By default the last **200** traces live in an in-memory ring buffer (size with
`KEEP_TRACE_BUFFER`, disable capture with `KEEP_TRACE=off`). Set
**`KEEP_TRACE_KV`** (`1`/`true` → the default KV location, or a path) to persist
to **Deno KV** instead, so the UI survives restarts and looks past the in-memory
window. Traces are stored time-ordered **and** indexed by user, so the
newest-first list and `?user=` lookups are fast indexed scans; every key carries
a TTL (`KEEP_TRACE_TTL_DAYS`, default 7) so storage stays bounded. On Deno Deploy
`KEEP_TRACE_KV=1` uses the hosted KV automatically. (Requires `--unstable-kv`;
without it, capture degrades to the in-memory ring with a one-time warning.)

#### Shipping to an APM (Datadog) over OTLP

Set **`KEEP_TRACE_OTLP_URL`** to an OTLP/HTTP endpoint — a Datadog Agent or an
OpenTelemetry Collector — and each finished trace is serialised to OTLP/JSON and
**POSTed at request end**. There is no OpenTelemetry SDK and no extra
dependency: the whole tree is already in memory, so it's just `JSON.stringify` +
one `fetch`. The POST is **fire-and-forget but flushed** — its promise rides the
same `pending` list the logs use, so `settle()` awaits it right before the
response returns (the logger pattern, reused). `/v1/traces` is appended to the
URL if absent.

- **Gating mirrors the logs** (see [Logging](#logging)): ships from **Deno
  Deploy automatically** (`DENO_DEPLOY=1`), and from **local only with
  `KEEP_DD_LOCAL=1`**. Traces are tagged `service.name` = your app and
  `deployment.environment` = `production`/`local`.
- **Guard header:** set **`KEEP_TRACE_OTLP_TOKEN`** and every POST carries
  `X-Keep-Token: <token>`, so the OTLP endpoint can be exposed publicly behind a
  reverse proxy that only routes requests bearing the secret.

```bash
KEEP_TRACE_OTLP_URL=https://otlp.example.com   # → POSTs to /v1/traces
KEEP_TRACE_OTLP_TOKEN=<shared-secret>          # sent as X-Keep-Token
# locally, also: KEEP_DD_LOCAL=1
```

The Datadog Agent's OTLP HTTP receiver accepts JSON natively (it's the
OpenTelemetry Collector receiver; `application/json` → JSON, dispatched by
`Content-Type`). A working Agent + Traefik deployment, including the secret-guard
routing and a verification runbook, is documented in
[`docs/datadog-agent.md`](../docs/datadog-agent.md).

| Env var | Effect |
| --- | ------ |
| `KEEP_TRACE` | `off` disables trace capture entirely |
| `KEEP_TRACE_BUFFER` | in-memory ring size (default 200) |
| `KEEP_TRACE_KV` | `1`/`true`/`<path>` → persist traces to Deno KV (needs `--unstable-kv`) |
| `KEEP_TRACE_TTL_DAYS` | Deno KV retention in days (default 7) |
| `KEEP_TRACE_OTLP_URL` | OTLP/HTTP endpoint to ship traces to (Agent/Collector) |
| `KEEP_TRACE_OTLP_TOKEN` | shared secret sent as `X-Keep-Token` on each OTLP POST |
| `KEEP_DD_LOCAL` | ship logs **and** traces to Datadog from a local (non-Deploy) run |

### `exerciseEndpoints(opts)` — headless runner

The same metadata, run programmatically (for CI / agents). Discovers endpoints
from the bootstrapped app's `docs`, orders them, runs them while chaining
outputs into inputs via `bind`, rate-limits, and loops until green.

```ts
import { exerciseEndpoints } from "@mrg-keystone/rune";

const report = await exerciseEndpoints({ api }); // in-process (backend.fetch), no token
// report: { passed, failed, optionalFailed, iterations, order, cycles }

// One branch at a time, with external inputs seeded:
await exerciseEndpoints({ api, flow: "card", overrides: { seeds: { memberId: "m-7" } } });
```

- **Transport.** No `baseUrl` → dispatches in-process via `backend.fetch` (no
  port, bypasses auth) — the default for tests/CI. With `baseUrl` (a running
  server) it uses **Playwright's `APIRequestContext`** over real HTTP.
- **`overrides`.** `seeds` (literal values by field name), `byEndpoint`
  (per-endpoint overrides by id — win over `bind`), and `auth`
  (`{kind:"in-process"}` default, or `{kind:"token"|"mint", …}` using
  [`signToken`](#programmatic-sign--verify) for network/`baseUrl` runs).
- **`$`-input resolution order.** A `"$name"` bind resolves from
  `overrides.seeds[name]` first — a seed always wins. With no seed,
  **composition fulfills the contract**: the value falls back to the first
  captured response (in run order) owning a same-named field — or, failing
  that, a same-named **plural collection** (`name + "s"`) whose first scalar
  element supplies the value (`$tableName` ← `discover.tableNames[0]`): the
  list→item pattern auto-wires. The runner adds a synthetic dependency edge
  from the consumer to that producer, so the producer runs first and the
  fallback hits on pass one — a composed app with stub or real producers
  needs no seeds at all. **Echoes never count as producers**: an endpoint
  that consumes the very field it outputs can't bootstrap a value, so it is
  excluded from producer matching, `unresolvedInputs`, and map edges.
- **Required fields with real examples are filled.** A required input field
  with no seed/bind fills from its schema `example` when one is declared
  (typed zeros like `0`/`false` count; the empty-string placeholder doesn't) —
  matching the cake's generated bodies.
- **Transient retries** (`retry: { slugs, delayMs?, attempts? }`): a failed
  response whose `body.message` matches a listed slug is re-attempted after a
  delay instead of failing the walk. `/docs/_run` derives the slugs from the
  project's heal rules (`retry` actions in `spec/misc/heal-rules.json`) plus
  the built-in transients (`timeout`, `rate-limited`) — heal knowledge feeds
  the runner, not just the UI.
- **`rateLimit`** (`{ requestsPerSecond?, maxConcurrency? }`) and
  **`maxIterations`** (default 5).
- **Report rows** carry `{ id, module, method, path, ok, status, attempts,
  ms, body }` — the response body and per-call timing ride along, so a caller
  (CI, the system map's write-back) can show or replay outcomes, not just
  pass/fail.

Against a **running** server, `POST /docs/_run` (localhost-only) is the HTTP
door to the same walk: `{ flow?, seeds?, byEndpoint?, rateLimit?,
maxIterations?, dryRun?, scenario?, orderBy?, skip?, stream? }` —
`scenario: "happy-path"` replays a saved `spec/misc/scenarios/` file (its flow
+ literal body fields); `orderBy: "module"` walks lane-by-lane (modules in
docs order, topological within — forward cross-module deps converge on a
later iteration); `skip: ["module:op", …]` excludes steps like the cake's
skip toggle; `stream: true` returns ndjson — one `{kind:"result",…}` line per
call as it completes, then a final `{kind:"done",…}` summary (what the map's
Run all consumes); `dryRun: true` returns just
`order`/`cycles`/`unresolvedInputs` without firing a request.

> **Playwright is an optional peer.** It's only loaded when you pass a
> `baseUrl`; in-process runs (and everything else in keep) need no browser.
> Provision it (`deno run -A npm:playwright install` or set
> `PLAYWRIGHT_BROWSERS_PATH`) only for `baseUrl` runs — note the
> `APIRequestContext` path uses Playwright's HTTP client, not a browser.

## Deployment

The same bootstrapped backend runs in two shapes: **standalone** (a normal HTTP
server) or **embedded** under a Fresh frontend, sharing the in-process client.
Both are driven by two things `bootstrapServer` returns:

- `handler` — the raw `(Request) => Response` dispatcher (the same pipeline
  `listen()` serves).
- `backend` — the in-process client (`backend.fetch(...)`), which bypasses token
  auth.

Bootstrap once in a shared module (init only — it does **not** `listen()`):

```ts
// backend.ts
import { bootstrapServer } from "@mrg-keystone/rune";
import { AppModule } from "./app.module.ts";

export const api = await bootstrapServer("my-api", AppModule);
```

(No `import "reflect-metadata"` needed — the package loads the Reflect polyfill
itself.)

### Standalone

Serve the handler directly — works locally and on Deno Deploy:

```ts
// server.ts
import { api } from "./backend.ts";

// Forward Deno's conn info so localhost/loopback detection keeps working.
Deno.serve((req, info) => api.handler(req, info)); // or: await api.listen();
```

> **Forward `info`.** `api.handler` takes `(req, info?)`. When you dispatch
> through it from your own `Deno.serve`, pass the second `info` argument — it
> carries `remoteAddr`, which the localhost trust, the token-auth localhost
> exemption, and the `/_mint` guard all rely on. Drop it
> (`Deno.serve((req) => api.handler(req))`) and every request looks origin-less,
> so localhost is no longer recognized and `/_mint` becomes unreachable.

Network clients must send a token (`Authorization: Bearer <token>`); see
[Access tokens & authorization](#access-tokens--authorization).

### Embedded under a Fresh 2 frontend

Fresh owns `/`; one `embed` middleware exposes the token-gated backend at
`/api/*` and puts the in-process client on `ctx.state.api` for everything else.
Register it **before** `.fsRoutes()` — the Fresh `App` builder is
order-sensitive:

```ts
// main.ts  (Fresh 2 entry)
import { App, staticFiles } from "fresh";
import { embed } from "@mrg-keystone/rune";
import { api } from "./backend.ts";
import type { State } from "./utils.ts";

export const app = new App<State>()
  .use(staticFiles())
  .use(embed(api, { at: "/api" })) // token-gated /api/* + in-process ctx.state.api
  .fsRoutes();
```

```ts
// utils.ts — extend KeepState and ctx.state.api is typed
import type { KeepState } from "@mrg-keystone/rune";
export interface State extends KeepState {}
```

`embed` rebases `/api/*` onto the root-registered routes and forwards Fresh's
conn info automatically, so loopback detection (localhost trust, `/_mint`) keeps
working without remembering `ctx.info`. For mounting into anything other than
Fresh, use the lower-level `withBasePath(prefix, handler)` directly.

`bootstrapServer` is **bundler-safe**: it lazy-loads the Swagger builder (and
its CommonJS `handlebars` dependency), so importing it from Fresh works through
Vite's SSR in both `deno task dev` and the production build (`deno task build` →
`deno serve _fresh/server.js`). A complete, runnable version of this whole
section — plus the browser token flow and a localhost-trust toggle — is in
[`examples/fresh-project`](../examples/fresh-project).

Fresh's server-side code (handlers, loaders) calls the backend **in-process** —
no network hop, no token needed:

```tsx
// routes/users.tsx
import { page } from "fresh";
import { define } from "../utils.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const res = await ctx.state.api.fetch("/users"); // in-process; bypasses token auth
    return page({ users: await res.json() });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <ul>{data.users.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
));
```

So one Deno Deploy process serves the Fresh UI at `/`, exposes the token-gated
API at `/api/*` for external callers, and lets the frontend reach the backend
in-process. The backend stays fully runnable standalone — same `api`, different
entry.

For browser-side calls that _do_ go over the network to `/api` (an island's
`fetch`), attach a credential — either a **signed token** seeded from `?token=`
and auto-injected from `localStorage` (see
[Browser access to your own API](#browser-access-to-your-own-api-frontend-token)),
or the user's **Firebase ID token** as `Authorization: Bearer <idToken>` (with
`FIREBASE_PROJECT_ID` set). Server-side rendering should still prefer
`api.backend.fetch(...)`, which is in-process and needs no credential.

**Deno Deploy notes**

- Set env vars in the Deploy project: `MANUAL_KEY` (signed tokens) and/or
  `FIREBASE_PROJECT_ID` (Firebase Auth), plus `DD_API_KEY` / `POSTMARK_*` as
  needed.
- Fresh requires a build: `deno task build`, then serve `_fresh/server.js` — the
  backend singleton is imported by Fresh's server code and runs in the same
  process.
- The localhost `/_mint` UI is unreachable in production (it `403`s
  off-localhost). Mint tokens locally, or programmatically with `signToken` (see
  above).

## Testing

```sh
deno test -A --unstable-raw-imports
```

## Releasing

Every push to `main` publishes to JSR via `.github/workflows/publish.yml`
(reusable — it derives scope/package from `deno.json`'s `name`; drop it plus
`scripts/check-jsr-deps.ts` into any JSR repo with a `JSR_TOKEN` secret):

- A **preflight** emulates JSR's server-side dependency validation locally
  (`jsr:` subpath exports across all versions matching each range) plus a
  `deno publish --dry-run`, so bad packages fail in seconds instead of after a
  ~10-minute server round trip.
- If `deno.json`'s version is **not yet on JSR**, it publishes as-is — set the
  version yourself to cut a specific release. Otherwise the next version is
  derived from the latest published one: **patch** by default, **minor** when
  the push contains a `feat:` commit, **major** on `!:` / `BREAKING CHANGE` —
  and the bump is committed back to `main`.
- The publish step polls the JSR API instead of trusting the CLI: `deno
  publish` neither exits after a successful publish nor reports a failed
  server-side task. Server-side processing alone has taken **~22 minutes** for
  this package, so a silent "Publishing ..." for a long while is normal.
- **Do not cancel a publish run that looks hung.** JSR's backend does not
  release the package transaction lock when the client disconnects, so the
  next publish attempt hangs too
  ([jsr-io/jsr#1448](https://github.com/jsr-io/jsr/issues/1448)). Let the
  20-minute window expire — a task failure surfaces its real error within
  ~20 seconds; only a stuck-in-processing task waits the window out. Stuck
  tasks can be requeued from the package's publishing-tasks page on jsr.io.
