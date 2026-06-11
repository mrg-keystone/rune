# Deployment, the backend client, logging, and releasing

## Two shapes, one bootstrap

`bootstrapServer` **initializes only** (no `listen()`), so bootstrap once in
a shared module and import it everywhere:

```ts
// backend.ts
import { bootstrapServer } from "@mrg-keystone/keep";
import { AppModule } from "./app.module.ts";
export const api = await bootstrapServer("my-api", AppModule);
```

No `import "reflect-metadata"` needed — the package loads the polyfill
itself.

### Standalone

```ts
// server.ts
import { api } from "./backend.ts";
Deno.serve((req, info) => api.handler(req, info)); // or: await api.listen();
```

**Forward `info`.** `api.handler` takes `(req, info?)` — `info` carries
`remoteAddr`, which localhost trust, the token-auth localhost exemption, and
the `/_mint` guard all rely on. Drop it and every request looks origin-less:
localhost is no longer recognized and `/_mint` becomes unreachable.

### Embedded under a Fresh 2 frontend

One `embed` middleware exposes the token-gated backend at `/api/*` and puts
the in-process client on `ctx.state.api` for every other request. Register it
**before** `.fsRoutes()` (the Fresh `App` builder is order-sensitive):

```ts
// main.ts
import { App, staticFiles } from "fresh";
import { embed } from "@mrg-keystone/keep";
import { api } from "./backend.ts";
export const app = new App<State>()
  .use(staticFiles())
  .use(embed(api, { at: "/api" }))
  .fsRoutes();

// utils.ts — typing for ctx.state.api
import type { KeepState } from "@mrg-keystone/keep";
export interface State extends KeepState {}
```

`embed` rebases `/api/*` onto the root-registered routes and forwards Fresh's
conn info automatically (loopback detection keeps working). Fresh server code
calls the backend **in-process** — `await ctx.state.api.fetch("/users")` —
no network hop, no token. Browser-side island calls to `/api` need a
credential (see `references/auth.md`, "Browser access to your own API").

`bootstrapServer` is bundler-safe (lazy-loads the Swagger builder and its
CJS `handlebars` dep) — importing from Fresh works in `deno task dev` and the
production build (`deno task build` → `deno serve _fresh/server.js`). A
complete runnable example: `examples/fresh-project` in the keep repo.

For mounting into anything other than Fresh, use the lower-level
`withBasePath(prefix, handler)`: dispatches `prefix`-rooted requests with the
prefix stripped, 404s the rest.

**Deno Deploy:** set `MANUAL_KEY` and/or `FIREBASE_PROJECT_ID` (plus
`DD_API_KEY` / `POSTMARK_*`) in the project env. `/_mint` is unreachable in
production (403s off-localhost) — mint locally or with `signToken`.

## `backend` — the in-process client

`backend.fetch(input, init?)` mirrors global `fetch` exactly (same signature,
returns `Response`) but dispatches through the actual server pipeline —
controllers, guards, pipes, interceptors, filters, middleware — with no port
or TCP. Relative paths resolve against the server's origin. Usable
immediately after `bootstrapServer` (no `listen()` needed), and recognized as
in-process so it **bypasses token auth**. It is `typeof fetch` — a true
drop-in for client code.

## Logging

Every request emits correlated `[ingress|egress <app> <requestId>]` entries
with structured attributes (headers, query, body / status, headers, body).
Request id: inbound `x-request-id`/`x-correlation-id` or generated; echoed
back as `x-request-id`. Egress level derives from status (>=500 error,
>=400 warn). `authorization`/`cookie` headers are redacted.

`log.<debug|info|warn|error>(message, data?)` from anywhere — inside a
request it's auto-tagged `[<app> <requestId>]` and `data` becomes structured
attributes. Calls are synchronous (never await the network); each entry is
stamped at call time (ISO timestamp + monotonic seq).

Delivery: each log fires its Datadog request immediately (fire-and-forget);
just before the response is sent the middleware awaits them all — so
delivery is guaranteed but each response carries roughly one Datadog
round-trip (the egress send). A failed send never throws into your code: it
falls back to console and raises a throttled Postmark alert
(`POSTMARK_ALERT_COOLDOWN_MS`, default 5 min). Datadog site is fixed to
`us5.datadoghq.com`.

## Smaller exports

- `setupWithSwagger(server)` — configure an existing `Server` with Swagger
  routes, without starting it.
- `@SwaggerDescription(text)` — module-level Swagger description.
- `Server`, `DanetDocumentBuilder` — the lower-level registry / OpenAPI
  builder.
- `InjectValue`, `InjectFactory`, `InjectClass` — DI container builders.

## Testing and releasing the keep repo itself

- Unit tests: `deno task test`. Browser (emulator/map) tests:
  `deno task test:browser` (needs chromium:
  `deno run -A npm:playwright install chromium chromium-headless-shell`).
  E2E fixtures: `KEEP_BROWSER=1 deno task test:e2e`. Publish dry-run:
  `deno task check:jsr`.
- Every push to `main` publishes to JSR via `.github/workflows/publish.yml`:
  preflight emulates JSR's server-side dependency validation locally; the
  version auto-bumps from the latest published (patch default, minor on
  `feat:`, major on a breaking marker) and the bump is committed back.
- **Never cancel a publish run that looks hung** — JSR's backend keeps the
  package lock when the client disconnects (jsr-io/jsr#1448), wedging the
  next attempt too. Server-side processing alone has taken ~22 minutes; a
  real task failure surfaces its error within ~20s via the task API the
  workflow polls.
