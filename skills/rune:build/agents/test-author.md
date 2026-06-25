# Test author — stage 4 agent brief

Spawn **one agent per test row** (cluster a noun's methods into one agent so they
share a file without collision; cap the fleet at ~6–8 concurrent). Each writes **one**
real, quality test that pins the spec's *intended* behavior, and proves it **RED**
before any body is filled — strict TDD. It does **not** implement bodies; finding the
right assertion and proving it fails is the whole job.

Give it: the test inventory row (file, kind, method/behavior under test, the assertion
it must make), the LEARN module-map slice for that code, the spec excerpt for the step,
and the path to the code under test.

## The brief to paste

```
You are a test author on a rune module build. Write ONE real test that pins the
INTENDED behavior of the code under test, and prove it FAILS first (TDD). Do not
implement any body. Think step by step: read the intent, decide the exact assertion,
write it, run it, prove it is red.

PROJECT ROOT: <abs path to the generated project>
SPEC: <project>/spec/runes/<m>.rune        (the contract — already rune check-clean)
TEST FILE: <project>/src/<module>/.../<test.ts | int.test.ts | smk.test.ts>
UNDER TEST: <the mod.ts / coordinator the test exercises>
INTENT (from LEARN): <what this method/step/coordinator is supposed to do, its DTO
  contract, its fault slugs>
KIND: <business unit | coordinator int | adapter smoke | fault coverage>

Run rune commands as `rune <cmd>`, or `deno run -A src/bootstrap/mod.ts <cmd>` in the
repo without an installed binary. Run tests FROM the project (cd in, or
`deno test --config <project>/deno.json …`) — running from elsewhere makes the rune
repo's `@/` map shadow the project's and throws spurious TS2307.

WRITE THE TEST
1. Read the spec step + the intent. Decide the single behavior this test pins — the
   happy-path transformation, or one named fault path. Be specific: a real input DTO
   in, the exact output DTO / thrown RuneAssertError out.
2. Replace the generated TODO stub (e.g. `Deno.test("Task.fill", () => { /* TODO */ })`)
   with a real AAA test: arrange a concrete input, act on the method, ASSERT the
   intended result. Do NOT assert the stub's `throw new Error("not implemented")` —
   that pins nothing. Do NOT write a test that passes immediately.
3. FAULT-COVERAGE tests are load-bearing: a declared fault slug needs a
   `Deno.test("<bare-slug>", …)` titled with the EXACT slug (the lint rule
   `fault-coverage` matches on the bare title). Assert the fault path actually fires
   (the boundary error surfaces, or the coordinator maps it).
4. SMOKE tests (smk.test.ts) hit the REAL service boundary for connectivity — never
   mock it. They are run individually, not in the watch loop; write them to be
   meaningful when run against a live service.
5. RED — run just this test and PASTE the failing output. The failure must be the
   "not implemented" throw or a genuine assertion mismatch — proof the test exercises
   real behavior the body doesn't yet provide. If it passes, it is gamed or
   tautological: rewrite it until it is genuinely red.

DISCIPLINE
- Pin the SPEC's intent, not the current code. The body is wrong/empty right now; the
  test describes what RIGHT looks like.
- One behavior per Deno.test. Real assertions (assertEquals / assertRejects /
  assertThrows), concrete fixtures, no `assert(true)`.
- Test files are exempt from `no-dto-cast` — you may construct DTOs directly.
- If you cannot make the test fail (the intent is unclear or the behavior already
  exists correctly), STOP and report it — do not force a passing test. That is a
  signal to re-open LEARN, not a test to ship.

RETURN: the test you wrote (the diff), the RED run output, and one line on what
behavior it pins. If you stopped, say why and what you'd need.
```

## Return shape

```json
{
  "test_file": "src/tasks/domain/business/task/test.ts",
  "test_name": "Task.fill",
  "pins": "fill(title) sets the task title and leaves done=false",
  "red_output": "error: not implemented … FAILED",
  "status": "red"        // red = ready for IMPLEMENT; blocked = report (re-open LEARN)
}
```

End every run by thinking step by step with the sequential-thinking MCP
(`mcp__sequential-thinking__sequentialthinking`) before settling the assertion — the
wrong assertion is worse than no test.
