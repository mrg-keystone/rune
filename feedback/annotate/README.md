# Feedback: native (in-process) boundaries have no honest transport

**From:** extracting a standalone `annotate` tool into a rune spec.
**rune:** filed against 2.0.0 · **Type:** language proposal (new `[SRV]` transport) · **Severity:** papercut

> ✅ **RESOLVED in rune 2.0.4** (released Jun 29, 2026). `NATIVE` is now an accepted `[SRV]`
> transport: `repro/cases/native-attempt.rune` checks clean (exit 0), and `(NATIVE)fs:` with no
> env var is accepted. Kept here as the record of the request + repro.

## The short version

rune's `[SRV]` transport set is closed to `SDK / HTTP / WEBSOCKET / SIDECAR`. A boundary that is
just a **native, in-process runtime call** — `Deno.writeTextFile`, `Deno.Command`, `crypto` — has
no honest tag. Authors are pushed to label it `SIDECAR`, but "sidecar" means a *separate
co-located process*; an in-process call is not that. Ask: **add a `NATIVE` transport.**

## Proven, with a runnable repro

`rune check` on three one-line specs (see [`repro/`](./repro/), output captured in
[`repro/README.md`](./repro/README.md)):

| Case | `[SRV]` line | Result |
|------|--------------|--------|
| A | `(NATIVE)fs: GIT_ROOT` | **ERROR (exit 2):** `unknown transport "NATIVE" — expected SDK/HTTP/WEBSOCKET/SIDECAR` |
| B | `(SIDECAR)fs: GIT_ROOT` | OK — the semantic-misuse workaround |
| C | `(SIDECAR)fs:` (no env) | **OK** — env vars are already optional |

## What I got wrong, corrected by the repro

An earlier draft argued the motivation was a *mandatory env var* forcing fabricated tokens. **Case
C disproves that** — `(SIDECAR)fs:` with no env var checks clean. The env-var ergonomics are fine.
The real (narrower, honest) case for `NATIVE` is **semantic + fault/trust/codegen model**, not
ergonomics. Details and the open questions that decide whether it's substantive or
naming-only are in [`proposal.md`](./proposal.md).

## Contents

- [`proposal.md`](./proposal.md) — the full write-up: motivation, proposed grammar/semantics/
  codegen, alternatives, migration, and open questions for the maintainer.
- [`repro/`](./repro/) — self-contained `rune check` repro (3 cases) + captured output.
