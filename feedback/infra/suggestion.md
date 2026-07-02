# Suggested fixes

Ordered by value. Issues 1 and 2 are the ones that break the build loop; 3 is the security-relevant one and (usefully) the same root cause as a class of guard bugs. All three share a theme: **`rune sync` should never emit a tree that fails `deno check`, and should never silently owe the human hand-work it can't do.**

---

## Fix 1 — pass every declared arg on write seams (codegen)

**Root cause:** the call-site emitter, for a `kv:noun.verb(a, b, …)` step, emits only the DTO argument when the step mixes a leading scalar (`roleId`) with a core-produced DTO (`out.set`). The adapter emitter, reading the *same* step, correctly emits the 2-arg signature. The two emitters disagree on the same spec line.

**Fix:** the call-site emitter should bind **every** parameter the step declares, in order, from the same name-resolution table the adapter signature is built from (scalar ids resolve to `validInput.<id>` or the core's minted `out.<id>`; the DTO resolves to the asserted core output). Concretely, for `kv:role.set(roleId, RoleDto)` emit:

```ts
await roleData.set(out.setId, assert(RoleDto, out.set, "role.set input"));
```

exactly as the hand-fix and the `token-mint` "DRIFT FIX" already do. Since one generator owns both sides of the seam, the invariant is cheap to enforce: **the argument count at the call site must equal the adapter signature's arity** — assert it at emit time and fail the sync loudly rather than shipping a `TS2554`.

**Regression guard:** the repro's Issue-1 check (adapter is 2-arg ∧ call site is 1-arg) makes a good codegen unit test.

---

## Fix 2 — incremental sync must not silently owe create-once edits (design)

The create-once policy is right (hand-filled bodies must survive re-sync). The gap is that on the **existing-module-gains-material** path, sync generates callers of methods/fields/bindings it then refuses to write, and says nothing. Two options, not mutually exclusive; I'd ship **A** now and **B** as the real fix.

**A — a "hand-work owed" manifest (cheap, high value).** After an incremental sync, diff *what the generated callers reference* against *what the preserved create-once files expose*, and print the shortfall explicitly. e.g.:

```
create-once drift — these files must be hand-edited (sync preserved them):
  src/access/domain/data/audit/mod.ts        + 9 methods: roleDefined, roleRenamed, … tokenRoleUnassigned
  src/access/domain/data/role/mod.ts         + methods called by new coordinators: get, addGrant, removeGrant
  src/access/dto/member.ts, dto/token.ts     + field: roles?
  src/access/entrypoints/access/mod.ts       + 11 @Endpoint bindings: roleDefine … tokenUnassign  ← deno check CANNOT surface this
```

The last line matters most: missing `@Endpoint` bindings are **invisible to `deno check`** (nothing references them), so today they're found only by manual inspection. Sync is the only stage that knows they're owed.

**B — additively extend create-once files (the real fix).** Appending a new **throwing stub** method, a new optional DTO field, or a new `@Endpoint` binding **cannot clobber a hand-filled body** — it only adds a symbol the generated code already assumes exists. So sync could:
- append `async roleDefined(dto: RoleDto): Promise<void> { throw new Error("not implemented"); }` to the audit adapter (red-by-design, consistent with greenfield);
- append `roles?: string;` (with the standard decorator stack) to the DTO;
- append the `@Endpoint(...)`-decorated delegator to the controller.

This keeps the **"red by design ⇒ tree type-checks, bodies throw"** contract on the incremental path exactly as it holds on greenfield. Guardrail: only ever *append* to create-once files, never modify or reorder existing members; if a symbol already exists, leave it.

---

## Fix 3 — emit a guard slot before mid-recipe mutations (codegen + convention)

**Root cause:** the shell emitter classifies every `kv:` step as a "read" and stacks them above the `// core` marker. For a step that is a **mutation** (`addGrant`, `set`, `delete`, `assign`), that places an escalating write ahead of any guard.

**Fix (structural):** distinguish read vs. mutation kv steps in the recipe and emit a dedicated, empty **guard region** between the last read and the first mutation:

```ts
// reads — load inputs through the data adapters
const roleGet  = assert(RoleDto,  await roleData.get(validInput.roleId),  "role.get");
const grantGet = assert(GrantDto, await grantData.get(validInput.grantId), "grant.get");

// guards — authorize BEFORE any mutation (fill: assertAppAuthority + cross-app checks)

// writes — mutations run only after guards pass
const out = allowCore(validInput, roleGet, grantGet);
await roleData.addGrant(...);
```

Even just emitting the labeled `// guards — …` comment in the right position (between reads and the first mutation) removes the trap: the fill has an obvious slot, and the mutation is no longer physically above it. Heuristic for "which step is a mutation": the verb returns `void`/the mutated DTO **and** the noun is written elsewhere, or simplest — treat any `kv:` verb that isn't `get`/`list`/`assert*Exists` as a mutation. rune already knows enough to draw this line.

**Convention backstop:** the build playbook should keep writing a "writes nothing on 403" **state** assertion for every guarded mutation (re-read after the expected 403, assert unchanged) — that's what caught this in `infra`. A pure `assertRejects(...403)` is *not* enough; it can't tell a guard-before-write from a guard-after-write.

---

## Meta suggestion — a sync exit contract

Tie it together with one rule: **`rune sync` should be able to assert, before it returns 0, that the tree it just wrote passes `deno check`** (or explicitly enumerate the create-once hand-work that will make it pass). Today sync returns success and defers the discovery to a later `deno check` the human has to run and interpret. Fixes 1 and 2B make a clean tree achievable automatically; 2A makes the residual hand-work a printed checklist instead of a scavenger hunt. That single invariant — *sync never leaves a red `deno check` without telling you exactly why* — would have removed the entire "plumbing pass" from this build.
