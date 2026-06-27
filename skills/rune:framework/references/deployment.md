# Deployment, the backend client, logging, and releasing

## Two shapes, one bootstrap

`bootstrapServer` **initializes only** (no `listen()`), so bootstrap once in
a shared module and import it everywhere:

```ts
// backend.ts
import { bootstrapServer } from "@mrg-keystone/rune";
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

### Hosted under a sprig UI

The frontend is **sprig**, and the composition lives in the sprig package
`@sprig/keep`. `serveSprig({ keep, app, base })` returns a single `{ fetch }`
default export — run it with `deno serve serve.ts` (**not** `Deno.serve()`):

```ts
// serve.ts
import { serveSprig } from "@sprig/keep";
import app from "./app/src/main.ts";   // the sprig SSR app
import { api } from "./backend.ts";
export default serveSprig({ keep: api, app });
```

`serveSprig` routes `/api/*` and `/docs*` to the keep's token-gated `handler`
(forwarding conn info, so loopback detection keeps working) and everything else
to the sprig SSR app — with the keep's in-process `backend.fetch` bound to
sprig's `Backend` DI token. SSR pages read data through that in-process channel
via `inject(Backend)` in a page's `resolve.ts` or a service — **no TCP, no
token**. Browser islands can't make in-process calls, so they reach the backend
over the token-gated `/api/*` channel (attach a credential — see
`references/auth.md`, "Browser access to your own API").

`bootstrapServer` is bundler-safe (lazy-loads the Swagger builder and its
CJS `handlebars` dep), so importing the backend into a bundled SSR frontend
works in both dev and production builds.

`rune init` scaffolds this whole app: a `serve.ts` composition root, an `app/`
sprig UI tree (`app/src/main.ts` + a starter page), the `bootstrap/` keep
backend, and a `deno.json` wired with `@sprig/core` + `@mrg-keystone/rune` and a
`deno serve serve.ts` start task.

### Mounting under any host

To mount the sprig UI inside an existing host (`Deno.serve`, Danet, Hono), use
`sprigUi(config)` — a framework-agnostic middleware that returns
`Response | null` (`null` = pass-through, so the host handles the route).

For mounting the keep's `handler` under a prefix in any host, use the
lower-level `withBasePath(prefix, handler)`: it dispatches `prefix`-rooted
requests with the prefix stripped and 404s the rest. It's plain request
routing — framework-agnostic, not tied to any UI.

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

- Unit tests: `deno task test`. Browser (cake/map) tests:
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
