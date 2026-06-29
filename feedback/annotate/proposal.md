# Proposal: add a `NATIVE` transport to `[SRV]`

**Status:** ✅ shipped in rune 2.0.4 (filed as a proposal) · **Affects:** `[SRV]` grammar, `rune check`/lint, codegen, LSP, docs
**Origin:** extracting a standalone `annotate` tool. Self-contained repro in [`./repro/`](./repro/).
**Verified against:** `rune 2.0.0` (`rune check`). Codegen/`sync` behavior is posed as open
questions, not asserted.

## Summary

Add a fifth `[SRV]` transport, `NATIVE`, for **in-process runtime / std-lib boundaries**
(filesystem, subprocess, crypto, clock) that are neither reached over a network nor fronted by a
vendor SDK client. The transport set goes from `SDK | HTTP | WEBSOCKET | SIDECAR` to
`… | NATIVE`. Purely additive; no existing spec breaks.

## What the repro proves (and what it disproves)

Run the three cases (see [`repro/README.md`](./repro/README.md) for full captured output):

| Case | `[SRV]` line | `rune check` |
|------|--------------|--------------|
| A | `(NATIVE)fs: GIT_ROOT` | **ERROR (exit 2):** `[SRV] unknown transport "NATIVE" — expected SDK/HTTP/WEBSOCKET/SIDECAR` |
| B | `(SIDECAR)fs: GIT_ROOT` | OK (exit 0) |
| C | `(SIDECAR)fs:` *(no env var)* | **OK (exit 0)** |

- **A is the gap:** there is no transport that says "this boundary is a native, in-process call,"
  so native I/O has no honest home.
- **B is the workaround** authors actually use: tag the native call `SIDECAR`. It passes, but
  "sidecar" denotes a *separate co-located process* (Envoy, a log shipper, a local daemon over a
  socket) — a `Deno.writeTextFile` call is in-process and is none of that. Category error.
- **C is a correction to an earlier version of this proposal.** The env-var list is **already
  optional** — `(SIDECAR)fs:` with no env var passes `rune check`. So this proposal is **not**
  about env-var ergonomics; that problem does not exist. The case for `NATIVE` is purely
  **semantic + fault/trust/codegen model**. (Scope note: verified at `rune check`; whether
  `sync`/codegen needs an env var was not tested — see open questions.)

## Why a distinct tag, not just a rename

The honest, narrow case (no ergonomic hand-waving):

1. **Semantics.** "Sidecar" has an established meaning — a separate co-located process. Native
   in-process calls are not sidecars. A language should name what it means; today native I/O is
   forced to lie.
2. **Fault model.** A native call fails as a **synchronous throw** (`ENOENT`, disk full, a
   subprocess non-zero exit), not a connection "unreachable / timed out." If `SIDECAR` codegen
   wraps calls in connection/timeout-style fault handling, that is wrong for native calls.
   *(Open question — depends on codegen internals.)*
3. **Trust model.** A `NATIVE` service is in-process, fully trusted, and **never a network
   surface** — useful signal for the runtime's deny-by-default posture, distinct from "local but
   a separate process."
4. **Codegen.** No client construction, base URL, or connection lifecycle — methods wrap direct
   runtime calls. *(Open question — how much does `SIDECAR` codegen already assume?)*

**Honest verdict.** If `SIDECAR` codegen already treats local resources as plain in-process calls
with synchronous faults, `NATIVE` is mostly a **semantics + lint clarity** win — still worth it,
but not load-bearing. If `SIDECAR` imposes connection/process assumptions, `NATIVE` is a
**substantive** fix. Which one it is hinges on codegen internals only the maintainer can see — so
this proposal asks rather than asserts.

## Why it is a boundary at all

Pre-empting "make it an in-module step": native I/O is non-deterministic and fallible, crosses out
of the deterministic core, and deserves explicit faults + a generated, mockable adapter. It belongs
in `[SRV]` — it just is not a *sidecar*.

## Proposed change

### Grammar
- Extend the closed set to `SDK | HTTP | WEBSOCKET | SIDECAR | NATIVE`.
- Env-var list optional (already true for `SIDECAR` per case C; keep it so for `NATIVE`).
- `@docs <url>` stays required (point at the Deno / std API).

### Semantics
- `NATIVE` = in-process runtime/std-lib capability. No network, no co-located process, no
  connection lifecycle. Declared faults map to synchronous throws. Never a network surface.

### Codegen
- `<Name>Service` adapter at `src/core/data/<service>/mod.ts` as today, but with no client/
  connection scaffolding — methods wrap direct runtime calls; declared faults map to caught
  throws. If env vars are declared, read them as plain config (e.g. a root dir); if none, the
  adapter is config-free. Likely reuses most of the `SIDECAR` local generator.

### Lint / LSP / docs
- `rune check` accepts `NATIVE`. Add it to LSP completion/hover. Update the closed-set lines in
  the docs (`spec.md:127`, `spec.md:350`, `constraints.md:139`, `constraints.md:145`).

## Migration / back-compat
- Additive, non-breaking. `SIDECAR` keeps working; existing specs flip `SIDECAR → NATIVE` at
  leisure. *(Optional)* a lint hint suggesting `NATIVE` for `SIDECAR` services whose adapter only
  calls in-process APIs.

## Alternatives considered
1. **Do nothing.** Native I/O keeps lying about being a sidecar.
2. **Rely on "env optional" (case C) and keep `SIDECAR`.** The ergonomics are already fine — but
   the naming/fault/trust mismatch remains.
3. **Demote native I/O to in-module steps.** Loses faults, the adapter seam, testability.
4. **One broad `LOCAL` tag for sidecar + native.** Merges two genuinely different deployment
   models; the goal is to separate them.

## Open questions for the maintainer
1. Does `SIDECAR` codegen impose connection/timeout-style fault handling or a connection
   lifecycle that is wrong for in-process calls? (Determines whether `NATIVE` is substantive or
   mostly semantic.)
2. Does `rune sync`/codegen — as opposed to `rune check` — require an env var? (`check` does not;
   case C.)
3. Env vars on `NATIVE`: forbid (purist) or optional (a root dir / binary path is legitimately
   config)? Recommendation: optional.

## References (exact edit sites in the current docs)
- Closed-set declarations: `spec.md:127`, `spec.md:350`, `constraints.md:139`, `constraints.md:145`.
- `[SRV]` format + required `@docs`: `spec.md:126–134`, `constraints.md:131–152`.
- Adapter codegen location: `spec.md:122–124`.
- Transport examples for contrast: `(SIDECAR)db` `spec.md:119`; `(HTTP)ex` `spec.md:154`;
  `(SDK)os` `spec.md:92`.
