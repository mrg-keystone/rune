# todos — a rune example app (3 modules)

A small todo app generated entirely from `.rune` specs by `shape-checker`. Each
module is described by one module-level rune file; the engine scaffolds the
canonical layout, owns the typed contracts, and preserves the bodies you fill in.

## The three modules

| Module    | What it does                                  | Rune features shown                              |
|-----------|-----------------------------------------------|--------------------------------------------------|
| `tasks`   | create & complete todo items                  | pure feature + `db:` boundary + 2 `[REQ]`s       |
| `lists`   | create lists and add tasks to them            | pure feature + `db:` boundary                    |
| `notify`  | deliver a notification via email or push      | `[PLY]` polymorphism (`channel` → email/push) + `ex:` boundary |

Each module keeps its own spec at `src/<module>/<module>.rune` — the rune lives
with the code it generates. (shape-checker's structure rule allows a module-level
`.rune`; the `[MOD]` directive names the module its tree lands under.) Edit the
rune, re-run sync, and the tree below stays in lock-step.

## Generated layout (per module)

```
src/<module>/
  <module>.rune                     # the source of truth (you edit this) — lives in the module
  domain/
    coordinators/<verb>-<noun>/      # one per [REQ] — orchestrates the flow
      mod.ts        (you implement)  # imports its input/output DTOs
      int.test.ts   (you implement)
    business/<noun>/                 # pure logic
      sig.ts        (SPEC-OWNED ~)   # the contract — regenerated every run
      mod.ts        (you implement)  # your code — created once, never clobbered
      test.ts       (you implement)
    data/<noun>/                     # db:/ex: boundary adapters
      sig.ts        (SPEC-OWNED ~)
      mod.ts        (you implement)
      smk.test.ts   (you implement)
    business/<noun>/                 # a [PLY] noun (e.g. notify's `channel`)
      base/mod.ts   (SPEC-OWNED ~)   # abstract ChannelBase — the variant contract
      poly-mod.ts   (SPEC-OWNED ~)   # barrel → the active variant
      implementations/<variant>/     # one per [CSE] (email, push, …)
        mod.ts      (you implement)  # ChannelEmail extends ChannelBase
  dto/<name>.ts     (SPEC-OWNED ~)   # zod schemas + types, one per [DTO]/[TYP]
  mod-root.ts       (SPEC-OWNED ~)   # public API barrel
```

`~` files are **spec-owned**: regenerated in full from the rune on every sync.
The rest are **dev-owned**: scaffolded once with `throw new Error("not implemented")`
bodies and then yours forever. That split is the "perfect change" mechanism —
the contract (`sig.ts`) always matches the rune; the compiler flags any body that
no longer satisfies it.

## Regenerate

From the `shape-checker` repo root:

```sh
# scaffold / sync a module (idempotent; preserves your filled-in bodies)
deno run -A src/bootstrap/mod.ts sync example/todos/src/tasks/tasks.rune \
  --root example/todos --artifact rune/new/keywords.json

# preview without writing
… sync … --dry-run

# prune orphans the spec no longer declares.
#   spec-owned orphans (dto/, sigs) prune freely;
#   dev-owned orphans (your bodies) need --force.
… sync … --force
```

`--artifact rune/new/keywords.json` drives generation from the same registry the
Rune Studio edits: change a codegen template or a per-role lifecycle/prune policy
there and it flows straight into the output here.

## Verify

```sh
cd example/todos
deno check $(find src -name '*.ts')   # whole tree type-checks
deno test -A src/                     # scaffolded tests run (green stubs)
```

## What "filling in" looks like

Open any `domain/business/<noun>/sig.ts` — that abstract class is the contract the
rune declares. Implement its `mod.ts` against it; add a step to the rune and the
new method appears on `sig.ts`, and TypeScript tells you the body is missing.
Remove a step and `sync --force` prunes what the spec no longer declares.
