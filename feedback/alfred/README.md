# alfred → keep/rune feedback: auth authorization is not fail-closed on the published version

_Recorded 2026-07-03, from the alfred in-flight board work._

## TL;DR

An endpoint with **no** auth decorator (no `@Public`, no `@Grant`/`@Roles`) is **authenticated-open** on the keep version alfred actually runs (`keep@1.22.0`, roles-based): **any** valid bearer authorizes it, and no grant/role is ever inspected. That is **not** fail-closed. The `tooling` source (grants-based) *is* fail-closed — an undecorated route there is closed to everyone but `*`. So the fail-closed guarantee the docs describe lives only in the unpublished/unresolved source; consumers on the published line silently get authenticated-open.

We hit this while wiring the in-flight board: a token whose only grant is `in-flight` (not `*`) successfully called an undecorated `create-in-flight`, when the intended model would return `403`.

## Evidence

### 1. The version alfred resolves is the roles guard

- `server/deno.json` pins `"@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^3"`.
- `server/deno.lock` resolves **`@mrg-keystone/keep@1.22.0`** and **`@mrg-keystone/rune@1.23.0`**.
- A `^3` constraint cannot semver-resolve to `1.23.0` — so the lock is **stale/mismatched** relative to the pin. Net effect: the running code is `keep@1.22.0`.
- `keep@1.22.0`'s credential guard (`.../keep/1.22.0/src/foundation/domain/business/token-auth/mod.ts`, from the jsr cache) is **roles-based**: `requiredRoles` present (2 refs), zero grants-model symbols (`requiredGrants`/`grantsForApp`/`honorSkeleton`).

**Feedback:** a consumer intending `rune@^3` (grants keep) can end up pinned to `keep@1.22.0` (roles keep) through a stale lock, with **no error** — the auth model silently differs from the docs. Worth a `check:keep-lockstep`-style guard on the *consumer* side, or making `rune@^3` fail loudly if it drags in a roles-era keep.

### 2. The two guards diverge exactly on the "no decorator" case

Roles guard (`keep@1.22.0`, **running**) — no authorization tail when no roles are declared:

```ts
if (!identity) { if (roles.length > 0 || !isPublic) throw 401; return true; } // authn gate
if (roles.length > 0 && !roles.some(r => identity.roles.includes(r))) throw 403; // authz gate
return true; // roles == [] falls straight here → authenticated-open
```

Grants guard (`tooling/rune/keep/src/foundation/domain/business/token-auth/mod.ts`, **source**) — fail-closed:

```ts
const hasConstraint = domains.length > 0 || requiredRaw.length > 0;
... enforce @LoggedIn / @Grant ...
if (hasConstraint) return true;
throw new ForbiddenException(); // nothing declared and not `*` → 403
```

Same request, opposite outcome for an undecorated route + a non-`*` token: **200** (roles) vs **403** (grants).

### 3. Live proof (running alfred, no change made to reach it)

The in-flight token, introspected at infra:

```
POST https://infra.mrg-keystone.deno.net/authz/exchange   {"token":"<FLIGHT_CONTROL_TOKEN>"}
→ 200
{ "creator":"mrg-keystone~alfred", "source":"in-flight-control",
  "claims":[{"key":"alfred","value":"in-flight"}], "sessionExpiry":"2026-07-04T00:00:24Z" }
```

So the token holds exactly one app-scoped grant: `claims["alfred"] = "in-flight"` — **not** `*`.

Against an undecorated `create-in-flight` on the running server:

```
POST /api/http/create-in-flight   (Authorization: Bearer <in-flight token>)
→ 200   { "id":"if_…", "name":"…", … }        # created
POST /api/http/create-in-flight   (no bearer)
→ 401                                          # authn gate does fire
```

The `200` is only reachable on the roles guard. The grants guard would have returned `403` for this exact request (token is not `*`, route declares no grant). **The successful create is therefore both the symptom (authenticated-open) and the proof of which version is live.**

### 4. Minted grants are inert until an endpoint names them

Because no endpoint declares `@Grant("in-flight")` / `@Roles("in-flight")`, `requiredGrants`/`requiredRoles` is `[]` everywhere, and the `in-flight` grant is compared to nothing. Grants can be freely minted on infra prod and have **zero** backend effect — an easy trap: it *looks* like access control exists (a scoped token was issued) while every gated endpoint is really "any authenticated caller."

## Why this matters

- The gap is **authorization**, not authentication — easy to miss in testing, because a token *is* required (401 without one), so it feels gated. It only surfaces when a *wrong-scope* token is (incorrectly) accepted.
- "Deny-by-default / fail-closed" is stated in the guard docs, but on the published roles line it holds only for authentication, not authorization of undecorated routes.

## Suggestions

1. **Make the fail-closed authorization tail the published behavior** (ship the grants guard), and treat the upgrade as a documented behavior change: undecorated non-`@Public` routes flip from authenticated-open → `403`-unless-`*`.
2. **Loud version lockstep on the consumer side**: `rune@^3` should not silently resolve to a roles-era `keep@1.22.0`; a mismatched lock like alfred's (`rune@^3` pinned, `keep@1.22.0`/`rune@1.23.0` locked) should be catchable.
3. **A lint / boot warning** listing controller routes that are neither `@Public` nor `@Grant`/`@Roles` — i.e. "authenticated-open" (roles) or "closed-unless-`*`" (grants) — so a bare route is a conscious choice, not an accident. This would have surfaced `create-in-flight` immediately.

## Notes / unverified

- Whether a grants-based `keep`/`rune@3` is actually **published** on jsr (vs source-only) wasn't confirmed here — alfred's lock never resolved past `keep@1.22.0`. If the grants line is unpublished, suggestion (1) is really "publish it."
- Separately observed (likely app-side, not keep): after 3 successful `create-in-flight`, a `list-in-flight` on the same dev process returned `inFlightCalls: null` once — noted for the alfred adapter, not filed against keep.

## Resolution (2026-07-03)

Applied in this repo (`tooling/rune`, keep `3.0.0`):

1. **Fail-closed authorization is already the shipped behavior.** `keep@3.0.0`'s guard
   (`keep/src/foundation/domain/business/token-auth/mod.ts` → `createCredentialGuard`) is the
   grants guard, not the roles guard: an undecorated non-`@Public` route falls through to
   `throw new ForbiddenException()` unless the caller holds `*` (lines ~184–196). The 3.0.0 bump
   was made breaking precisely for this flip (`release(keep)!: 3.0.0`). So suggestion (1) is done
   on the published `@^3` line — alfred's `200` came from a **stale lock** resolving `keep@1.22.0`
   (roles-era), not from rune shipping the roles guard. Root cause = consumer lock drift.

2. **Boot audit for bare routes (suggestion 3) — implemented.** New module
   `keep/src/foundation/domain/business/route-audit/mod.ts` (`auditRoutes` / `openRoutes` /
   `warnOpenRoutes`, exported from the package root) enumerates every HTTP controller route and
   classifies its posture (`public` / `grant` / `loggedin` / `grant+loggedin` / `open`). It
   reuses the guard's OWN metadata readers (`isPublicContext`, `requiredGrants`,
   `requiredDomains`) so the classification matches enforcement exactly. `bootstrapServer` runs it
   at boot (after the guard registers) and emits ONE aggregate warning naming each `open` route —
   e.g. `POST /things/create (ThingsController.create)` — with wording that flips under
   `honorSkeleton:false` ("reachable by no caller"). On by default; `KEEP_ROUTE_AUDIT=off`
   silences it. **This would have surfaced `create-in-flight` at boot.** Covered by
   `route-audit/test.ts` (6 tests) and confirmed live in the bootstrap int-test output.

3. **Consumer-side version lockstep (suggestion 2) — root cause is consumer lock drift, not a
   rune/keep defect.** The internal decorator-stack lockstep already exists
   (`scripts/check-keep-lockstep.ts`). The *consumer* case alfred hit — `rune@^3` pinned but
   `deno.lock` frozen at `keep@1.22.0`/`rune@1.23.0` — is a stale lockfile in the consumer repo;
   the fix there is `deno cache --reload` / `deno install` to re-resolve the lock against the `^3`
   pin. Not reproduced or changed here (it lives in alfred's repo), but recorded so it isn't
   mistaken for a rune bug. Whether a grants-line `keep`/`rune@3` is published on jsr was the open
   question in the note above; keep is at `3.0.0` in this repo and the guard is the grants guard.
