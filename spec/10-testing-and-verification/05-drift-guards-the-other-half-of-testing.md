## Drift guards (the other half of "testing")

| Guard | Task | Regen/mode | In `verify`? | Keeps honest |
| --- | --- | --- | --- | --- |
| `scripts/check-keep-lockstep.ts` | `check:lockstep` | check-only | yes | rune-emitted decorator-stack ranges == keep's (the single-copy invariant) |
| `scripts/sync-spec-skill-refs.ts --check` | `check:spec-refs` | dual-mode (sync: `sync:spec-refs`) | yes | rune:spec's bundled references == `lang/docs/` + `examples/todos/` |
| `scripts/sync-agent-guardrail.ts --check` | `check:agent-guardrail` | dual-mode (sync: `sync:agent-guardrail`) | yes | every agent carries the current guardrail block |
| `keep/scripts/check-jsr-deps.ts` | `check:keep-jsr` (root alias for keep's own `check:jsr`) | check-only | no — publish preflight only | JSR subpath exports valid across all matching versions |

Three of the four run inside `deno task verify` (ladder ordering: see
01-the-verify-ladder); `check:keep-jsr` stands apart, invoked only as a publish
preflight. A green `verify` therefore says nothing about JSR subpath exports — a
broken subpath export can ship past it unless `check:keep-jsr` is run separately.

`check:keep-jsr` and `check:jsr` are two names for the same guard at two call
sites, not two guards: `check:jsr` is keep's own `deno.json` task wrapping
`keep/scripts/check-jsr-deps.ts`, run from `keep/` (see
[06-runtime/07-package-hygiene.md](../06-runtime/07-package-hygiene.md)'s task
table); `check:keep-jsr` is the workspace-root `deno.json` task that invokes it
from the repo root, the same `test` → `test:keep` pattern this workspace uses
elsewhere — a one-line wrapper task, `cd keep && deno task check:jsr`, so the
script and its logic stay single-sourced in keep/deno.json. This document,
describing the root's drift guards, always means the root alias when it says
`check:keep-jsr`.

These four are the complete set of standalone drift guards. Byte-for-byte grammar
and syntax-highlight drift is *not* a fifth one: it's `verify.ts`'s own Drift gate,
owned by 01-the-verify-ladder and 08-language-tooling/02.

The Regen/mode column's two shapes are the same distinction: `check:spec-refs` and
`check:agent-guardrail` are each one script in two modes — with `--check` it
verifies only (the gate); run bare — `deno task sync:spec-refs` /
`sync:agent-guardrail` — it regenerates the derived file in place. The `check:` task
*is* that same script plus `--check`, so the fixer and the gate can never drift
apart. `check:lockstep` and `check:keep-jsr` are check-only: no sync twin, no regen
task.

Recovery follows the same split. A dual-mode guard failing is two steps: run its
sync twin (`deno task sync:spec-refs` or `sync:agent-guardrail`), then rerun the
`check:` task — green. A check-only guard failing has no regen task to lean on; fix
by hand and rerun: for `check:lockstep`, re-establish keep's decorator-stack ranges
to match rune's emitted ones; for `check:keep-jsr`, correct the JSR subpath exports
the check flagged.

`deno task hooks` (`git config core.hooksPath .githooks`) points git at a
repo-tracked hooks directory not present in the tree: a no-op today, a latent
defect if trusted — guards fire only by hand (see Known state).

