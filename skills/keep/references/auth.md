# Auth: the trust model, tokens, roles, and docs access

Read this before changing anything auth-related in a keep app. The model is
deny-by-default with two trusted origins; everything else is credential-based.

## Who needs a credential

| Caller | Recognized by | Credential |
| ------ | ------------- | ---------- |
| In-process (`backend.fetch`) | a process-private key stamped on the request (`x-danet-internal`) | **No** |
| `localhost` | the connection's real TCP peer address (`remoteAddr`) — never `X-Forwarded-For` | **No** (unless `TRUST_LOCALHOST=false`) |
| Network | neither of the above | **Yes** — 401 without one |

The in-process key is minted at boot (`crypto.randomUUID()`), never leaves
the process, is redacted from logs, compared in constant time, regenerated
every boot. A network client cannot forge it.

**Localhost caveat:** a reverse proxy on the same host connects over
loopback, so its remote clients would ride in on a genuinely-local
connection. Don't front the app with a same-host loopback proxy while relying
on localhost trust — expose `api.handler` directly, or set
`TRUST_LOCALHOST=false` (in-process trust stays, so SSR keeps working).

## The footgun and the safe mount

`backend.fetch(...)` is the trusted channel — anything dispatched through it
skips auth. Correct for *originating* your own calls (SSR, tests); a footgun
if you use it to **proxy inbound traffic** (external requests would be served
auth-exempt). **Never route inbound requests through `backend.fetch`.**

The safe path is safe by construction:

- `api.handler` **strips the in-process trust header** from every inbound
  request — no network request can impersonate an in-process call, however
  mounted or proxied.
- Swagger docs **don't honor the in-process bypass at all**: the spec
  (`/docs/<module>/json`) is served only to a genuine loopback caller or a
  valid token.

## Credentials — two kinds, either authorizes

Send via `Authorization: Bearer <credential>` (preferred) or `?token=`
(for plain links / first navigations / WebSocket upgrades; redacted from
request logs — prefer the header where possible).

1. **Signed access token** (HS256, keyed by `MANUAL_KEY`) — for
   service-to-service callers.
2. **Firebase Auth ID token** — for browser/frontend callers, when
   `FIREBASE_PROJECT_ID` is set (verified against Google's public certs:
   RS256 + `aud`/`iss`/`exp`; only the project id is needed — no service
   account).

The resolved identity tags every log line of the request (`source` for a
signed token; the user's email/uid for Firebase).

## Token shape

```ts
interface TokenPayload {
  source: string;   // who the token was minted for — log attribution
  expiry?: number;  // Unix epoch SECONDS; OMIT for never-expires
  appName: string;  // the app this token grants access to
  roles?: string[]; // namespaced `appName:role` entries, checked by @Roles
}
```

A token with no `expiry` never expires and is only invalidated by rotating
`MANUAL_KEY` (which invalidates ALL signed tokens) — mint sparingly.

## Minting

- **Localhost UI**: `GET /_mint` — works on localhost only (403 from the
  network, unconditionally). Fill source/appName/expiry; the result page also
  gives a ready-to-share `…/docs?token=…` link. The key is read from
  `MANUAL_KEY` server-side; unset → minting fails closed.
- **Programmatic**:

```ts
import { signToken, TokenError, verifyToken } from "@mrg-keystone/keep";
const token = await signToken(
  { source: "ci", appName: "my-api", expiry: Math.floor(Date.now() / 1000) + 3600 },
  Deno.env.get("MANUAL_KEY")!,
);
const payload = await verifyToken(token, key); // throws TokenError otherwise
```

- **Firebase, standalone**: `createFirebaseVerifier({ projectId })` →
  `verify(idToken)` → `{ uid, email? }` or throws `FirebaseAuthError`.
  (`bootstrapServer` wires this automatically when `FIREBASE_PROJECT_ID` is
  set.)

## `@Public()` — auth-optional

Auth is a **global guard** (deny-by-default on every controller route).
`@Public()` on a controller exempts all its routes; on a method, just that
one.

- Public means auth-**optional**, not ignored: a valid credential is still
  verified and attributed for logging; an invalid one is ignored, not
  rejected.
- Only covers controllers. The framework's direct routes (`/docs`, `/_mint`)
  self-gate.
- `grep @Public` enumerates every unauthenticated route.

## `@Roles()` — role-gated

`@Roles("admin")` limits a controller/handler to callers holding at least one
listed role. **Implies authentication** (overrides `@Public`): no credential
→ 401; valid credential without the role → 403. Method-level overrides
class-level. Trusted origins bypass it like all auth (`TRUST_LOCALHOST=false`
to enforce locally).

**Roles are namespaced `appName:role`** (`billing:admin`). The guard scopes
to its own app: `@Roles("admin")` on the `billing` app matches `billing:admin`
and ignores `orders:*`. Roles ride in the credential:

- Firebase: custom claims via the Admin SDK —
  `admin.auth().setCustomUserClaims(uid, { roles: ["billing:admin"] })`
  (applies when the client's ID token refreshes).
- Signed tokens: `signToken({ …, roles: ["billing:admin"] }, key)`.

Read the caller in a handler: `getIdentity(ctx)` → `{ source, roles }`
(roles scoped/bare for this app).

## Docs access (browser flow)

Doc *pages* load publicly; the OpenAPI *spec* (`/docs/<module>/json`) is
gated. The pages use a query-param → `localStorage` flow:

1. Open any docs page with `?token=<signed token>` — an inline script stores
   it and strips it from the URL.
2. Swagger UI / the cake fetch the spec with
   `Authorization: Bearer <stored token>` — persists across same-origin
   navigation.
3. A 401 wipes the stored token and asks for a fresh `?token=…` link.

Share a `…/docs?token=…` link once (the `/_mint` result page generates it).
Works identically mounted under Fresh (`/api/docs/...`).

## Browser access to your own API (frontend token)

Same flow for `/api/*` calls the browser makes. Drop the fetch-wrapper
snippet from the README ("Browser access to your own API") into a client
entry: it seeds from `?token=`, auto-attaches `Authorization` on same-origin
`/api/*` requests, and clears the stored token on a 401. Use a **short-lived**
token in links (URLs leak via history/Referer); never seed a never-expiring
token this way. SSR should still use `ctx.state.api.fetch` (in-process — no
token at all). A runnable version lives in `examples/fresh-project`.

## Environment summary

| Var | Missing/blank → |
| --- | --------------- |
| `MANUAL_KEY` | warns once; minting fails closed, signed tokens can't verify |
| `FIREBASE_PROJECT_ID` | warns once; Firebase path off |
| `TRUST_LOCALHOST` | defaults `true`; `false` requires tokens even from localhost |

If **neither** `MANUAL_KEY` nor `FIREBASE_PROJECT_ID` is set, no network
request can authorize (localhost/in-process still work). In tests, set
`MANUAL_KEY=k` (any value) to silence the warning.
