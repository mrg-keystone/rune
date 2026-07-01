# Auth: the trust model, the infra bearer, grants, and docs access

Read this before changing anything auth-related in a keep app. The model is
**deny-by-default, infra-only trust**: keep itself mints nothing and calls no
per-request authority — it recognizes exactly two things, and denies everything
else.

## Who is trusted

| Caller | Recognized by | Credential |
| ------ | ------------- | ---------- |
| In-process (`backend.fetch` / SSR `inject(Backend)`) | a process-private key stamped on the request (`x-danet-internal`) | **No** — fully trusted |
| A network caller with an **infra-signed session bearer** | the bearer verifies **offline** against infra's published JWKS | **Yes** — the bearer |
| Anything else | neither of the above | **Denied** (401) |

The in-process key is minted at boot (`crypto.randomUUID()`), never leaves the
process, is redacted from logs, compared in constant time, regenerated every
boot. A network client cannot forge it. **A request from `127.0.0.1` with no
bearer is denied like any other** — keep grants no trust to localhost.

## The footgun and the safe mount

`backend.fetch(...)` is the trusted channel — anything dispatched through it
skips auth. Correct for *originating* your own calls (SSR, tests); a footgun if
you use it to **proxy inbound traffic** (external requests would be served
auth-exempt). **Never route inbound requests through `backend.fetch`.**

The safe path is safe by construction:

- `api.handler` **strips the in-process trust header** from every inbound
  request — no network request can impersonate an in-process call, however
  mounted or proxied.
- The OpenAPI spec (`/docs/<module>/json`) and the `/docs/_*` control plane are
  **gated to in-process OR an infra bearer carrying the `dev` grant** (see
  "Control plane & docs access") — a network caller without that grant can't
  read the API surface even if you mis-mount.

## How a caller gets a credential — all at INFRA, not keep

keep never mints or exchanges anything. A client obtains an infra-signed bearer
**at infra**, then presents it to keep:

- A **Firebase user** signs in at infra — `POST /session/login` (Google
  sign-in) — and infra returns an infra-signed session bearer carrying the
  user's per-app grants.
- An **opaque infra token** is exchanged at infra — `POST /authz/exchange`
  (public) — for an infra-signed session bearer with grants.

Either way the client presents that bearer to keep. keep only **verifies** it —
it never mints, exchanges, or calls infra per-request.

## The bearer and offline verification

The bearer is **not a JWT**. It is infra's Ed25519-signed envelope:

```ts
{ creator, source, sessionExpiry, claims: [{ key, value }], signature, kid }
```

where `signature` is a **detached Ed25519 signature** over a canonical
serialization of `{ creator, source, sessionExpiry, claims }` (claims sorted by
key). keep accepts the bearer as raw JSON **or** base64url(JSON) on the wire.

- `creator` — the identity the bearer authenticates as (a Firebase email, or a
  machine token's creator).
- `source` — a log-attribution label (tags every log line of the request).
- `claims` — the per-app grant map: each `key` is an app name, its `value` is
  that app's comma-separated grants.
- `sessionExpiry` — ISO-8601; the bearer is short-lived (~1h) and rejected once
  passed.
- `kid` — selects the infra signing key (lets infra rotate keys with zero
  downtime).

keep verifies **offline** against infra's JWKS — no shared secret, nothing to
leak:

- `GET <INFRA_URL>/authz/jwks` → `{ JwkKeyDtos: [{ kid, alg: "EdDSA", publicKey }] }`,
  fetched and cached (kid-selected; an unknown `kid` forces one refresh).
- `GET <INFRA_URL>/authz/status` → `{ revokeAll }`, **polled ~every 60s** as the
  global break-glass flag (see "Revoke-all").

**Config:** keep needs `INFRA_URL` (e.g. `https://infra.mrg-keystone.deno.net`)
to reach JWKS + status. With no `INFRA_URL`, session-bearer verification is off
and only in-process callers authorize.

## Presenting the credential

Send via `Authorization: Bearer <bearer>` (preferred) or `?token=<bearer>` (for
plain links / first navigations / WebSocket upgrades; redacted from request
logs — prefer the header where possible). A `[ENT:ws]` socket can't set an
`Authorization` header on the handshake, so its bearer rides `?token=` (bind it
with `[TYP:from=query]`) and is read **once at connect** — the credential guard
gates the handshake, and per-message frames inherit that decision.

## Authorization decorators

Authorization is a **global guard**, enforced **after** authentication and
**fail-closed**. `getIdentity(ctx)` → `{ creator, source, claims, grants }`
reads the resolved caller in a handler (`grants` = this app's grants).

- **`@Public()`** — open to anyone, no credential required. Class-level exempts
  every route on the controller; method-level exempts one. A valid bearer on a
  `@Public` route is still verified and attributed for logging; an invalid one
  is ignored, not rejected. `grep @Public` enumerates every unauthenticated
  route.
- **`@LoggedIn("monsterrg.com", …)`** — the caller's identity (`creator`, a
  Firebase email) must be under one of the listed email domains. A **machine
  token** (non-email creator) never satisfies `@LoggedIn`.
- **`@Grant("developer", …)`** — the caller must hold **at least one** of the
  listed grants (**any-of**), scoped to **this app** (a bare name `developer` is
  checked against the app's grants). The **dynamic** form `@Grant("::key")`
  looks up `key` in the request (path param → query → header → JSON body) and
  requires the **found value** to be a grant the caller holds (an absent key →
  deny).

Stacked decorators combine with **AND**: `@LoggedIn(...)` + `@Grant(...)`
requires both. A controller route with **neither** (and not `@Public`) is
**closed to everyone** but the `*` universal ("skeleton") grant.

> `@Grants` (plural) is a **deprecated alias** of `@Grant`, kept only so existing
> call sites keep working — teach `@Grant`/`@LoggedIn`/`@Public`.

## Grants

infra assigns **app-scoped grants**, namespaced `owner/repo:grant` (e.g.
`mrg-keystone/rune:admin`). In the verified bearer they arrive per app under the
`claims` map; keep checks **bare names** against **this app's** grants
(`claims[appName]`). `*` is the **skeleton key** — a caller holding `*` holds all
grants and opens every route (honored by default; infra's own control plane runs
with the skeleton disabled).

## Revoke-all — break glass

keep polls `GET <INFRA_URL>/authz/status` for `revokeAll`. When it flips **on**,
keep stops trusting **every cached session bearer** and rejects it (401) until
the client re-authenticates at infra. A cached bearer can't be live-checked
offline, so revoke-all is how an operator instantly invalidates all outstanding
bearers.

## Control plane & docs access

The framework's own **`/docs/_*` control surfaces** — `_run`, `_heal`,
`_traces`, `_fixtures`, `_scenarios` (and the docs `GET /docs/<module>/json`) —
are gated to **in-process OR an infra bearer whose app-grants include `dev` (or
`*`)**. There is **no localhost trust** on any of them.

Doc *pages* load publicly; only the OpenAPI *spec* (`/docs/<module>/json`) is
gated. The pages use a query-param → `localStorage` flow so a browser (which
can't set an `Authorization` header on a navigation) can still reach the gated
spec:

1. Open any docs page with `?token=<infra bearer>` — an inline script stores it
   and strips it from the URL.
2. Swagger UI / the cake fetch the spec with `Authorization: Bearer <stored
   bearer>` — persists across same-origin navigation.
3. A 401 wipes the stored bearer and asks for a fresh `?token=…` link.

So the docs bearer is an ordinary infra session bearer that happens to carry the
`dev` grant. It works identically when the keep is mounted under a sprig UI
(`/api/docs/...`).

## Browser access to your own API (frontend bearer)

Same flow for the `/api/*` calls a browser island makes: seed the infra bearer
from `?token=`, auto-attach `Authorization` on same-origin `/api/*` requests,
clear it on a 401. Use a **short-lived** bearer in links (URLs leak via
history/Referer) — infra bearers are already ~1h. SSR should still read data
through the in-process backend (`inject(Backend)` in a sprig page's `resolve.ts`
or a service — no bearer at all); this browser flow is only for the calls an
island makes over the network.

## Environment summary

| Var | Missing/blank → |
| --- | --------------- |
| `INFRA_URL` | warns once; session-bearer verification + revoke-all polling are off, so only in-process callers authorize |

keep needs **no signing secret, no Firebase project id, and no localhost-trust
flag** — it neither signs tokens, verifies Firebase ID tokens directly, nor
trusts localhost. keep is a pure offline verifier of infra-signed bearers;
`INFRA_URL` is the only auth config it needs.
