# Bug: `rune fmt` corrupts a `rune check`-clean `[ENT]` block

**From:** adding the HTTP `[ENT]` endpoint surface to the `annotate` module.
**Target:** the `rune` CLI — `rune fmt`.
**Type:** correctness regression (format breaks a passing spec) · **Severity:** sharp — silent corruption

> ✅ **RESOLVED in rune 2.0.7.** The Rust formatter (`lang/cli/src/commands/format.rs`) now knows
> `[ENT]`. Root cause: it had **no `[ENT]` branch at all** — the header (`[ENT] surface.action(...)`)
> matched the `is_step_line()` heuristic (it carries a `surface.action(...)` signature) and was
> indented to 4, while the body `[REQ]` fell through the generic `[REQ]` branch to column 0 —
> inverting the block. The fix adds an `[ENT]`/`[ENT:…]` header branch (column 0, **before**
> `is_step_line`) and an `in_ent` body-dispatch state — mirroring the existing `in_poly` handling —
> so the dispatched `[REQ]` (and `[ENT:ws]` topic lines) stay indented 4, while a *top-level* `[REQ]`
> after a blank (which the author left at column 0) is correctly left alone. Also fixes the
> `[ENT] … @ METHOD /tpl(...)` route-template and `[ENT:ws]` socket headers, which had the same flaw.
> Covered by 5 new `format.rs` unit tests (incl. an idempotency guard) and verified: the repro plus
> all 10 check-clean valid corpus specs now survive `rune fmt` with `rune check` still green. Kept as
> the record of the request + repro.

## The short version

`rune fmt` (2.0.6) **inverts the indentation** of a `[ENT]` body-dispatch block: it indents the
`[ENT]` header by 4 and dedents the body `[REQ]` to column 0. The dedented `[REQ]` is then parsed
as a duplicate top-level declaration, so the very next `rune check` fails with
*"[ENT] … is ambiguous — 2 [REQ]s share that signature"*. **Formatting turns a clean spec into a
broken one.**

## Proven, with a runnable repro

See [`repro/`](./repro/) (full captured output in [`repro/README.md`](./repro/README.md)):

```
rune check  → OK — no errors
rune fmt    → Formatted
rune check  → 1 error: [ENT] http.getNote(...) is ambiguous — 2 [REQs] share that signature (note.get, note.get)
```

Authored (clean) vs after `fmt`:

```
[ENT] http.getNote(RefDto): NoteDto          |     [ENT] http.getNote(RefDto): NoteDto
    [REQ] note.get(RefDto): NoteDto           | [REQ] note.get(RefDto): NoteDto
```

## Expected

`rune fmt` must be **idempotent on a `rune check`-clean file** — it must never turn a passing spec
into a failing one. The canonical form (`[ENT]` at column 0, dispatched `[REQ]` indented 4, per
`spec.md` §`[ENT]` and every generated spec) is already correct; `fmt` should leave it unchanged.

## Impact / workaround

Any auto-format step (e.g. a `rune:build` re-sync, an editor format-on-save, a CI `rune fmt --check`)
will **silently corrupt** any spec containing an `[ENT]`. Until fixed: do not run `rune fmt` on
specs with `[ENT]` blocks — the hand-authored indentation already passes `rune check`.

## Contents

- [`repro/`](./repro/) — minimal `[MOD] demo` with one `[ENT]→[REQ]`; run check → fmt → check.
