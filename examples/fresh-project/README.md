# Danet in a Fresh 2 app

A runnable Fresh 2 app that embeds a Danet backend. One Deno process serves the Fresh UI at `/`,
exposes the **token-gated** Danet API at `/api/*` for network callers, and lets the frontend call
the backend **in-process** (no token, no network hop). Works in `deno task dev` and the production
build.

## What it shows

| Capability | Where |
|---|---|
| SSR calling the API in-process (no token) | `routes/users.tsx` → `ctx.state.api.fetch("/users")` |
| Token-gated network API at `/api/*` | `main.ts` → `withBasePath("/api", api.handler)` |
| `@Public()` route open on the network | `backend.ts` → `HealthController` |
| Token via `Authorization` header **or** `?token=` | Danet guard |
| Browser: seed token from `?token=`, auto-inject, drop on 401 | `client.ts` + `routes/probe.tsx` |
| Flip localhost-trust at runtime to test the gate | `main.ts` → `/trust` |

## Run it

```sh
deno task dev      # http://localhost:5173
deno task smoke    # boots Vite, asserts the 7-case matrix, tears down
```

Pages to open:

- **`/users`** — SSR list rendered from the backend in-process. Always works (no token).
- **`/probe`** — fetches `/api/users` from the **browser**. Walks you through the token flow.
- **`/trust`** — flip whether `localhost` is trusted on `/api` (see the gate both ways).

### The token flow (browser)

1. Gate the API: open `/trust?set=off`.
2. `/probe` → *fetch* → **401** (no token).
3. Open `/probe?token=<TOKEN>` — `client.ts` saves it to `localStorage` and strips it from the URL.
   *fetch* → **200**. Reload `/probe` → still 200 (token persists). A 401 (e.g. expired) clears it.

Mint a **short-lived** `<TOKEN>` locally (same `MANUAL_KEY` the server runs with). Keep link
tokens short — they ride in a URL until the browser moves them to a header:

```sh
MANUAL_KEY=dev-secret deno run -A - <<'EOF'
import { signToken } from "@mrg-keystone/danet";
const expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
console.log(await signToken({ source: "demo", appName: "fresh-project", expiry }, Deno.env.get("MANUAL_KEY")));
EOF
```

> **Develop with the gate ON.** `deno task dev` trusts `localhost`, so `/api` accepts everything
> from your browser and you never actually exercise auth. To see the real gated behavior, run
> `MANUAL_KEY=dev-secret TRUST_LOCALHOST=false deno task dev` (then localhost needs a token, just
> like production) — or flip it per-request with the `/trust` page. The smoketest already runs
> gated.

## How it's wired (4 pieces)

```ts
// backend.ts — bootstrap once, export `api` (init only; no listen())
export const api = await bootstrapServer("fresh-project", AppModule, { swagger: false });
```
```ts
// main.ts — two lines of integration, BEFORE .fsRoutes()
app.use((ctx) => { ctx.state.api = api.backend; return ctx.next(); });   // in-process client
const mountedApi = withBasePath("/api", api.handler);                    // token-gated network API
app.all("/api/*", (ctx) => mountedApi(ctx.req, ctx.info));               // forward ctx.info!
```
```tsx
// routes/users.tsx — SSR calls the API in-process
const users = await (await ctx.state.api.fetch("/users")).json();
```
```ts
// utils.ts — type ctx.state.api
export interface State { api: BackendClient; /* ... */ }
```

Two things that are easy to get wrong: register the `/api/*` mount **before** `.fsRoutes()`, and
**forward `ctx.info`** to the mount (it carries `remoteAddr`, which the localhost-trust check
needs — drop it and localhost stops being recognized).

## Note for consumers: this example links local Danet

`deno.json` imports Danet from JSR **exactly as you would**, and adds **one** monorepo-only line
that overrides it with this repo's local source so the example tracks unreleased changes:

```jsonc
"links": ["../.."],   // ← MONOREPO-ONLY: delete this in your own app
"imports": {
  "@mrg-keystone/danet": "jsr:@mrg-keystone/danet@^1.12",
  "@danet/core": "jsr:@danet/core@2",
  "reflect-metadata": "npm:reflect-metadata@0.1.13"
},
"compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true }
```

`links` (Deno's local-package link, formerly `patch`) makes Danet resolve **its own** dependencies
from **its own** `deno.json` — so the consumer config stays these few lines and behaves just like
the published package (no symlink, no copied `#danet/*`/`@foundation/*` specifiers). In your app,
delete the `links` line; everything else (`backend.ts`, `main.ts`, the routes, `client.ts`) is
identical.

> ⚠️ **Requires Danet ≥ 1.12.0.** The bundler/Fresh fix (lazy-loading `handlebars`) and the
> `?token` support land in **1.12.0**. The currently-published **1.11.0 will crash under Vite SSR**
> (`Cannot assign to read only property '__esModule'`). Publish 1.12.0 (`deno publish`) before
> pointing a real app at the JSR package. This example sidesteps that by linking local source.
