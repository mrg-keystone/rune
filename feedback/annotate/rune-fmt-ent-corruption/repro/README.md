# Repro: `rune fmt` corrupts a `[ENT]` body-dispatch block

Self-contained. Needs only the `rune` CLI. Reproduced on **rune 2.0.6**; **fixed in rune 2.0.7**
(formatter now handles `[ENT]` — header at column 0, body `[REQ]`/ws-topics indented 4). On 2.0.7
the step-3 `rune check` below stays clean and the workaround is no longer needed.

`src/demo/demo.rune` is a minimal, `rune check`-clean module with one `[ENT]` dispatching to one
`[REQ]`. Running `rune fmt` inverts the block's indentation and breaks it.

## Run

```sh
cd repro
rune check src/demo/demo.rune --root .   # 1. clean
rune fmt   src/demo/demo.rune            # 2. format
rune check src/demo/demo.rune --root .   # 3. now FAILS
```

> Note: step 2 mutates `src/demo/demo.rune`. `git checkout`/restore it to re-run.

## Captured output (rune 2.0.6)

```
$ rune check src/demo/demo.rune --root .
src/demo/demo.rune: OK — no errors

# the [ENT] block as authored (correct, check-clean):
[ENT] http.getNote(RefDto): NoteDto
    [REQ] note.get(RefDto): NoteDto

$ rune fmt src/demo/demo.rune
Formatted src/demo/demo.rune

# the same block AFTER fmt — indentation INVERTED:
    [ENT] http.getNote(RefDto): NoteDto
[REQ] note.get(RefDto): NoteDto

$ rune check src/demo/demo.rune --root .
1 error(s) in src/demo/demo.rune:
  src/demo/demo.rune: [ENT] http.getNote(RefDto): NoteDto is ambiguous — 2 [REQ]s share
    that signature (note.get, note.get); give them distinct (input): output signatures
    so the delegation is unambiguous
```

## What happens

The canonical, `rune check`-clean form is `[ENT]` at **column 0** with the dispatched `[REQ]`
indented **4 spaces** beneath it (matching `spec.md` §`[ENT]` and the generated specs). `rune fmt`
rewrites it to `[ENT]` at **indent 4** and the body `[REQ]` at **column 0**. That dedented `[REQ]`
is now parsed as a second top-level declaration of `note.get`, so the `[ENT]` sees two `[REQ]`s
with its signature and reports "ambiguous".

## Expected

`rune fmt` should be idempotent on a `rune check`-clean file — formatting must never turn a
passing spec into a failing one. The authored indentation (`[ENT]` col 0 / body `[REQ]` indent 4)
is already canonical; `fmt` should leave it unchanged.

## Workaround

Do not run `rune fmt` on any spec that contains an `[ENT]` block until this is fixed (the
hand-authored form already passes `rune check`). Any pipeline step that auto-formats (e.g. a
`rune:build` re-sync) must skip `fmt` on such files or it will corrupt them.
