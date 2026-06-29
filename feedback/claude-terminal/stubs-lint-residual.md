# rune bug — `lint --strict` flags `bootstrap/stubs.ts`, which `sync` itself generates

**Status: OPEN.** Reproduced on `rune 2.0.0 (10dad48)`, macOS.
**Severity: minor**, but it makes `rune lint --strict` (the CI gate) **impossible to pass
cleanly** for any project that has an unfulfilled `[TYP:ext]` input.
**Repro: `./stubs-lint-residual.sh`** (hermetic; builds a throwaway `rune init` project,
runs it, cleans up).

## Summary

When a module consumes a `[TYP:ext]` field that nothing in the project produces, `rune
sync` generates `bootstrap/stubs.ts` — the ghost-stub module that mints a placeholder so
dependent modules can run before their real producer exists — and wires it into the
(generated) `bootstrap/modules.ts`. Good.

The bug: `rune lint --strict` then flags `bootstrap/stubs.ts` with **"This file is not
allowed here"** (structure rule) and tells you to move it. But it's **generated and
imported by generated code** — you can't move it (the next `sync` regenerates it at
`bootstrap/stubs.ts`, and moving it breaks `modules.ts`'s import). So `rune lint
--strict` can never go green while a `[TYP:ext]` input is unfulfilled.

## Reproduce (verified output)

```
$ ./stubs-lint-residual.sh
rune: rune 2.0.0 (10dad48)

rune sync generated the ghost stub?  -> yes: bootstrap/stubs.ts
generated modules.ts imports it?     -> 3 import(s)

BUG — rune lint --strict flags rune's own generated file:
   bootstrap/stubs.ts
     • This file is not allowed here
     → Move bootstrap/stubs.ts to src/core/data/stubs/mod.ts
     • This file is not allowed here — parent folder is not in the spec
```

## Root cause (observed)

The structure linter's allow-list for `bootstrap/` recognizes `mod.ts`, `config.ts`, and
`modules.ts` (the generated registry) but **not `stubs.ts`** — even though `rune sync`
generates `stubs.ts` in exactly that folder and `modules.ts` imports it. The generator
and the linter disagree about which `bootstrap/` files are legitimate.

## Impact

`rune lint --strict` is the documented CI profile. Any project with an unproduced
`[TYP:ext]` input (a normal "develop against the ghost stub before the producer exists"
state — which rune itself encourages) carries a permanent `--strict` violation that can't
be resolved without disabling the feature. There's no clean workaround: deleting/moving
the file breaks the build and is undone on the next sync.

## Suggested fix

Have the structure linter **skip the generator-owned `bootstrap/stubs.ts`** the same way
it skips the generated `bootstrap/modules.ts` (the file is header-guarded / generated, so
the linter can recognize and exempt it). Then `--strict` is green for a project that's
legitimately developing against a ghost stub.

## Shared theme with the sibling bug

Both this and `typ-file-pruned.md` are the same class: **rune's generator emits a file
rune's linter rejects** (`lint` requires `<typ>-type.ts` that `sync` prunes; `lint`
rejects `bootstrap/stubs.ts` that `sync` generates). A shared "generated-files manifest"
that both `sync` and `lint` consult would close both.
