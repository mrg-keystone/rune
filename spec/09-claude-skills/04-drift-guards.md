## Drift guards

Two guards keep the Claude assets honest — what each one catches, and the
stakes if it's allowed to drift:

- `scripts/sync-spec-skill-refs.ts` — rune:spec's bundled `references/` must
  byte-match `lang/docs/` and `examples/todos/`. Those two trees are the
  source of truth for the DSL; the bundled copy is a **derived** artifact,
  never hand-edited — a sync run overwrites it. The stakes: rune:spec hands
  its bundled `references/` to the LLM as the DSL's ground truth, so drift
  here means the agent authors `.rune` specs against a stale language spec.
- `scripts/sync-agent-guardrail.ts` — every agent carries the current
  "Never crawl the filesystem" guardrail block (see
  [the agent fleet](02-the-agent-fleet-claude-agents.md)). The stakes: that
  block was born from a measured machine-pinning incident — unbounded
  `find`/filesystem scans that pinned load at 30+ — so an agent whose copy
  drifts out of sync can repeat that same failure.

A worked recovery loop, spec-refs side: edit `lang/docs/` → `deno task
verify` fails at `check:spec-refs` with a diff against the now-stale bundled
copy → `deno task sync:spec-refs` regenerates `references/` in place →
verify goes green. `check:agent-guardrail` / `sync:agent-guardrail` form the
same check/regen pair for the guardrail block.

For the full four-guard catalog, the `--check`/regen dual-mode mechanism,
and current hooks status, see
[10-testing-and-verification/05-drift-guards-the-other-half-of-testing.md](../10-testing-and-verification/05-drift-guards-the-other-half-of-testing.md).
For what `deno task verify` aggregates and how these `check:` tasks are
wired into it, see
[10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md).
