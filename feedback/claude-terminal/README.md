# rune feedback — from the `claude-terminal` project

Bugs found while building a real rune backend (5 modules, incl. a `[ENT:ws]` WebSocket
module) for a cogasaur app. Each finding has a **detailed write-up** and a **hermetic,
self-contained repro** (builds a throwaway `rune init` project in a temp dir, runs it,
cleans up — needs only `rune` on PATH).

- Env: CLI `rune 2.0.0 (10dad48)`; runtime `@mrg-keystone/rune@2.0.1`; Deno on macOS.
- Run a repro: `bash <name>.sh`

## Open

| Bug | Repro | One-liner |
| --- | --- | --- |
| [`typ-file-pruned.md`](./typ-file-pruned.md) | [`typ-file-pruned.sh`](./typ-file-pruned.sh) | A plain re-`sync` **prunes** the disambiguated `dto/<typ>-type.ts` (for a `[TYP]` whose name collides with a same-stem `[DTO]`), then `rune lint` **requires** it → red. |
| [`stubs-lint-residual.md`](./stubs-lint-residual.md) | [`stubs-lint-residual.sh`](./stubs-lint-residual.sh) | `rune lint --strict` flags `bootstrap/stubs.ts`, the ghost-stub file `rune sync` itself **generates** (and `modules.ts` imports) for an unfulfilled `[TYP:ext]` input → `--strict` can't go green. |

**Shared root cause:** in both, **rune's generator emits a file rune's linter rejects** —
the two derive their "which files are legitimate" sets independently and disagree. A
single generated-files manifest that both `sync` and `lint` consult would close both.
Both are **minor** (the app is fully green); they're annoyance/CI-gate tier, not blockers.

## Already fixed (verified) — for context

These earlier findings from the same project were fixed and re-verified on the current
build; write-ups + repros are at the repo root (`../../feedback.md`,
`../../feedback-repro.sh`, `../../feedback-ws-repro.sh`):

1. **Mis-inferred project root reported as "undeclared service"** — fixed in the CLI
   (now: "no core.rune found under the resolved root — pass `--root`").
2. **WS BUG 1** — generated projects pinned `@mrg-keystone/rune@^1`, so a `[ENT:ws]`
   controller's `WsEndpoint`/`WsEndpointController` imports failed — fixed in the CLI
   (`rune init` now pins `@^2`).
3. **WS BUG 2** — `SwaggerBuilder` crashed building the OpenAPI doc for a
   `@WsEndpointController` (`trimSlash(undefined)`) — fixed in the runtime, published as
   `@mrg-keystone/rune@2.0.1`.
