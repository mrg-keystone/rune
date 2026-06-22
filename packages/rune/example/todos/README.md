# todos — a rune example app (3 modules)

A small todo app generated entirely from `.rune` specs by the `rune` toolchain.
Each module is described by one module-level rune file; the engine scaffolds the
canonical layout, owns the typed contracts (DTOs, barrels, `[PLY]` bases), and
preserves the bodies you fill in.

## The three modules

| Module    | What it does                                  | Rune features shown                              |
|-----------|-----------------------------------------------|--------------------------------------------------|
| `tasks`   | create & complete todo items                  | pure feature + `db:` boundary + 2 `[REQ]`s       |
| `lists`   | create lists and add tasks to them            | pure feature + `db:` boundary + `(s)` array DTO field |
| `notify`  | deliver a notification via email or push      | `[PLY]` polymorphism (`channel` → email/push) + `ex:` boundary |

Each module keeps its own spec at `src/<module>/<module>.rune` — the rune lives
with the code it generates. The `[MOD]` directive names the module its tree lands
under. Edit the rune, re-run `rune sync`, and the tree below stays in lock-step.

## Generated layout (per module)

```
src/<module>/
  <module>.rune                     # the source of truth (you edit this) — lives in the module
  domain/
    coordinators/<verb>-<noun>/      # one per [REQ] — orchestrates the flow
      mod.ts        (you implement)  # imperative shell + pure `<verb>Core`
      int.test.ts   (you implement)
    business/<noun>/                 # pure logic — a plain concrete class
      mod.ts        (you implement)  # your code — created once, never clobbered
      test.ts       (you implement)  # one stub per method
    data/<noun>/                     # db:/ex: boundary adapters — a concrete class
      mod.ts        (you implement)
      smk.test.ts   (you implement)
    business/<noun>/                 # a [PLY] noun (e.g. notify's `channel`)
      base/mod.ts   (SPEC-OWNED ~)   # abstract ChannelBase — the variant contract
      poly-mod.ts   (SPEC-OWNED ~)   # barrel → the active variant
      implementations/<variant>/     # one per [CSE] (email, push, …)
        mod.ts      (you implement)  # ChannelEmail extends ChannelBase
  dto/<name>.ts     (SPEC-OWNED ~)   # class-validator classes, one per [DTO]/[TYP]
  mod-root.ts       (SPEC-OWNED ~)   # public API barrel
```

`~` files are **spec-owned**: regenerated in full from the rune on every sync.
The rest are **dev-owned**: scaffolded once with `throw new Error("not implemented")`
bodies and then yours forever. Business features and data adapters are now **plain
concrete classes** — there is no `sig.ts`. Only a `[PLY]` noun gets an abstract
base (`base/mod.ts`) that its `[CSE]` variants extend.

## The loop

From the `rune` repo root (or with `rune` installed, drop the
`deno run -A src/bootstrap/mod.ts` prefix):

```sh
# 1. check the spec is valid — no codegen, just the parser + rules (exit 0 = clean)
deno run -A src/bootstrap/mod.ts check example/todos/src/tasks/tasks.rune

# 2. scaffold / sync the module (idempotent; preserves your filled-in bodies;
#    also writes example/todos/deno.json — the import map + decorator options)
deno run -A src/bootstrap/mod.ts sync example/todos/src/tasks/tasks.rune

# 3. prune orphans the spec no longer declares (dev-owned bodies need --force)
deno run -A src/bootstrap/mod.ts sync example/todos/src/tasks/tasks.rune --force
```

## Verify

```sh
cd example/todos
deno check src/**/*.ts                # whole tree type-checks
deno run -A ../../src/bootstrap/mod.ts lint .   # architecture lint → "All clear"
```

(With `rune` installed: `deno check src/**/*.ts && rune lint`.)

## What "filling in" looks like

Open any `domain/business/<noun>/mod.ts` — a concrete class stubbed with
`throw new Error("not implemented")`, one method per spec step. Implement the
bodies. The coordinator's `mod.ts` is an imperative shell that loads through the
data adapters, calls a pure `<verb>Core` (all business logic, no I/O), then
writes through the data adapters — fill in `<verb>Core`. Add a step to the rune
and re-sync; `deno check` shows you exactly what to reconcile. Because `mod.ts`
is create-once, a changed method does NOT auto-update an existing `mod.ts` —
reconcile by hand, or delete the file and re-sync for a fresh stub.
