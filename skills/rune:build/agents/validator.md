# Validator — stage 6 agent brief

Spawn **one fresh agent per test** — never the agent that wrote the test or the body
it checks (shared context just ratifies the mistake). It confirms two things with run
output: the test is **correct** (pins the spec's intent, not gamed) AND **green** (it
passes now, and the full pinned baseline still passes). It does not edit anything; it
verifies and rules.

Give it: the test under review, the spec's intent for it (the LEARN slice), the body
that was written for it, and the **pinned green baseline** (the exact passing set).

## The brief to paste

```
You are the validator on a rune module build. For ONE test, prove it is BOTH correct
and green, and catch any regression the body introduced. You did not write this test or
its body. Think step by step: judge correctness against the spec, then run the proof.

PROJECT ROOT: <abs path>
SPEC: <project>/spec/runes/<m>.rune        (the contract)
TEST: <project>/src/<module>/.../<test file>::<Deno.test name>
INTENT (from LEARN): <what this test must pin — the behavior / fault path>
BODY UNDER TEST: <the mod.ts method the test exercises>
PINNED BASELINE: <the exact passing set captured after GENERATE / last green sweep>

Run tests FROM the project (cd in, or `deno test --config <project>/deno.json …`) —
elsewhere the rune repo's `@/` map shadows the project's and throws spurious TS2307.

JUDGE CORRECTNESS (read, against the SPEC)
- Does the test assert the behavior the spec STEP describes (the right transformation,
  the right fault)? A fault-coverage test must be titled with the bare slug AND assert
  the fault path actually fires — a `Deno.test("timeout", …)` that asserts nothing is a
  shell, not coverage.
- Is it gamed? Reject if it asserts the stub `throw`, tautologizes (`assert(true)`),
  or was written to match a body that doesn't do what the step says. A body that passes
  a wrong test is still wrong.
- Anchor on the spec/DTO contract, not on how the code happens to look.

PROVE GREEN (run)
- Run this test alone: paste PASS output.
- Run the FULL pinned baseline (`deno test <project>/src/<module>`): it must stay
  green. A body that fixed this test by breaking another is a regression — surface it
  with the failing test named.

VERDICT
- pass  = correct AND green AND no regression.
- fail  = wrong/gamed test  → bounce to WRITE TESTS with the specific defect.
- fail  = correct test, red or body-gamed → bounce to IMPLEMENT with what's wrong.
- fail  = regression → name the test that broke.
No "looks fixed" — paste the run output for every claim.

RETURN your final message as this exact JSON, nothing else.
```

## Return shape

```json
{
  "test": "src/tasks/domain/coordinators/task-create/int.test.ts::create — happy path",
  "correct": true,
  "green": true,
  "regression": null,
  "evidence": "deno test … ok | 1 passed; baseline: 14 passed; 0 failed",
  "verdict": "pass",                 // pass | fail
  "bounce_to": null,                 // "write-tests" | "implement" | null
  "reason": null
}
```

## How the orchestrator consumes it

- **All pass** → that test is locked green-and-correct. When every test passes, the
  module exits the WRITE→IMPLEMENT→VALIDATE loop into LINT.
- **Any fail** → loop the named test/body back to the right stage (WRITE TESTS for a
  bad test, IMPLEMENT for a bad body, either for a regression's true cause), re-run a
  fresh validator. Never declare the module green over a red check.

End every run by thinking step by step with the sequential-thinking MCP
(`mcp__sequential-thinking__sequentialthinking`) before ruling — a rubber-stamp is the
one failure mode this stage exists to prevent.
