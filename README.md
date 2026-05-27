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

## API

### `bootstrapServer(appName, module, options?)`

Creates and configures a server with optional Swagger documentation and request logging.

- `appName` — used in every log line and as the Datadog `service`
- `module` — root application module class
- `options.port` — port number (default: 3000)
- `options.swagger` — `true` (default), `false`, or `{ filters: string[] }` to exclude modules

Returns `{ listen(), stop(), backend }`.

#### Logging environment variables

Logging is driven entirely by environment variables — nothing is passed in code:

| Variable | Enables | If missing |
|---|---|---|
| `DD_API_KEY` | Datadog logging | warns once, logs to console only |
| `POSTMARK_SERVER_TOKEN` | failure-alert emails | warns once, failures fall back to console |
| `POSTMARK_FROM` | failure-alert emails | (required with the token) must be a verified Postmark sender |
| `POSTMARK_TO` | — | alert recipient; defaults to `POSTMARK_FROM` |

The Datadog site is fixed to `us5.datadoghq.com`, and alert emails use a 5-minute cooldown.

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

## Testing

```sh
deno test -A --unstable-raw-imports
```
