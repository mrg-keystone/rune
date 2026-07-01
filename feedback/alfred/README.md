> ## ✅ RESOLVED — 2026-07-01 (fixed in **infra**, per the "Preferred" option below)
>
> **Diagnosis confirmed with evidence, and the fix is infra-side — rune 3.0.0 is correct.**
> The proof: infra has TWO bearer-emit paths and they were inconsistent.
> - `session.login` → `mintBearer()` already hand-builds the wire envelope as
>   `{ …, claims: ClaimDtos, … }` — correct, and covered by `session-login/bearer.test.ts`
>   (`bearer.claims`).
> - `authz.exchange` → returned `SignedTokenDto` **directly**, whose rune-DSL field is
>   `ClaimDtos` (`[DTO] …: ClaimDto(s)` names the array after its type). So *only* the
>   exchange envelope leaked `ClaimDtos`. rune reads `claims` (the name the signer also
>   signs over), so exchanged bearers 401'd.
>
> **Fix (infra):** map the array to `claims` at the exchange wire boundary — exactly as
> `session.login` already does.
> - `server/src/authz/dto/signed-token.ts` — field `ClaimDtos` → `claims`.
> - `server/src/authz/domain/business/manual-token/mod.ts` — `assemble()` sets `claims`.
> - `server/src/authz/domain/coordinators/manual-token-exchange/int.test.ts` — reads
>   `signed.claims`; happy-path now asserts the on-wire shape has `claims` and **not**
>   `ClaimDtos`.
>
> No rune release, no alfred change — an infra redeploy unblocks alfred. The signed
> bytes were already `claims` on both sides, so signatures are unaffected.
>
> **End-to-end proof (both repos' REAL code):** infra's real `SignerService` signs a
> session; keep's real `createJwksVerifier().verify()` **accepts** the fixed `claims`
> envelope (grant `alfred=*` present) and **rejects** the old `ClaimDtos` envelope with
> the exact error below. infra authz+session suites: **105 passed, 0 failed**.
>
> Note 2 (auto-exchange of a raw opaque token) is a separate keep-side behavior and is
> not addressed by this fix — filed for awareness only, as the report states.

# Bug: rune 3.0.0 rejects every infra-issued session bearer (`ClaimDtos` vs `claims`)

**Component:** `@mrg-keystone/rune@3.0.0` — keep runtime, session-bearer verifier
(`src/foundation/domain/business/token/mod.ts`) ⇄ infra `/authz/exchange`
**Reported from:** `alfred` (a fused sprig UI + keep backend)
**Date:** 2026-07-01
**Severity:** **Blocker** — no network client can authenticate to a keep 3.0.0 service that uses
infra bearers. Every `/api/*` call carrying a *valid, freshly-issued* infra bearer returns **HTTP 401**.

---

## Summary

infra's `POST <INFRA_URL>/authz/exchange` returns a signed session-bearer envelope whose grants array
is named **`ClaimDtos`**. rune 3.0.0's verifier reads **`claims`**. The names differ, so rune's
`parseEnvelope()` throws

```
TokenError: Session bearer `claims` must be an array.
```

**before** any signature / expiry / grant check runs. keep maps that to `401 Unauthorized`. The same
divergence exists in the **signed payload** (`canonicalize()` signs over `claims`), so a field rename
alone is not sufficient unless infra *also* signs over `claims`.

`ClaimDtos` looks like a serializer emitting the DTO **type name** (`ClaimDto[]`) as the JSON key
instead of the wire name `claims`.

---

## Environment

- `@mrg-keystone/rune` **3.0.0** — confirmed via `deno info serve.ts` → `jsr:@mrg-keystone/rune@3.0.0`.
- infra: `https://infra.mrg-keystone.deno.net` (state as of 2026-07-01, *after* the app-token
  exchange fix — `/authz/exchange` now returns **200** for alfred's `DEV_TOKEN`).
- app: `alfred` — fused sprig UI + keep via `serveSprig`, `INFRA_URL` set, routes guarded by `@Grant`.

---

## Impact

| step | result |
|---|---|
| `POST /authz/exchange` with the opaque `DEV_TOKEN` | **200** — returns a signed bearer, `claims["alfred"] = "*"` (as `ClaimDtos`) |
| present that bearer to keep: `Authorization: Bearer <bearer>` | **401** on every guarded route |
| present the raw opaque token as `Bearer <token>` | **401** (see Note 2) |

Only the in-process (SSR `inject(Backend)`) channel authorizes. Operators and machine clients (e2e,
bot) cannot authenticate over `/api/*` at all.

---

## Reproduce

`./repro.ts` is standalone and zero-dependency. It vendors rune 3.0.0's **exact** `parseEnvelope` /
`canonicalize` (copied verbatim, with source line cites in the header — rune does not export them).

```bash
# offline & deterministic — uses the captured ./sample-bearer.json:
deno run -A repro.ts

# live — exchanges a real opaque token at INFRA_URL/authz/exchange:
ALFRED_DEV_TOKEN=<opaque infra token> deno run -A repro.ts
```

Actual output (live mode, abridged):

```
[live] POST https://infra.mrg-keystone.deno.net/authz/exchange -> 200

infra session-bearer envelope keys: ["creator","source","sessionExpiry","ClaimDtos","signature","kid"]
  has "claims"     (what rune reads)  -> false
  has "ClaimDtos"  (what infra emits) -> true

[1] rune 3.0.0 parseEnvelope(infra bearer):
    REJECTED -> TokenError: Session bearer `claims` must be an array.

[2] control — same envelope with ClaimDtos renamed to claims:
    parsed OK -> claims = [{"key":"alfred","value":"*"}]

[3] bytes rune signs/verifies over (canonicalize) — infra must sign THESE:
    {"creator":"mrg-keystone~alfred","source":"dev_token","sessionExpiry":"...","claims":[{"key":"alfred","value":"*"}]}
```

Exit code is `1` while the bug is present, `0` once the infra bearer parses.

---

## Expected vs. actual

- **Expected:** rune verifies the infra-signed bearer, reads `claims["alfred"]`, enforces the grant;
  a `*` claim opens the route.
- **Actual:** rune throws `Session bearer 'claims' must be an array.` at parse time → 401.

---

## Root cause — exact locations

`@mrg-keystone/rune@3.0.0/src/foundation/domain/business/token/mod.ts`
(<https://jsr.io/@mrg-keystone/rune/3.0.0/src/foundation/domain/business/token/mod.ts>)

**Parse (L220–222):**
```ts
const claims = o.claims;
if (!Array.isArray(claims)) {
  throw new TokenError("Session bearer `claims` must be an array.");
}
```
infra's envelope has no `claims` key (it has `ClaimDtos`) → `o.claims` is `undefined` → throw.

**Signed payload (L249–266) — `canonicalize()`:**
```ts
function canonicalize(env: BearerEnvelope): string {
  const claims = env.claims.map(...).sort(...);
  return JSON.stringify({ creator, source, sessionExpiry, claims });
}
```
with the header comment (L17–18):
> The canonicalization here MUST match infra's signer byte-for-byte (see infra
> `server/src/core/data/signer/mod.ts` `canonicalize`). Any change is a wire-format break.

So the contract rune 3.0.0 implements uses the key **`claims`** in *both* the envelope and the signed
bytes. infra's exchange emits **`ClaimDtos`**.

**Live envelope shape** (2026-07-01, signature redacted — see `./sample-bearer.json`):
```json
{ "creator": "mrg-keystone~alfred", "source": "dev_token",
  "sessionExpiry": "…", "ClaimDtos": [{ "key": "alfred", "value": "*" }],
  "signature": "…", "kid": "HSmt09oM-L-D9NX9" }
```

---

## Fix

Two layers must agree — the **envelope field name** *and* the **signed bytes**:

1. **Preferred — align infra to the published rune 3.0.0 contract:** emit the field as `claims`, and
   `canonicalize`/sign over `{ creator, source, sessionExpiry, claims }` (claims sorted by key). This
   is almost certainly a one-line serialization fix (the DTO is being serialized under its type name
   `ClaimDtos` instead of `claims`).
2. **Alternative — change rune** to read/verify `ClaimDtos`, then bump alfred to that build.

⚠️ Renaming **only** the field (while still signing over `ClaimDtos`) converts the failure from
`claims must be an array` into `signature does not verify` — both the field and the signed payload
must use `claims`.

---

## Note 2 — secondary (auto-exchange), likely same root cause

Presenting the **raw opaque token** (`Authorization: Bearer <uuid token>`) to keep 3.0.0 also 401s,
with no exchange attempt visible in the server log — i.e. keep did not broker the exchange for the
`infra tokens` UUID format (the client had to pre-exchange at `/authz/exchange`). If keep is meant to
auto-exchange opaque tokens ("alfred exchanges it once at `/authz/exchange`"), that path isn't firing
for this token shape. Filed for awareness only — the `ClaimDtos` mismatch above is the primary
blocker and would also break the auto-exchange path (the exchanged bearer still fails to parse).

---

## Not an alfred issue

alfred's wiring is correct: `INFRA_URL` is set, routes are `@Grant`-guarded, and clients present
`Authorization: Bearer`. The whole auth path lights up unchanged the moment a bearer parses — proven
by the `[2]` control in the repro (rename `ClaimDtos → claims` ⇒ parses ⇒ `claims["alfred"] = "*"`).

## Files

- `repro.ts` — runnable repro (sample + live), vendoring rune 3.0.0's exact parse logic.
- `sample-bearer.json` — real `/authz/exchange` response shape (signature redacted).
