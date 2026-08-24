# Auth: keep ships none, by design

Read this before reasoning about auth in a keep app. Since keep 5.0 the model
is: **keep ships ZERO built-in auth.** No infra trust, no session store, no
grants, no route guard, no token exchange. Every controller route and every
`/docs` route answers any caller — network or in-process — identically. Cookies
are bytes keep transports faithfully on both channels; auth, if an app wants
it, is **a guard the app composes into its own handler pipeline**.

## What was removed (5.0)

The entire infra trust stack: the deny-by-default global guard,
`@Public`/`@LoggedIn`/`@Grant`/`@Grants`/`@Internal`/`@InProcessOnly`
decorators, the infra client (JWKS verification, opaque-token exchange,
revocation poll), the server-side session store (`sprig_session` cookie
machinery, `intakeSession`/`destroySession`), grants, and the route audit.
Their env vars are **removed** — set-but-removed vars trigger a one-time boot
warning naming them, and are otherwise inert:

`INFRA_URL`, `INFRA_JWKS_URL`, `INFRA_JWKS_TTL_SECONDS`,
`INFRA_POLL_INTERVAL_MS`, `KEEP_ROUTE_AUDIT`, `KEEP_SESSION_KV`,
`KEEP_SESSION_TTL_DAYS`, `HONOR_SKELETON`.

One rename in the same cleanup: `POSTMARK_TO` → `ALERT_RECIPIENTS` (dropped
hard — migrate the value; the old name does nothing).

## Diagnosing a 401/403 today

A 401/403 from a keep 5.x backend **cannot come from keep itself** — keep has
no code path that mints one for auth. It comes from:

1. **An older keep** (4.x or earlier) still deployed — check the pinned
   `@mrg-keystone/rune` version first; the 4.x deny-by-default guard 401s any
   bare network caller.
2. **The app's own guard** — a guard composed into the app's handler pipeline.
   Read the app's composition, not the framework.
3. **Something in front** (a proxy, a platform edge).

## Adding auth to an app (the guard layer)

Placement decides coverage. There are two dispatch channels into a backend —
the network path and the in-process client (`backend.fetch`, SSR's
`inject(Backend)`) — and **exactly one placement covers both: a guard built
into the backend's own handler**, where both channels dispatch into.

- Guard **inside the backend handler** → covers network AND in-process. ✅
- Guard **wrapping the backend from outside** → the in-process client
  dispatches straight into the handler and never traverses the wrapper: SSR
  reads run **unauthenticated**. Silent bypass. ⚠️
- Guard **wrapping the frontend** → covers neither channel. ⚠️

The check that proves placement: drop the session/credential entirely, issue
the same read once via SSR (in-process) and once over the network — **both**
must come back blocked.

Cookie fidelity is the substrate: the in-process client carries the incoming
request's own `Cookie` header and honors `Set-Cookie` bidirectionally, exactly
like a page's own `fetch`. So a cookie-based guard inside the handler sees the
same credentials on both channels with zero plumbing.

## The `/docs` surface

The docs pages, the OpenAPI spec at `/docs/<module>/json`, and the
control-plane doors (`/docs/_run`, `/docs/_heal`, `/docs/_traces`,
`/docs/_fixtures`, `/docs/_scenarios`, `/docs/_heal-rules`) are **open routes**
like everything else. A deployment that must restrict them composes its own
guard. The legacy `?token=` seeding script in the doc pages is inert plumbing —
a stray token is ignored, never required.
