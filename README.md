# @mrg-keystone/keep

An opinionated Deno backend framework built on [`@danet/core`](https://jsr.io/@danet/core). It bundles server bootstrapping with
automatic OpenAPI/Swagger docs, a unified auth/identity layer (signed tokens, Firebase, roles), an in-process API client with a
private-key trust channel, request-scoped structured logging to Datadog, and first-class Fresh frontend embedding.

## Quick Start

```typescript
import "reflect-metadata";
import { bootstrapServer, log, SwaggerDescription } from "@mrg-keystone/keep";
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
- ingress/egress logging for every request, shipped to Datadog (when `DD_API_KEY` is set)
- access-token authorization on every **network** request (in-process and localhost callers are
  exempt) — see [Access tokens & authorization](#access-tokens--authorization)

## API

### `bootstrapServer(appName, module, options?)`

Creates and configures a server with optional Swagger documentation and request logging.

- `appName` — used in every log line and as the Datadog `service`
- `module` — root application module class
- `options.port` — port number (default: 3000)
- `options.swagger` — `true` (default), `false`, or `{ filters: string[] }` to exclude modules

Returns `{ listen(), stop(), backend, handler }`:

- `listen()` / `stop()` — start/stop the server on the configured port
- `backend` — in-process HTTP client (see [`backend`](#backend--in-process-http-client))
- `handler` — the raw `(Request) => Response` dispatcher (the same pipeline `listen()` serves);
  use it to serve without binding a port (`Deno.serve(handler)`) or to compose the backend into
  another app (see [Deployment](#deployment))

#### Logging environment variables

Logging is driven entirely by environment variables — nothing is passed in code:

| Variable | Enables | If missing |
|---|---|---|
| `DD_API_KEY` | Datadog logging | warns once, logs to console only |
| `POSTMARK_SERVER_TOKEN` | failure-alert emails | warns once, failures fall back to console |
| `POSTMARK_FROM` | failure-alert emails | (required with the token) must be a verified Postmark sender |
| `POSTMARK_TO` | — | alert recipient; defaults to `POSTMARK_FROM` |

The Datadog site is fixed to `us5.datadoghq.com`, and alert emails use a 5-minute cooldown.

#### Authorization environment variable

| Variable | Enables | If missing/blank |
|---|---|---|
| `MANUAL_KEY` | the secret that **signs and verifies** signed access tokens | warns once; tokens can't be minted (mint UI fails closed) and signed tokens can't be verified |
| `FIREBASE_PROJECT_ID` | accepting **Firebase Auth** ID tokens as an alternative credential | warns once; Firebase path off (signed tokens only) |
| `TRUST_LOCALHOST` | set to `false` to require a token even from localhost (in-process key trust unaffected) | defaults to `true` — localhost callers are trusted |

`MANUAL_KEY` is the per-app signing secret; `FIREBASE_PROJECT_ID` is your Firebase project id
(only the project id is needed — ID tokens are verified against Google's public certs, so no
service-account `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` is required). Both are read from
the environment so they never live in the (public) package source. If **neither** is set, no
network request can authorize. See [Access tokens & authorization](#access-tokens--authorization).

### Access tokens & authorization

Every **network** request must present a valid credential; requests from the in-process
`backend` client and from `localhost` are trusted and need none.

| Caller | How it's recognized | Credential required? |
|---|---|---|
| In-process (`backend.fetch(...)`) | a process-private key stamped on the request (`x-danet-internal`) | **No** — trusted |
| `localhost` | loopback peer address | **No** — trusted |
| Network (anything else) | neither of the above | **Yes** — `401` without a valid credential |

The Swagger docs are **token-gated** — see [Docs access](#docs-access) for how the browser flow
works. The localhost `/_mint` UI is always blocked from the network.

The in-process key is a random value minted at boot (`crypto.randomUUID()`), shared only
between the `backend` client and the auth middleware. It never leaves the process — not an env
var, not sent over the network, and redacted from logs — so a network client cannot forge it.
It's compared in constant time, and is regenerated every boot.

> **On localhost trust.** The loopback check uses the connection's real TCP peer address
> (`remoteAddr`), never the spoofable `X-Forwarded-For` header. A remote client cannot make a
> connection appear to come from `127.0.0.1` (the OS drops loopback-sourced packets from external
> interfaces, and TCP can't complete a handshake against a spoofed source). The one caveat is a
> reverse proxy **running on the same host**: it connects over loopback, so its remote clients
> would ride in on a genuinely-local connection and bypass the token. Don't front the app with a
> same-host loopback proxy while relying on this — expose it directly, or set
> **`TRUST_LOCALHOST=false`** to require a token even from localhost (the in-process key trust
> stays, so SSR / `backend.fetch` keeps working). It's also handy for testing the gated path.

> ### ⚠️ Security: the in-process bypass and how to mount safely
>
> `backend.fetch(...)` is a **trusted channel** — anything dispatched through it skips auth (that's
> how SSR calls your own API without a token). This is correct for *originating* your own calls, but
> it is a footgun if you use it to **proxy inbound network traffic**: routing external requests
> through `backend.fetch` would serve them auth-exempt. **Never route inbound requests through
> `backend.fetch`.** To expose the API over the network, mount **`api.handler`** (via `Deno.serve`
> or `withBasePath`) — that's the network entry point.
>
> The framework makes the safe path safe by construction:
> - **`api.handler` strips the in-process trust header** from every inbound request. So a network
>   request — whatever it sends, however it's mounted or proxied — can **never** impersonate an
>   in-process call. In-process trust is only granted to `backend.fetch`, which dispatches through a
>   separate non-stripping path.
> - **Swagger docs do not honor the in-process bypass at all.** The spec (`/docs/<module>/json`) is
>   served only to a genuine loopback caller or a valid token — so even if you wrongly route docs
>   through `backend.fetch`, the API surface stays gated.
> - The in-process key is unguessable, never sent to the network, and redacted from logs.
>
> Net: if you mount with `api.handler`, an integrator **cannot** accidentally expose the API or the
> docs. The only way to bypass auth is to deliberately pipe inbound traffic through `backend.fetch`
> — don't.

A network caller authorizes by sending a credential in the `Authorization` header:

```
Authorization: Bearer <credential>
```

The same credential is also accepted as a **`?token=<credential>`** query param. That's for
callers that can't set a header — a plain link, a first browser navigation, or a WebSocket
upgrade. Prefer the header where you can: a token in a URL can leak via history and `Referer`,
so the query value is **redacted from request logs**, and the Fresh frontend pattern below seeds
it once from `?token=` then sends it as a header thereafter.

The credential may be **either** of two things — whichever validates first authorizes the
request:

1. **A signed access token** (HS256, keyed by `MANUAL_KEY`) — for service-to-service callers.
   Mint one with the localhost UI or `signToken` (below).
2. **A Firebase Auth ID token** — for browser/frontend callers. When `FIREBASE_PROJECT_ID` is
   set, the backend verifies the ID token against Google's public certs (RS256 + `aud`/`iss`/
   `exp` checks). This is what lets a Fresh frontend's island/`fetch` calls hit `/api` using
   the user's Firebase login, with no signed token.

The resolved identity is attributed to every log emitted during the request (it appears as a
`source` attribute alongside `requestId`): the token's `source` for a signed token, or the
user's email (falling back to uid) for a Firebase token.

#### `@Public()` — opt a route out of auth

Auth is enforced as a **global guard**, so it's **deny-by-default** on every controller
route. Mark a controller or a single handler `@Public()` to make a credential optional there:

```ts
import { Public } from "@mrg-keystone/keep";

@Controller("inbound")
class WebhookController {
  @Public()            // gated by its own webhook secret, not a danet token
  @Post()
  receive() { /* ... */ }
}
```

- Class-level `@Public()` exempts every route on the controller; method-level exempts one.
- **Public means auth-optional, not auth-ignored**: a valid credential on a `@Public` route is
  still verified and its `source` attached for logging — it just isn't required (an invalid one
  is ignored rather than rejected).
- It only covers **controllers** (DI routes). The framework's own direct routes (`/docs`,
  `/_mint`) aren't controllers — they self-gate, so they don't need `@Public`.
- Grep `@Public` to enumerate every unauthenticated route.

`@Public` is about **authentication** (is a credential required). For **authorization** by role,
use `@Roles` (below).

#### `@Roles()` — restrict a route by role

Limit a controller or handler to callers holding **at least one** of the listed roles. The same
global guard enforces it right after authentication:

```ts
import { Roles } from "@mrg-keystone/keep";

@Controller("users")
class UsersController {
  @Roles("admin")          // only callers with the "admin" role
  @Delete(":id")
  remove() {}
}
```

- **`@Roles` implies authentication** — a role-gated route always needs a valid credential (it
  overrides `@Public`). No credential → `401`; valid credential without a listed role → `403`.
- Method-level `@Roles` overrides class-level; trusted origins (in-process / localhost) bypass it
  like all auth (use `TRUST_LOCALHOST=false` to enforce roles locally too).

**Roles are namespaced `appName:role`.** A single user can hold roles across several apps, so each
role is stored prefixed with the app it belongs to (e.g. `billing:admin`, `orders:editor`). The
guard knows its own `appName` and **scopes** to it: `@Roles("admin")` on the `billing` app matches
the claim `billing:admin` and ignores `orders:*`. `getIdentity(ctx)` returns the scoped (bare)
roles for this app.

**Where roles come from** — they ride *in* the verified credential, no extra lookup:

- **Firebase**: set them as **custom claims** with the Admin SDK (from your admin tooling /
  Cloud Function — verifying needs only `FIREBASE_PROJECT_ID`, setting needs the service account):
  ```ts
  admin.auth().setCustomUserClaims(uid, { roles: ["billing:admin", "orders:viewer"] });
  ```
  The backend reads `roles` (array) and/or `role` (string) from the ID token. Note custom-claim
  changes only apply once the client's ID token refreshes.
- **Signed tokens**: include namespaced `roles` in the payload —
  `signToken({ source, appName, expiry, roles: ["billing:admin"] }, key)`.

The resolved caller is attached to the request; read it in a handler with `getIdentity(ctx)` →
`{ source, roles }` (roles scoped to this app).

#### Token shape

A token is a compact JWT (`HS256`) signing these claims:

```ts
interface TokenPayload {
  source: string;    // who the token was minted for — used for log attribution
  expiry?: number;   // Unix epoch in SECONDS; the token is rejected once passed.
                     // OMIT for a token that never expires.
  appName: string;   // the app the token grants access to
  roles?: string[];  // namespaced `appName:role` entries, checked by @Roles
}
```

> A token with no `expiry` **never expires** and can only be invalidated by rotating `MANUAL_KEY`
> (which invalidates all signed tokens). Mint these sparingly.

The signature is keyed by `MANUAL_KEY`, so neither the expiry nor any claim can be altered
without invalidating the token. `verifyToken` rejects a token that is malformed, mis-signed, or
expired.

#### Minting tokens — the localhost UI

`bootstrapServer` mounts a token-minting UI at **`GET /_mint`** that works on `localhost` only
(any non-loopback request gets `403`). Open it in a browser, fill in `source`, `appName`, and
`expires in` (seconds from now — with a live Eastern-time preview of the expiry, or tick **never
expires**), and submit to receive a token (auto-copied to your clipboard). The result page also
shows a ready-to-share
**`…/docs?token=…` link** (with copy buttons) — derived from the page's own location, so it's
correct whether the app runs standalone or mounted under Fresh at `/api`. The signing key is
read from `MANUAL_KEY` on the server — it is never entered into or returned by the form. If
`MANUAL_KEY` is unset, minting fails closed.

#### Docs access

The Swagger docs are gated, but a browser navigating to `/docs` can't send an `Authorization`
header — so docs use a **query-param → localStorage** flow:

- The doc pages (`/docs` and the per-module Swagger UI shells) are served **publicly** so they
  always load. The actual OpenAPI spec lives at a **gated** `/docs/<module>/json` endpoint.
- Open any doc page with `?token=<signed token>`. A small inline script saves the token to
  `localStorage` and strips it from the URL.
- Swagger UI then fetches the spec over XHR with `Authorization: Bearer <token>` from
  `localStorage` — which **persists across same-origin navigation**, so once seeded you can move
  between modules without re-supplying it.
- If the spec request returns `401` (token missing, invalid, or expired), the script **wipes**
  the stored token and shows a message to reopen with a fresh `?token=…` link.

So you share a `…/docs?token=…` link once; the token is reused from `localStorage` until it
stops working. This also works mounted under Fresh — the shell derives the spec URL from its own
path, so `/api/docs/<module>` fetches `/api/docs/<module>/json`.

#### Browser access to your own API (frontend token)

The same query-param → `localStorage` flow works for your app's `/api`, so a browser/island can
call the gated API without you wiring a token into every `fetch`. Drop this in a client entry
(e.g. a Fresh `client.ts`) — it seeds the token from `?token=`, attaches it to same-origin
`/api/*` requests, and drops it when one comes back `401`:

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
const isApi = (u: string) => new URL(u, location.origin).pathname.startsWith("/api/");
const native = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const req = new Request(input as RequestInfo, init);
  const token = localStorage.getItem(KEY);
  if (token && isApi(req.url) && !req.headers.has("authorization")) {
    req.headers.set("authorization", `Bearer ${token}`);
  }
  const res = await native(req);
  if (token && isApi(req.url) && res.status === 401) localStorage.removeItem(KEY);
  return res;
};
```

You hand someone a `…/probe?token=…` link once; the browser remembers it and authorizes every
subsequent API call until it stops working. (Server-side rendering should still prefer
`api.backend.fetch(...)` — in-process, no token. This is only for calls the browser itself makes
over the network.) See the runnable [`examples/fresh-project`](examples/fresh-project) for a
working `client.ts` + `/probe` page.

> **Use a short-lived token in the link.** A token in a URL can be shoulder-surfed, kept in
> history, or forwarded in a `Referer`. Mint link tokens with a **short expiry**
> (`signToken({ …, expiry })`, minutes/hours) — they're moved to a header and stripped from the
> URL immediately, and a stale one is dropped on the next `401`. Don't seed a **never-expiring**
> token this way.

#### Programmatic sign / verify

The primitives are exported for use outside the UI:

```ts
import { signToken, verifyToken, TokenError } from "@mrg-keystone/keep";

const token = await signToken(
  { source: "ci-runner", appName: "my-api", expiry: Math.floor(Date.now() / 1000) + 3600 },
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

`bootstrapServer` wires Firebase verification automatically when `FIREBASE_PROJECT_ID` is set.
The verifier is also exported if you need it standalone:

```ts
import { createFirebaseVerifier, FirebaseAuthError } from "@mrg-keystone/keep";

const firebase = createFirebaseVerifier({ projectId: Deno.env.get("FIREBASE_PROJECT_ID")! });

try {
  const { uid, email } = await firebase.verify(idTokenFromClient);
} catch (err) {
  if (err instanceof FirebaseAuthError) { /* missing, malformed, mis-signed, or expired */ }
}
```

Signing keys are fetched from Google and cached (honoring the certs' `Cache-Control`).

### `backend` — in-process HTTP client

The returned `backend` runs requests against the **exact** server pipeline (controllers,
guards, pipes, interceptors, exception filters, middleware) by dispatching through the
underlying handler — no port binding, no TCP, just an `async` call. `bootstrapServer`
itself only initializes (it does **not** `listen()`), so `backend` is usable immediately,
and importable from anywhere:

```typescript
// server.ts
export const app = await bootstrapServer("my-api", AppModule); // init only — non-blocking
// elsewhere.ts
import { app } from "./server.ts";
await app.backend.fetch("/users");                   // ✅ no listen() required
```

#### `backend.fetch(input, init?)` — drop-in for global `fetch`

Mirrors the global `fetch` signature exactly and returns the raw `Response`. Relative
paths resolve against the server's origin, so they work here even though global `fetch`
would reject them:

```typescript
const res = await backend.fetch("/users");                 // → Response
const json = await res.json();

await backend.fetch("/users", {                            // full RequestInit
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Bob" }),
});

await backend.fetch(new Request("http://localhost/users")); // Request object also works
```

Because it's `typeof fetch`, it's a true drop-in: swap `fetch` → `backend.fetch` and any
existing client code (your own wrappers, etc.) keeps working, in-process.

Requests made through `backend` are recognized as in-process and **bypass token auth**
automatically (see [Access tokens & authorization](#access-tokens--authorization)) — no token
is needed to call your own API from within the process.

### Logging

Every request is wrapped by a logging middleware that emits two correlated entries:

```
[ingress my-api 8f3c…] GET /users     + { headers, query, body, routePath }   (structured)
[egress  my-api 8f3c…] GET /users     + { status, headers, body }             (structured)
```

The message carries the `[ingress|egress <appName> <requestId>]` tag; the structured data
is attached as log attributes — the expandable JSON ("the zippy") in Datadog. The request
id is taken from an inbound `x-request-id` / `x-correlation-id` header, or generated, and is
echoed back on the response's `x-request-id` header. Egress level is derived from the status
(`>=500` → error, `>=400` → warn, else info). `authorization` / `cookie` headers are redacted.

#### `log` — request-scoped structured logger

Import `log` anywhere and call `log.<level>(message, data?)`. Inside a request it is
**automatically** tagged with `[<appName> <requestId>]` (matching the surrounding
ingress/egress) and `data` becomes the structured attributes:

```typescript
import { log } from "@mrg-keystone/keep";

class UsersService {
  create(dto: CreateUser) {
    log.info("creating user", { email: dto.email });
    // → console + Datadog: "[my-api 8f3c…] creating user"  { email, requestId }
  }
}
```

Levels: `log.debug`, `log.info`, `log.warn`, `log.error`. Outside a request the tag is
`[<appName>]`.

**Calls are synchronous** — `log.*` writes to the console and fires the Datadog request, but
never awaits the network itself. Each entry is stamped at **call time** with an ISO `timestamp`
and a monotonic `seq`, so ordering reflects when `log()` was called, not when it was sent.

**Delivery** — each log fires its Datadog request **immediately, as the log happens**
(fire-and-forget), and the in-flight promises are collected on the request. Just before the
response is sent — on **any** status code, success or error — the middleware `await`s them
all (`Promise.all`), so every log request has returned before the client gets its response.
Sends started early (ingress, mid-handler) overlap with the handler's work; the wait at the
end is dominated by the egress log, which is sent at the boundary.

A log request **never throws** into your code: each send is wrapped, and on failure (network
error or non-2xx from Datadog) the logger **falls back to console** (surfacing the failure and
the log) **and** raises a **Postmark alert email** — the email throttled to one per
`POSTMARK_ALERT_COOLDOWN_MS` window (default 5 min) so an outage can't flood your inbox. Logs
emitted outside a request fire fire-and-forget.

> Note: awaiting before responding guarantees delivery but adds roughly one Datadog round-trip
> to each response (the egress send starts at the boundary). If you'd rather not block the
> response, the alternative is to let the sends complete off the response path (event loop on a
> long-running server, or `waitUntil` on serverless) — ask and it's a small switch.

### `withBasePath(prefix, handler)`

Wraps a root-based `handler` so it can be mounted under `prefix`: requests whose path is
`prefix` or starts with `prefix + "/"` are dispatched with the prefix stripped (so the
root-registered routes still match); anything else returns `404`. Used to expose the backend
under e.g. `/api` alongside a Fresh frontend while the same handler still serves at root
standalone — see [Deployment](#deployment).

### `createFirebaseVerifier({ projectId })`

Returns a verifier whose `verify(idToken)` validates a Firebase Auth ID token (RS256 against
Google's public certs, plus `aud`/`iss`/`exp`) and resolves `{ uid, email? }`, or throws
`FirebaseAuthError`. `bootstrapServer` uses it automatically when `FIREBASE_PROJECT_ID` is set;
exported for standalone use. See [Access tokens & authorization](#access-tokens--authorization).

### `setupWithSwagger(server)`

Lower-level alternative. Takes an existing `Server` instance and returns a configured `HttpAdapter` with Swagger routes registered, without starting it.

### `@SwaggerDescription(description)`

Decorator to attach a custom description to a module's Swagger documentation.

### `Server`

Module registry. Create with `Server.create()`, register modules with `registerModule()`.

### `DanetDocumentBuilder`

Generates OpenAPI 3.0 specification objects from module metadata.

### `InjectValue`, `InjectFactory`, `InjectClass`

Dependency injection container builders for configuring injectable services.

## Process endpoints, the emulator, and the exercise harness

A module's endpoints can declare their **process order** and **data dependencies** right on the
handler, so keep can (1) serve them, (2) document them in Swagger, (3) render an interactive
**process emulator** per module, and (4) drive them headlessly. This is the surface the
[`rune`](https://github.com/mrg-keystone/rune) workflow generates into.

### `@EndpointController` / `@Endpoint`

Write a thin controller whose handler delegates to your logic. `@Endpoint` composes danet's route
+ body decorators with `@danet/swagger`'s schema decorators, and records the process metadata.
Type the handler's parameter as the input DTO — `@Endpoint` wires `@Body()` for you.

```ts
import { ApiProperty } from "jsr:@danet/swagger@2/decorators";
import { Endpoint, EndpointController, endpointModule, bootstrapServer } from "@mrg-keystone/keep";

class CreateOrderDto { @ApiProperty() item!: string; }
class OrderDto { @ApiProperty() id!: string; @ApiProperty() item!: string; }
class PayDto { @ApiProperty() orderId!: string; }
class ReceiptDto { @ApiProperty() receipt!: string; }

@EndpointController("orders", { description: "Orders API" })
class OrdersController {
  @Endpoint({ input: CreateOrderDto, output: OrderDto, order: 1 })
  create(body: CreateOrderDto): OrderDto { return { id: "o_1", item: body.item }; }

  // Runs after `create`; its request's `orderId` is filled from create's `id` output.
  @Endpoint({
    path: "pay", input: PayDto, output: ReceiptDto, order: 2,
    dependsOn: "create", bind: { orderId: "create.id" },
  })
  pay(body: PayDto): ReceiptDto { return { receipt: `paid ${body.orderId}` }; }
}

export const api = await bootstrapServer("shop", endpointModule("Orders", [OrdersController]));
```

`EndpointOptions`: `method` (default `"post"`), `path`, `input`/`output` DTO classes, `order`
(ascending), `dependsOn` (endpoint id(s) — handler method names), `bind`
(`{ thisInputField: "otherEndpointId.outputField" }`), `description`. The metadata rides into each
module's OpenAPI doc as an **`x-keep-process`** vendor extension.

### The process emulator (per module)

With Swagger on (default), each module gets three docs pages:

| Path | What |
|---|---|
| `/docs/<module>` | the **process emulator** — endpoints as an ordered, bulleted checklist |
| `/docs/<module>/swagger` | the standard Swagger UI (deep inspection) |
| `/docs/<module>/json` | the raw OpenAPI spec (token-gated; see [Docs access](#docs-access)) |

The emulator lists endpoints in `order`/`dependsOn` order. Expand a bullet to see its request
(curl + editable JSON body); click **Emulate process** to fire the real request and see the
response. On success it drops a checkmark, captures the output, and **unlocks the next dependent
step with its request pre-filled** (via `bind`). A **Run all in order** button walks the whole
chain. Walking the list and eyeballing each response verifies the module's logic end-to-end.

### `exerciseEndpoints(opts)` — headless runner

The same metadata, run programmatically (for CI / agents). Discovers endpoints from the
bootstrapped app's `docs`, orders them, runs them while chaining outputs into inputs via `bind`,
rate-limits, and loops until green.

```ts
import { exerciseEndpoints } from "@mrg-keystone/keep";

const report = await exerciseEndpoints({ api });            // in-process (backend.fetch), no token
// report: { passed, failed, iterations, order, cycles }
```

- **Transport.** No `baseUrl` → dispatches in-process via `backend.fetch` (no port, bypasses auth)
  — the default for tests/CI. With `baseUrl` (a running server) it uses **Playwright's
  `APIRequestContext`** over real HTTP.
- **`overrides`.** `seeds` (literal values by field name), `byEndpoint` (per-endpoint overrides by
  id — win over `bind`), and `auth` (`{kind:"in-process"}` default, or `{kind:"token"|"mint", …}`
  using [`signToken`](#programmatic-sign--verify) for network/`baseUrl` runs).
- **`rateLimit`** (`{ requestsPerSecond?, maxConcurrency? }`) and **`maxIterations`** (default 5).

> **Playwright is an optional peer.** It's only loaded when you pass a `baseUrl`; in-process runs
> (and everything else in keep) need no browser. Provision it (`deno run -A npm:playwright install`
> or set `PLAYWRIGHT_BROWSERS_PATH`) only for `baseUrl` runs — note the `APIRequestContext` path
> uses Playwright's HTTP client, not a browser.

## Deployment

The same bootstrapped backend runs in two shapes: **standalone** (a normal HTTP server) or
**embedded** under a Fresh frontend, sharing the in-process client. Both are driven by two
things `bootstrapServer` returns:

- `handler` — the raw `(Request) => Response` dispatcher (the same pipeline `listen()` serves).
- `backend` — the in-process client (`backend.fetch(...)`), which bypasses token auth.

Bootstrap once in a shared module (init only — it does **not** `listen()`):

```ts
// backend.ts
import "reflect-metadata";
import { bootstrapServer } from "@mrg-keystone/keep";
import { AppModule } from "./app.module.ts";

export const api = await bootstrapServer("my-api", AppModule);
```

### Standalone

Serve the handler directly — works locally and on Deno Deploy:

```ts
// server.ts
import { api } from "./backend.ts";

// Forward Deno's conn info so localhost/loopback detection keeps working.
Deno.serve((req, info) => api.handler(req, info));   // or: await api.listen();
```

> **Forward `info`.** `api.handler` takes `(req, info?)`. When you dispatch through it from your
> own `Deno.serve`, pass the second `info` argument — it carries `remoteAddr`, which the
> localhost trust, the token-auth localhost exemption, and the `/_mint` guard all rely on. Drop
> it (`Deno.serve((req) => api.handler(req))`) and every request looks origin-less, so localhost
> is no longer recognized and `/_mint` becomes unreachable.

Network clients must send a token (`Authorization: Bearer <token>`); see
[Access tokens & authorization](#access-tokens--authorization).

### Embedded under a Fresh 2 frontend

Fresh owns `/`; the token-gated backend is mounted at `/api/*` with `withBasePath` (which
strips the prefix so the root-registered routes still match). Register it **before**
`.fsRoutes()` — the Fresh `App` builder is order-sensitive:

```ts
// main.ts  (Fresh 2 entry)
import { App, staticFiles } from "fresh";
import { withBasePath } from "@mrg-keystone/keep";
import { api } from "./backend.ts";
import type { State } from "./utils.ts";

const mountedApi = withBasePath("/api", api.handler);

export const app = new App<State>()
  .use(staticFiles())
  // Forward Fresh's conn info so loopback detection works for the mounted backend.
  .all("/api/*", (ctx) => mountedApi(ctx.req, ctx.info))   // external, token-gated API surface
  .fsRoutes();
```

(`withBasePath` forwards the `info` you pass it down to the backend.)

`bootstrapServer` is **bundler-safe**: it lazy-loads the Swagger builder (and its CommonJS
`handlebars` dependency), so importing it from Fresh works through Vite's SSR in both
`deno task dev` and the production build (`deno task build` → `deno serve _fresh/server.js`). A
complete, runnable version of this whole section — plus the browser token flow and a
localhost-trust toggle — is in [`examples/fresh-project`](examples/fresh-project).

Fresh's server-side code (handlers, loaders) calls the backend **in-process** — no network
hop, no token needed:

```tsx
// routes/users.tsx
import { page } from "fresh";
import { define } from "../utils.ts";
import { api } from "../backend.ts";

export const handler = define.handlers({
  async GET() {
    const res = await api.backend.fetch("/users");   // in-process; bypasses token auth
    return page({ users: await res.json() });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <ul>{data.users.map((u) => <li key={u.id}>{u.name}</li>)}</ul>
));
```

So one Deno Deploy process serves the Fresh UI at `/`, exposes the token-gated API at `/api/*`
for external callers, and lets the frontend reach the backend in-process. The backend stays
fully runnable standalone — same `api`, different entry.

For browser-side calls that *do* go over the network to `/api` (an island's `fetch`), attach a
credential — either a **signed token** seeded from `?token=` and auto-injected from `localStorage`
(see [Browser access to your own API](#browser-access-to-your-own-api-frontend-token)), or the
user's **Firebase ID token** as `Authorization: Bearer <idToken>` (with `FIREBASE_PROJECT_ID`
set). Server-side rendering should still prefer `api.backend.fetch(...)`, which is in-process and
needs no credential.

**Deno Deploy notes**
- Set env vars in the Deploy project: `MANUAL_KEY` (signed tokens) and/or `FIREBASE_PROJECT_ID`
  (Firebase Auth), plus `DD_API_KEY` / `POSTMARK_*` as needed.
- Fresh requires a build: `deno task build`, then serve `_fresh/server.js` — the backend
  singleton is imported by Fresh's server code and runs in the same process.
- The localhost `/_mint` UI is unreachable in production (it `403`s off-localhost). Mint tokens
  locally, or programmatically with `signToken` (see above).

## Testing

```sh
deno test -A --unstable-raw-imports
```
