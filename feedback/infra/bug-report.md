# Bug: `rune sync` of a check-clean spec emits a tree that fails `deno check` (×2 causes) + a guard-position hazard

**Component:** `rune sync` codegen — rune **3.0.0** (`c3752cc`, released Jul 01 2026)
**Reported from:** `infra` (the access module's role-noun build, 2026-07-01→02)
**Environment:** deno 2.8.3 (aarch64-apple-darwin), macOS
**Severity:** blocks the module build loop — `deno check` fails ⇒ `deno test` cannot run a single test, so the red-by-design TDD loop can't start. Issue 3 is additionally **security-relevant** (invites an authorization-bypass fill).

---

## Summary

Adding a noun to an **existing green module** (`access.rune` gained `role` + `assignment`: 11 REQs, 11 DTOs) produced a scaffold with **11 TypeScript errors** — the canonical `INFRA_EXTERNALS=fake deno test -A` aborted at type-check with **zero tests executed**. Root causes, all reproduced hermetically on a fresh `rune init` project by `./repro.ts`:

| # | Issue | Error class | Verdict |
|---|-------|-------------|---------|
| 1 | Generated coordinator **drops the leading scalar arg** on multi-arg kv **write** seams; the same sync generates the adapter with the correct 2-arg signature | `TS2554: Expected 2 arguments, but got 1` | codegen bug (internal inconsistency) |
| 2 | **Incremental sync**: spec growth generates coordinators that **call methods sync refuses to write** into create-once files — with **no warning** | `TS2339: Property 'x' does not exist` | design gap (create-once model vs. incremental growth) |
| 3 | Allow/attach-shaped recipes emit the **mid-recipe kv mutation inside the reads block**, before any position where authority/cross-app guards can run | none (type-checks fine — that's the danger) | emission-order hazard |

The contract "red **by design**" should mean *bodies throw at runtime while the tree type-checks* — that's what lets a test fleet run red tests at all. Issues 1–2 put the tree outside that contract.

---

## Issue 1 — dropped leading scalar on multi-arg write seams

**Spec step** (`role.define`, identically `role.rename`):

```
kv:role.set(roleId, RoleDto): void
```

**What one and the same `rune sync` run emitted:**

```ts
// data adapter — CORRECT two-arg signature:
async set(roleId: string, roleDto: RoleDto): Promise<void> { ... }

// coordinator call site — ONE argument:
await roleData.set(assert(RoleDto, out.set, "role.set input"));
```

→ `TS2554: Expected 2 arguments, but got 1.` The generator produced both sides of the seam and they disagree.

**The precise shape:** it happens on **write** seams whose call combines a *leading scalar id* with a *DTO produced by the pure core* (`out.set`). Read seams are unaffected — e.g. the generated `roleData.addGrant(validInput.roleId, validInput.grantId)` got both args, because both come straight off the validated input DTO.

**Recurrence evidence (this is not new):** `infra`'s `token-mint/mod.ts` carries a hand-written fix from a *previous* build cycle:

```ts
// DRIFT FIX: token.set(tokenId, TokenDto) takes two args; pass the id too.
```

and the repo's build notes catalog it as "coordinators drop multi-arg seams — fix by hand." In this build it hit **2 of 2** eligible sites (`role-define`, `role-rename`).

---

## Issue 2 — silent create-once drift on incremental spec growth

`access`'s `audit` data adapter pre-existed (create-once: *"Edit the body. Re-running manifest will not overwrite this file."*). The spec grew nine new steps of the form:

```
log:audit.roleDefined(RoleDto): void     (…roleRenamed, roleDiscarded, roleGrantAllowed,
                                          roleGrantDenied, roleAssigned, roleUnassigned,
                                          tokenRoleAssigned, tokenRoleUnassigned)
```

Sync generated nine coordinators **calling** those methods, preserved `audit/mod.ts` untouched (correct per create-once), and **printed nothing about the gap** → 9 × `TS2339: Property 'roleDefined' does not exist on type 'Audit'`.

**This generalizes beyond audit.** The same incremental build silently left, in other create-once files:
- the **kv noun adapter itself** — the repro's phase-2 `widget.attach` calls `widgetData.get(...)` that phase-1's create-once `Widget` adapter never got (`TS2339: Property 'get' does not exist on type 'Widget'`);
- the **entrypoint controller** — all **11 new `[ENT]`s had no `@Endpoint` binding** (nothing references them, so even `deno check` can't surface this one — the endpoints are simply unreachable until someone notices);
- the **DTOs** — `MemberDto`/`TokenDto` gained `roles?` in the spec; the create-once `dto/member.ts`/`dto/token.ts` never got the field.

Sync's own closing hint — *"Next: run `deno check` to surface method-level drift."* — shows the drift is anticipated; the problem is that discovery is delegated to `deno check`, which (a) reports arity/absence but not the semantic hand-work list, and (b) is structurally blind to the missing `@Endpoint` bindings.

**Why greenfield never hits this:** on a first sync the adapter is freshly generated *with* every method (as a throwing stub). The gap exists only on the **existing-module-gains-a-noun** path.

---

## Issue 3 — mid-recipe kv mutation emitted in the reads block (security-relevant)

**Spec step** (`role.allow`; identically `role.deny`):

```
kv:role.get(roleId): RoleDto
  not-found
kv:grant.get(grantId): GrantDto
  not-found
kv:role.addGrant(roleId, grantId): RoleDto
  timeout
```

**Generated coordinator shape:** `addGrant` — a **privilege-granting mutation** — was emitted inside the `// reads — load inputs through the data adapters` block, *above* the `// core` marker. There is no position in the generated shell where the sibling pattern's guards (`assertAppAuthority`, the cross-app `forbidden(...)` escalation check — see `token-allow`) can run **before** the write; a naive body fill executes the mutation unconditionally, then 403s *after* the write has landed.

In `infra` this was caught only because the TDD fleet wrote a state-assertion test first (`"allow — cross-app grant is forbidden and writes nothing"` re-reads the role after the 403 and asserts `grantIds` unchanged), and the fill reordered by hand. In the repro: `.addPart(` at offset 1478 precedes `// core` at offset 1550.

The danger class: **authorization checked after the escalating write** — the exact bug class rune's guard conventions exist to prevent.

---

## Repro (self-contained)

```bash
deno run -A repro.ts        # or: deno task repro
```

The script scaffolds a **fresh `rune init` project** in a temp dir (never touches any real repo), writes a minimal two-phase `widgets` spec (phase 1: `widget.define` — the Issue-1 shape; phase 2 grows `widget.attach` — the Issue-2 and Issue-3 shapes), runs `rune check` (clean, both phases) → `rune sync` ×2 → `deno check`, then verdicts each issue from the generated source + captured sync output.

Verbatim result on rune 3.0.0 (`c3752cc`):

```
BUG 1 (dropped leading scalar on multi-arg write seam): REPRODUCED
  adapter signature two-arg: true
  generated call site      : widgetData.set(assert(WidgetDto, out.set, "widget.set input"))

BUG 2 (silent create-once drift on incremental growth): REPRODUCED
  coordinator calls audit.widgetPartAttached : true
  create-once audit adapter has the method   : false
  sync #2 warned about the missing method    : false

BUG 3 (mid-recipe kv mutation emitted in the reads block): REPRODUCED
  .addPart( at offset 1478, "// core" marker at offset 1550 → mutation PRECEDES the core/guard position

[verify] deno check errors (corroborating bugs 1+2):
  TS2339 [ERROR]: Property 'get' does not exist on type 'Widget'.
  TS2339 [ERROR]: Property 'addPart' does not exist on type 'Widget'.
  TS2339 [ERROR]: Property 'widgetPartAttached' does not exist on type 'Audit'.
  TS2554 [ERROR]: Expected 2 arguments, but got 1.
  Found 4 errors.

=== 3/3 issues reproduce ===
```

Exit code is `1` while any issue reproduces, `0` once all are fixed.

---

## Impact on the reporting build

- The scaffold left `deno check` with **11 errors** (9 × Issue 2 on audit, 2 × Issue 1) — the whole-repo test command produced **no test summary at all**, so a dedicated hand "plumbing pass" had to run before a single red test could execute.
- Issue 2's silent siblings (11 missing `@Endpoint` bindings, 2 missing DTO fields) had to be discovered and hand-added with no manifest of what was owed.
- Issue 3 required a hand reorder in `role-allow`/`role-deny` and is pinned by tests now — but only because the build process happened to write guard-ordering tests first.

Fix proposals in `./suggestion.md`.
