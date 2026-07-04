# keep: capture name + email from infra at session intake, and expose `/auth/me`

**Component:** `keep/src/foundation/domain/business/session-store/mod.ts` (`intakeSession`) +
`bootstrap-server/mod.ts` (the gateway surface).

**Part of the single-path auth chain** (identity flows infra → keep → sprig):
- `infra/main/feedback/user-profile-in-exchange/` — infra returns `{name, email}` on exchange/login.
- **this doc (keep)** — cache that at intake + expose it to the client via `/auth/me`.
- `tooling/sprig/feedback/auth-client-surface/` — `getUserData()` reads `/auth/me`.

Because the client is now cookie-based and **never sees the bearer**, the only way `getUserData()`
gets `{name, email}` is a keep endpoint that reads them off the session. keep already caches these
fields — it just isn't populating them with a real identity, and there's no read endpoint.

## Current state (evidence)

`intakeSession` (`session-store/mod.ts`) populates the session record's profile from the **bearer's
`creator`**, not from a real name/email:

```ts
const id = await store.create({
  …,
  email,                       // = input.email ?? (creator has '@' ? creator : undefined)
  name: decoded?.creator,      // ← the bearer's `creator` (e.g. "mrg-keystone~alfred"), not a name
  …
});
```

For a machine-token session that yields `name = "mrg-keystone~alfred"` and `email = undefined` — not
a usable profile. And there is **no `/auth/me`** (or `bootstrapServer` method) to read it back.

## Asks (depends on the infra change above landing first)

1. **Capture real `name` + `email` at intake.** Once `authz.exchange` / `session.login` return the
   profile (infra doc), read `{name, email}` from the infra response in `intakeSession` and store
   them on the `SessionRecord` (the fields already exist) — instead of `name = decoded.creator`.
2. **Expose `/auth/me`.** Add a `bootstrapServer` method (surfaced by sprig's `serveSprig` gateway as
   `GET /auth/me`) that resolves the `sprig_session` cookie → session → returns
   **`{ name, email, grants }`**. Return **401/`null`** when there's no session. The `grants` are
   **already on the session record** (from the verified bearer's `claims`, cached at intake), so this
   is a read, not new state. **`grants` here are UX-only, not a trust boundary** — the guard still
   enforces them deny-by-default from the *verified* bearer on every request; `/auth/me` just lets
   the UI render the right controls. A client that lies about its grants only fools its own UI, and
   every gated call still 403s server-side.

## Why here

`intakeSession` and the session record are keep-internal; the cookie→session resolution already
lives in `token-auth`. Reading the profile back out is a small addition on the same surface sprig's
gateway already calls (`intakeSession` / `destroySession`). Additive and behind the existing
`KEEP_SESSION_KV` opt-in.

---

## Resolution — landed on the keep side (both asks)

Both asks shipped; additive and behind the same `KEEP_SESSION_KV` opt-in. keep is now
**forward-compatible** with the infra change — it reads the real profile *when infra sends it* and
falls back to today's behavior when it doesn't, so this side can land ahead of (or alongside) infra.

- **(1) Capture the real `name` + `email` at intake.** infra's exchange/login envelope now carries
  the user's real profile alongside the bearer, and keep captures it:
  - `infra-client/mod.ts` — new `AuthExchange` envelope (`{ token, name?, email? }`) and two
    profile-returning calls, `exchangeProfile(token)` / `loginProfile(idToken, email?)`, that read
    `{ name, email }` off the exchange response (tolerating a flat envelope OR a nested `user` object;
    empty/non-string values collapse to `undefined`). The bearer-only `exchange` / `login` stay for
    silent refresh (the bearer alone suffices there).
  - `session-store/mod.ts` — `intakeSession` now calls `exchangeProfile` / `loginProfile` and
    **prefers infra's real `{ name, email }`**, falling back to the caller-supplied email, an
    email-shaped `creator`, and finally the bearer's `creator` for the name — so a machine session
    like `mrg-keystone~alfred` still resolves, but a real user gets a real profile. `SessionExchange`
    is the profile-returning slice; `IntakeResult` now also returns `name`.
- **(2) Expose `/auth/me`.** New `BootstrapServer.sessionProfile(cookieHeader)` — resolves the
  `sprig_session` cookie (`readCookie` + `SESSION_COOKIE_NAME`) → session → returns
  **`{ name, email, grants }`**, or **`null`** when the cookie is absent / the session is gone / the
  store is off (the gateway maps `null` → 401). Silent refresh runs on this read too, so a
  long-lived tab keeps a fresh session. `grants` are **UX-only** (documented on the exported
  `SessionProfile` type): the guard still enforces them deny-by-default from the *verified* bearer on
  every request, so a faked grant only fools the client's own UI.

New exports on `@mrg-keystone/rune`: `AuthExchange`, `ExchangeEnvelope`, `SessionProfile`
(`IntakeResult` gains `name`, `SessionExchange` now uses the profile calls).

**Verified:** full keep suite green (`deno test -A --unstable-raw-imports --unstable-kv` → 391
passed, +4 new), `deno lint` clean, `deno check` clean, `deno publish --dry-run` clean. New coverage:
infra-client `exchangeProfile`/`loginProfile` (flat + nested `user` + token-only fallback) and
`intakeSession` preferring infra's real name/email over the bearer's `creator`.

> Still owed by **infra** (`infra/main/feedback/user-profile-in-exchange/`): actually returning
> `{ name, email }` on `authz.exchange` / `session.login`. Until it does, keep cleanly falls back to
> the `creator` — no breakage either way. And by **sprig**
> (`tooling/sprig/feedback/auth-client-surface/`): the `GET /auth/me` gateway route calling
> `keep.sessionProfile(req cookie)` and `getUserData()` reading it.
