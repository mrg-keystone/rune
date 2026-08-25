# Deployment, the backend client, logging, and releasing

## Two shapes, one bootstrap

`bootstrapServer` **initializes only** (no `listen()`), so bootstrap once in
a shared module and import it everywhere:

```ts
// server/bootstrap/mod.ts
import { bootstrapServer } from "@mrg-keystone/rune";
import { modules } from "./modules.ts";
export const api = await bootstrapServer("my-api", modules);
```

No `import "reflect-metadata"` needed — the package loads the polyfill
itself.

### Standalone

```ts
// server.ts
import { api } from "./server/bootstrap/mod.ts";
Deno.serve((req, info) => api.handler(req, info)); // or: await api.listen();
```

**Forward `info`.** `api.handler` takes `(req, info?)` — `info` carries
`remoteAddr`, which request logging and tracing attribute the caller with. Drop
it and every request looks origin-less. (Auth no longer depends on `remoteAddr`
— trust is in-process key or infra bearer only — but keep forwarding `info` so
logs stay attributable.)

### The canonical composition — the backend layer + a Frontend

The composed app serves ONE of three canonical shapes:

```ts
Deno.serve(Backend(appName, modules))                            // backend alone
Deno.serve(Backend(appName, modules, { frontend: Frontend() }))  // full-stack
Deno.serve(Frontend())                                           // frontend alone
```

The scaffolded `serve.ts` composes from the app's own booted root (single
boot — `rune dev` and the headless runner reuse it) via `api.compose`:

```ts
// serve.ts  (git root — GENERATED)
import { Frontend } from "@mrg-keystone/sprig/keep";
import { api } from "./server/bootstrap/mod.ts";
export default { fetch: api.compose({ frontend: Frontend() }) };
```

The backend layer owns `/api/` INTRINSICALLY: every backend route — including
the docs/cake/map pages, now at **`/api/docs/*`** — lives under it, so it can
never collide with a frontend that owns the root. Everything else delegates to
the `Frontend`, which receives a fresh **request-bound in-process client** as
its third argument each request: SSR's `inject(Backend)` reads in-process with
the incoming request's own cookies (no TCP, zero cookie plumbing), and
`Set-Cookie` from in-process calls is collected onto the outer browser
response. Islands call `/api/*` over the wire; the two channels are
byte-identical by contract — the parity suite gates it. keep ships zero
built-in auth: wrap the composition in your own guard when you need one
(`Deno.serve(Auth(api.compose({ frontend: Frontend() })))`).

In-process dispatch is always UNPREFIXED (`backend.fetch("/users")`,
`backend.fetch("/docs/_run")`) — the mount is the layer's, applied once; a
browser reaches the same routes at `/api/users` / `/api/docs/_run`. Legacy
apps composed with `serveSprig({ keep: api })` keep working (UI `/ui`, API
`/api/*`, docs at bare `/docs*`); it is the retiring shape.

`bootstrapServer` is bundler-safe (lazy-loads the Swagger builder and its
CJS `handlebars` dep), so importing the backend into a bundled SSR frontend
works in both dev and production builds.

`rune init` scaffolds this whole app: a git-root `serve.ts` composition root, a
`ui/` sprig UI package (`ui/src/mod.ts` + a starter page), the `server/` keep
backend (`server/bootstrap/mod.ts`), and a git-root workspace `deno.json`
(`["./ui","./server"]`) wired with `@mrg-keystone/sprig` + `@mrg-keystone/rune`
and a `deno serve -A serve.ts` start task.

### Mounting under any host

To mount the sprig UI inside an existing host (`Deno.serve`, Danet, Hono), use
`sprigUi(config)` — a framework-agnostic middleware that returns
`Response | null` (`null` = pass-through, so the host handles the route).

For mounting the keep's `handler` under a prefix in any host, use the
lower-level `withBasePath(prefix, handler)`: it dispatches `prefix`-rooted
requests with the prefix stripped and 404s the rest. It's plain request
routing — framework-agnostic, not tied to any UI.

**Deno Deploy:** keep 5.0 ships zero built-in auth — no infra verification, no
sessions, no grants; routes are open unless the app composes its own guard
(model + removed env vars → `references/auth.md`). Configure observability as
needed: `DD_API_KEY`, `POSTMARK_SERVER_TOKEN`/`POSTMARK_FROM` (+ optional
`ALERT_RECIPIENTS`).

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
