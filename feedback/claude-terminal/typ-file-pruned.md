# rune bug — `sync` prunes the disambiguated `<typ>-type.ts`; `lint` then demands it

**Status: OPEN.** Reproduced on `rune 2.0.0 (10dad48)`, macOS.
**Severity: minor** (annoyance — a one-file hand-restore after every re-sync), but it's a
real, deterministic **`sync` ↔ `lint` contradiction**.
**Repro: `./typ-file-pruned.sh`** (hermetic; builds a throwaway `rune init` project, runs
it, cleans up).

## Summary

When a `[TYP]` name collides with a same-stem `[DTO]` (e.g. `[TYP] channel` and
`[DTO] ChannelDto`), `rune sync` disambiguates the type file: the DTO takes
`dto/channel.ts` and the type goes to `dto/channel-type.ts`. That's correct.

The bug: on the **second** `sync` of that module (a plain `rune sync`, **no `--force`**),
the prune step removes `dto/channel-type.ts` as an "orphan" — and then `rune lint`
(`rune-typ-shape`) reports it **missing** and fails. So one tool deletes the exact file
the other requires.

## Reproduce (verified output)

```
$ ./typ-file-pruned.sh
rune: rune 2.0.0 (10dad48)

after sync #1 — dto/ channel files:
   channel-type.ts          # the [TYP] channel, disambiguated
   channel.ts               # the ChannelDto
   lint missing-TYP complaints: 0   (0 = fine)

--- re-sync the SAME module (plain sync, NO --force) ---
   Pruned 1 orphan(s):
after sync #2 — dto/ channel files:
   channel.ts               # channel-type.ts is GONE

BUG — lint now demands the file sync just pruned:
   • Missing TYP file: src/widget/dto/channel-type.ts (for [TYP] channel at line 6)
```

## Root cause (observed)

`sync` writes `dto/<typ>-type.ts` for a collision-disambiguated type, but the **prune
path's "expected files" set doesn't include that disambiguated name** — so on the next
sync it's classified as an orphan and deleted. Meanwhile the **linter's "required files"
set DOES expect `<typ>-type.ts`**. The two filename derivations disagree:

- `rune sync` (prune) → thinks the type file is `dto/<typ>.ts`, treats `<typ>-type.ts` as orphan → deletes it.
- `rune lint` (`rune-typ-shape`) → requires `dto/<typ>-type.ts`.

(Prune is supposed to be opt-in via `--force`, but this deletion happens on a **plain
`rune sync`** — see the repro — so it bites silently on any normal edit→sync loop.)

## Impact

Any module with a `[TYP]`/`[DTO]` name collision breaks `rune lint` after its second
sync. We hit it twice in one project — `uid` (`UidDto`) and `channel` (`ChannelDto`) —
each time having to hand-restore the `<typ>-type.ts` file with the exact `renderTyp`
output to get lint green again.

## Suggested fix

Make the prune's expected-files set and the linter's required-files set share **one**
filename-derivation function for `[TYP]` files (including the same-stem-DTO
disambiguation to `<typ>-type.ts`). Then sync won't prune the file lint requires. (And
separately: a plain `rune sync` arguably shouldn't prune at all without `--force`, per
the documented "prune is opt-in" behavior.)
