# @mrg-keystone/danet

Core module for the Danet framework. Provides server bootstrapping with automatic
OpenAPI/Swagger documentation generation and request-scoped structured logging to Datadog.

## Quick Start

```typescript
import "reflect-metadata";
import { bootstrapServer, log, SwaggerDescription } from "@mrg-keystone/danet";
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
var, not sent over the network — so a network client cannot forge it. It's compared in constant
time, and is regenerated every boot.

A network caller authorizes by sending a credential in the `Authorization` header:

```
Authorization: Bearer <credential>
```

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

#### Token shape

A token is a compact JWT (`HS256`) signing these claims:

```ts
interface TokenPayload {
  source: string;   // who the token was minted for — used for log attribution
  expiry: number;   // Unix epoch in SECONDS; the token is rejected once passed
  appName: string;  // the app the token grants access to
}
```

The signature is keyed by `MANUAL_KEY`, so neither the expiry nor any claim can be altered
without invalidating the token. `verifyToken` rejects a token that is malformed, mis-signed, or
expired.

#### Minting tokens — the localhost UI

`bootstrapServer` mounts a token-minting UI at **`GET /_mint`** that works on `localhost` only
(any non-loopback request gets `403`). Open it in a browser, fill in `source`, `appName`, and
`expiry`, and submit to receive a token. The signing key is read from `MANUAL_KEY` on the
server — it is never entered into or returned by the form. If `MANUAL_KEY` is unset, minting
fails closed.

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

#### Programmatic sign / verify

The primitives are exported for use outside the UI:

```ts
import { signToken, verifyToken, TokenError } from "@mrg-keystone/danet";

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
import { createFirebaseVerifier, FirebaseAuthError } from "@mrg-keystone/danet";

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
import { log } from "@mrg-keystone/danet";

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
import { bootstrapServer } from "@mrg-keystone/danet";
import { AppModule } from "./app.module.ts";

export const api = await bootstrapServer("my-api", AppModule);
```

### Standalone

Serve the handler directly — works locally and on Deno Deploy:

```ts
// server.ts
import { api } from "./backend.ts";

Deno.serve(api.handler);   // or: await api.listen();  (binds the configured port)
```

Network clients must send a token (`Authorization: Bearer <token>`); see
[Access tokens & authorization](#access-tokens--authorization).

### Embedded under a Fresh 2 frontend

Fresh owns `/`; the token-gated backend is mounted at `/api/*` with `withBasePath` (which
strips the prefix so the root-registered routes still match). Register it **before**
`.fsRoutes()` — the Fresh `App` builder is order-sensitive:

```ts
// main.ts  (Fresh 2 entry)
import { App, staticFiles } from "fresh";
import { withBasePath } from "@mrg-keystone/danet";
import { api } from "./backend.ts";
import type { State } from "./utils.ts";

const mountedApi = withBasePath("/api", api.handler);

export const app = new App<State>()
  .use(staticFiles())
  .all("/api/*", (ctx) => mountedApi(ctx.req))   // external, token-gated API surface
  .fsRoutes();
```

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

For browser-side calls that *do* go over the network to `/api` (an island's `fetch`), send the
user's **Firebase ID token** as `Authorization: Bearer <idToken>`; with `FIREBASE_PROJECT_ID`
set, the backend accepts it (see
[Access tokens & authorization](#access-tokens--authorization)). Server-side rendering should
still prefer `api.backend.fetch(...)`, which is in-process and needs no credential.

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
