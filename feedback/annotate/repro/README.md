# Repro: no `NATIVE` transport for in-process boundaries

Self-contained. No deps beyond the `rune` CLI.

> ✅ **Resolved in rune 2.0.4:** `NATIVE` is now accepted, so `cases/native-attempt.rune` checks
> clean (exit 0) instead of erroring, and `(NATIVE)fs:` with no env var is accepted. The captured
> output below is the original `rune 2.0.0` run (the bug as filed); the "what each case shows"
> notes describe the pre-fix behavior and are kept as the record.

## Run

```sh
cd repro
for c in native-attempt sidecar-workaround sidecar-no-env; do
  echo "## rune check cases/$c.rune"
  rune check cases/$c.rune --root .
  echo "exit: $?"
done
```

## Captured output (rune 2.0.0)

```
## rune check cases/native-attempt.rune
1 error(s) in cases/native-attempt.rune:
  cases/native-attempt.rune:10: [SRV] unknown transport "NATIVE" — expected SDK/HTTP/WEBSOCKET/SIDECAR
exit: 2

## rune check cases/sidecar-workaround.rune
cases/sidecar-workaround.rune: OK — no errors
exit: 0

## rune check cases/sidecar-no-env.rune
cases/sidecar-no-env.rune: OK — no errors
exit: 0
```

## What each case shows

- **`cases/native-attempt.rune` (exit 2)** — the gap. A native, in-process filesystem boundary
  wants to declare itself `NATIVE`; the transport set is closed to `SDK/HTTP/WEBSOCKET/SIDECAR`,
  so `rune check` rejects it. There is no honest transport for an in-process runtime call.

- **`cases/sidecar-workaround.rune` (exit 0)** — the workaround authors use today: tag the native
  call `(SIDECAR)`. It passes, but a native `Deno.writeTextFile` call is not a co-located sidecar
  *process* — it is a category error, and the `GIT_ROOT` token here is never read by the native
  code.

- **`cases/sidecar-no-env.rune` (exit 0)** — proof that the **env-var list is already optional**:
  `(SIDECAR)fs:` with no env var passes. So the gap is **not** env-var ergonomics (that works
  fine) — it is purely the missing *semantics* of an in-process transport. (Verified at
  `rune check` only; `sync`/codegen not tested here.)

## The ask

Add a `NATIVE` transport so `cases/native-attempt.rune` checks clean and native in-process
boundaries stop having to masquerade as sidecars. Full write-up in
[`../proposal.md`](../proposal.md).
