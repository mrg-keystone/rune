# keep: a server-side session store (Deno KV) — resolve auth from a cookie + silent refresh

**Component:** `keep/src/foundation/domain/business/token-auth/mod.ts` (request → identity),
`keep/src/foundation/domain/business/token/mod.ts` (offline bearer verification),
`keep/src/foundation/domain/business/tracer/kv-store.ts` (the Deno-KV precedent).

**Companion to:** `tooling/sprig/feedback/framework-auth/README.md` — the sprig-side write-up of the
single-path auth design. That doc owns the **client** surface (`authFetch` / `getUserData` /
`logout`, the login UI, the SSR guard) and the `/auth` gateway. This doc is the **server session
engine** half, which is rune/keep territory. **The single path only works if both ship** — please
land them together.

## The ask

Today keep is a **stateless verifier**: it takes a bearer off the request, verifies it offline, and
trusts the grants. That is correct and should stay. The missing half is a **stateful session
engine** that holds the *original credential* so the ~1h bearer can be re-minted transparently, and
that resolves auth from an **httpOnly cookie** instead of forcing the bearer into client-readable
storage. Four pieces:

- **(a)** a Deno-KV **session store** keyed by an opaque session id
- **(b)** resolve the request identity from the **`sprig_session` cookie**, not only `Authorization`
- **(c)** **infra exchange + silent refresh** from the stored original credential
- **(d)** per-session **TTL**

## What keep does today (verified against the code)

**keep never mints or signs — infra does; keep verifies offline against infra's JWKS.**
`token/mod.ts:4-13` — infra holds the Ed25519 key and emits the signed envelope at
`authz.exchange` (opaque token → bearer) or `session.login` (Firebase → bearer); keep verifies the
detached Ed25519 signature **offline** against infra's published JWKS (`token/mod.ts:68-70`), with a
`kid`-forces-one-refresh cache (`:89-98`). So the "verify the signature, then trust the grants" half
the sprig doc references **already exists** — no change needed there.

**keep resolves the credential from the `Authorization` header or the `?token=` query — never a
cookie.** `token-auth/mod.ts:54-55` and again at `:142-143`:

```ts
const credential = bearer(c.req.header("authorization")) ?? c.req.query("token");
```

`bearer()` (`:346-350`) only matches `^Bearer\s+(.+)$`. There is **no cookie read** in the auth
path. This is exactly the gap the sprig doc calls out: once the bearer moves into an httpOnly cookie
(so XSS can't read it and it isn't bound by the ~4 KB cookie cap on a growing `claims` set), **keep
must be able to resolve identity from that cookie** — today it cannot.

**keep already depends on Deno KV, and already uses its native per-key TTL.**
`tracer/kv-store.ts` is a real `Deno.openKv`-backed store where **every key carries an `expireIn`
TTL so storage stays bounded without a sweeper** (`:6`, `:41`, `:56` `DEFAULT_TTL_DAYS`, `:124-130`).
So a session store adds **no new infra dependency** and TTL is a solved primitive — the same
mechanism, pointed at `["session", <id>]`.

## Proposed shape

```
cookie:   sprig_session = <opaque session id>   (~32 bytes — never near the 4 KB cookie cap)
Deno KV:  ["session", <id>] → { credential, bearer, sessionExpiry, name, email, grants }
          (expireIn = idle-session TTL, same as tracer/kv-store.ts)
```

Flow — entirely server-side; the original credential and the bearer **never reach the browser**:

1. **Intake** — a `?token=` opaque token or a Firebase idToken arrives at the gateway. keep
   exchanges at infra (`authz.exchange` / `session.login`), mints a session id, writes
   `{ the ORIGINAL credential, the bearer, name, email, grants }` to `["session", id]` with an
   `expireIn` TTL, and sets the httpOnly `sprig_session` cookie.
2. **Every request** carries the cookie automatically → keep resolves `["session", id]`. If the
   ~1h bearer is near `sessionExpiry`, keep **silently re-exchanges from the stored credential**
   (one KV write) and continues — no 401, no client involvement, no re-login. Then it reads the
   grants exactly as it does today.
3. **logout** → delete `["session", id]` + clear the cookie (+ optional infra revoke).

## Why this belongs in keep, not sprig

- **(b)** and **(c)** require touching the auth resolution path (`token-auth/mod.ts`) and the infra
  client — keep-internal surfaces sprig cannot reach.
- **(d)** is already a keep primitive (`expireIn`), not a sprig one.
- It solves three sprig gaps at once: the **4 KB cookie limit** (id is tiny; grants grow unbounded),
  **silent refresh** (a long-lived wallboard/kiosk currently dies after ~1h on bearer expiry), and
  **off-client secrecy** (bearer + credential leave `localStorage` entirely).

## Split of ownership (mirror of the sprig doc)

- **sprig owns** the *client* surface (`authFetch` / `getUserData` / `logout`, login UI, SSR guard)
  and setting/clearing the cookie via the `serveSprig` gateway.
- **keep owns** the *server session engine*: the Deno-KV session store, resolving auth from the
  `sprig_session` **cookie** (extend `token-auth/mod.ts` beyond header + `?token=` query), the infra
  exchange + **silent refresh** from the stored credential, and per-session **TTL**.

## Backward compatibility

Additive. The header/`?token=` path (`token-auth/mod.ts:54-55`) stays as-is for machine tokens and
in-process calls; the cookie becomes a **third** credential source, tried when no `Authorization`
header and no `?token=` query are present. Stateless bearer verification is unchanged.

---

## Resolution — landed on the keep side (all four pieces)

All four asks (a)–(d) shipped; the header/`?token=` path is untouched and the whole feature is
**opt-in** (off unless `KEEP_SESSION_KV` is set), so existing apps see no behavior change.

- **(a) Deno-KV session store** — new module
  `keep/src/foundation/domain/business/session-store/mod.ts`. `["session", <id>]` → `SessionRecord`
  (the ORIGINAL credential + bearer + profile). Two backends behind one `SessionStore` interface:
  `KvSessionStore` (Deno KV, same locally-typed `--unstable-kv`-free gate as `tracer/kv-store.ts`)
  and `createMemorySessionStore` (single-instance fallback). `createKvSessionStore` confirms KV
  opened, else the boot path falls back to memory.
- **(b) Resolve from the `sprig_session` cookie** — `token-auth/mod.ts` now tries a **third**
  credential source after the header and `?token=` query, in BOTH `createTokenAuthMiddleware` and
  the runtime `createCredentialGuard`. The cookie carries only the opaque session id; it resolves
  to a bearer that flows through the SAME offline verification. New `readCookie` +
  `SESSION_COOKIE_NAME` + injected `cookieSession` resolver (keeps token-auth decoupled from the
  store).
- **(c) infra exchange + silent refresh** — `infra-client/mod.ts` gains `exchange(token)` and
  `login(idToken,email)` (`POST /api/authz/exchange` / `/api/session/login` → `{ token }`),
  mirroring the same-origin `serveSprig` `/auth/*` gateway. `resolveSession` silently re-exchanges a
  near-expiry **opaque** credential (one KV write) and continues; a firebase idToken can't be
  replayed once it lapses, so that session re-logs-in (documented). A failed re-exchange never
  throws — the stale bearer falls through and the request-path verification decides.
- **(d) Per-session TTL** — `expireIn` on every KV write (idle TTL, `KEEP_SESSION_TTL_DAYS`,
  default 7), the memory store mirrors it with a manual `expiresAt`.

**Gateway surface for sprig:** `BootstrapServer` exposes `.sessions`, `.intakeSession(input)`
(exchange → store → returns the opaque id + profile), and `.destroySession(id)`. sprig's
`serveSprig` gateway owns the `Set-Cookie`/clear; keep owns the exchange + store + silent refresh —
exactly the split this doc proposed. Wired in `bootstrap-server/mod.ts` behind `KEEP_SESSION_KV`.

New exports on `@mrg-keystone/rune`: `createKvSessionStore`, `createMemorySessionStore`,
`KvSessionStore`, `resolveSession`, `intakeSession`, `decodeBearer`, `sessionExpiryOf`,
`readCookie`, `SESSION_COOKIE_NAME`, `DEFAULT_REFRESH_SKEW_SECONDS`, and the `SessionStore` /
`SessionRecord` / `NewSession` / `IntakeInput` / `IntakeResult` / `SessionResolver` types.

**Verified:** full keep suite green (`deno test -A --unstable-raw-imports --unstable-kv` → 387
passed), `deno lint` clean, `deno publish --dry-run` clean. New coverage: infra-client
exchange/login, session-store create/read/write/destroy/resolve/refresh/intake (+ KV round-trip
under `--unstable-kv`), and token-auth cookie resolution in both the middleware and the guard.

> Still owed by **sprig** (companion `tooling/sprig/feedback/framework-auth/README.md`): the gateway
> routes calling `keep.intakeSession` and setting/clearing the httpOnly cookie, and the client
> `authFetch`/`getUserData`/`logout` surface. The single path only works once both ship.

## AUDIT (2026-07-04): keep's half confirmed done — sprig has NOT wired it

Verified this side is complete: `intakeSession` / `destroySession` are exposed on `bootstrapServer`,
the guard resolves the `sprig_session` cookie, `resolveSession` silently re-exchanges, `expireIn`
TTL is in place — nothing further is owed here. **But the seam is unused:** `grep -rn
"Set-Cookie.*sprig_session=" tooling/{sprig,rune}` finds no caller — `intakeSession` has **zero
callers**, and sprig's `/auth/*` gateway still returns the raw bearer while the sprig client stores
it in `localStorage` + a JS-readable cookie. So `sprig_session` currently holds the **whole bearer**
(sprig's write), not the **opaque id** this store expects — they can't interoperate until sprig
wires the gateway to `intakeSession` + the httpOnly id-cookie. Full call-to-action with the exact
diff is in the sprig doc's **"AUDIT (2026-07-04)"** section. Ball is entirely in sprig's court.
