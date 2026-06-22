# Keep in a Fresh 2 app

A runnable Fresh 2 app that embeds a Keep backend. One Deno process serves the
Fresh UI at `/`, exposes the **token-gated** Keep API at `/api/*` for network
callers, and lets the frontend call the backend **in-process** (no token, no
network hop). Works in `deno task dev` and the production build.

## What it shows

| Capability                                                   | Where                                                |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| SSR calling the API in-process (no token)                    | `routes/users.tsx` → `ctx.state.api.fetch("/users")` |
| Token-gated network API at `/api/*` + in-process client      | `main.ts` → `embed(api, { at: "/api" })`             |
| `@Public()` route open on the network                        | `backend.ts` → `HealthController`                    |
| Token via `Authorization` header **or** `?token=`            | Keep guard                                           |
| Browser: seed token from `?token=`, auto-inject, drop on 401 | `client.ts` + `routes/probe.tsx`                     |
| Swagger docs + cake embedded under the mount             | `/api/docs` (shells public, spec token-gated)        |

## Run it

```sh
deno task dev      # http://localhost:5173
deno task smoke    # boots Vite, asserts the 7-case matrix, tears down
```

Pages to open:

- **`/users`** — SSR list rendered from the backend in-process. Always works (no
  token).
- **`/probe`** — fetches `/api/users` from the **browser**. Walks you through
  the token flow.

### The token flow (browser)

Auth is the infra-centralized model: **infra** mints opaque tokens (`mtk_…`) and
signs short-lived session bearers; **keep** verifies those bearers offline against
infra's JWKS and exchanges opaque tokens at `POST /api/_token`. keep never mints.

1. Gate the API: run `INFRA_BASE_URL=<infra> TRUST_LOCALHOST=false deno task dev`.
2. `/probe` → _fetch_ → **401** (no token).
3. Open `/probe?token=<SESSION_BEARER>` — `client.ts` saves it to `localStorage`
   and strips it from the URL. _fetch_ → **200**. Reload `/probe` → still 200
   (token persists). A 401 (e.g. the bearer lapsed) clears it.

Get a `<SESSION_BEARER>` by exchanging an opaque manual token (minted in infra's
Tokens UI) at the exchange endpoint — keep returns the bearer to cache and re-send:

```sh
curl -s -X POST http://localhost:8173/api/_token \
  -H 'content-type: application/json' \
  -d '{"token":"mtk_<your-opaque-token>"}'
# → { "bearer": "<SESSION_BEARER>", "source": "…" }
```

Keep link tokens short — a bearer rides in a URL until the browser moves it to a
header. The client re-exchanges (calls `/api/_token` again) when the bearer lapses.

> **Develop with the gate ON.** `deno task dev` trusts `localhost`, so `/api`
> accepts everything from your browser and you never actually exercise auth. To
> see the real gated behavior, run
> `INFRA_BASE_URL=<infra> TRUST_LOCALHOST=false deno task dev` (then localhost
> needs a token, just like production). The smoketest already runs gated (it
> stands up a stub infra).

## How it's wired (3 pieces)

```ts
// backend.ts — bootstrap once, export `api` (init only; no listen())
export const api = await bootstrapServer("fresh-project", AppModule, {
  swagger: false,
});
```

```ts
// main.ts — one middleware, BEFORE .fsRoutes()
app.use(embed(api, { at: "/api" })); // token-gated /api/* + ctx.state.api in-process client
```

```tsx
// routes/users.tsx — SSR calls the API in-process
const users = await (await ctx.state.api.fetch("/users")).json();
```

`embed` strips the `/api` prefix so the root-registered routes match, forwards
Fresh's conn info (so localhost-trust keeps working — no `ctx.info` to
remember), and puts the token-free in-process client on `ctx.state.api`. Extend
`KeepState` in `utils.ts` and it's typed. The one remaining rule: register it
**before** `.fsRoutes()`.

## Note for consumers: this example links local Keep

`deno.json` imports Keep from JSR **exactly as you would**, and adds **one**
monorepo-only line that overrides it with this repo's local source so the
example tracks unreleased changes:

```jsonc
"links": ["../.."],   // ← MONOREPO-ONLY: delete this in your own app
"imports": {
  "@mrg-keystone/keep": "jsr:@mrg-keystone/keep@^1.12",
  "@danet/core": "jsr:@danet/core@2"
},
"compilerOptions": { "experimentalDecorators": true, "emitDecoratorMetadata": true }
```

`links` (Deno's local-package link, formerly `patch`) makes Keep resolve **its
own** dependencies from **its own** `deno.json` — so the consumer config stays
these few lines and behaves just like the published package (no symlink, no
copied `#danet/*`/`@foundation/*` specifiers). In your app, delete the `links`
line; everything else (`backend.ts`, `main.ts`, the routes, `client.ts`) is
identical.

> ⚠️ **Requires Keep ≥ 1.12.0.** The bundler/Fresh fix (lazy-loading
> `handlebars`) and the `?token` support land in **1.12.0**. The
> currently-published **1.11.0 will crash under Vite SSR**
> (`Cannot assign to read only property '__esModule'`). Publish 1.12.0
> (`deno publish`) before pointing a real app at the JSR package. This example
> sidesteps that by linking local source.
