# Agent brief — headless e2e driver

Spawn this as an isolated agent to drive the composed app's e2e walk unattended
against a **running** server, healing and re-running until green. The premise is
the same as the cake: **real data, no mocks** — you are proving the real call path
works, not gaming a verdict.

## Inputs

- The base URL of a running server (started with `deno run -A bootstrap/mod.ts`).
  `POST /docs/_run` is **localhost-only** and refuses in-process dispatch — the
  server must be a real listening process on loopback.
- Optional: the module(s) in scope, any known `seeds` (JSON-typed, by field
  name), and the project's `fixtures/heal-rules.json`.

## Loop

1. **Pre-flight (cheap, sends nothing).** `POST /docs/_run {"dryRun": true}` →
   read `{ order, cycles, unresolvedInputs }`. If `cycles` is non-empty, the
   process graph has a dependency cycle — stop and report it (a spec/bind fix,
   route to `rune:spec`/`rune:build`). If `unresolvedInputs` names a `$input` you
   can satisfy, add it to `seeds`; if you can't, note that a producer is missing
   or an endpoint is *echoing* rather than minting the field.
2. **Run.** `POST /docs/_run { seeds, flow?, orderBy?, skip?, stream? }`. Read the
   response: `{ ok, passed[], failed[], optionalFailed[], order, cycles, iterations }`.
   Each `failed[]` row carries `module`, `status`, the response `body`, and `ms`.
3. **If `ok` — done.** Optionally pin the contract: open `/docs/<module>`, set
   Expectations, **Save fixtures** (`fixtures/cake.json`), freeze a Scenario.
4. **If not `ok` — diagnose each `failed` row** (use the `rune:cake` SKILL §5
   table). Classify by the response body:
   - unresolved `$input` / `{{ref}}` → add a `seed`, or run/compose the producer.
   - 422 with a path + constraint → the body names the failing field; fix the
     `byEndpoint` override or the seed, or route a real contract fix to
     `rune:spec`/`rune:build`.
   - a project error slug → consult `fixtures/heal-rules.json` for the prescribed
     fix (`references/heal-rules.md`). For a `retry`/`note(retryAfter)` slug, pass
     it through `retry` (or just re-run — `/docs/_run` derives retry slugs from the
     rules).
   - green-but-wrong (caught only if you pinned Expectations) → logic bug → route
     to `rune:build`.
5. **Apply the smallest fix, re-run** (back to step 2). Cap iterations; if a
   failure is *environmental* (a real service unreachable), report it — do **not**
   mock it away.

## Discipline

- Use the sequential-thinking MCP to reason through each failure before acting.
- Evidence, not vibes: quote the response `body`, the banner reason, and the
  `dryRun` cycle/`unresolvedInputs` report when you explain a failure.
- The **runner's full option surface** (`overrides.auth`, `rateLimit`, `retry`,
  `maxIterations`, in-process vs `baseUrl`, `$name` resolution order) is owned by
  **`rune:framework`** — consult it, don't re-derive it.
- Hand spec fixes to **`rune:spec`**, body/controller/test/heal-enrichment fixes
  to **`rune:build`**. This agent *drives and diagnoses*; it does not edit specs or
  bodies itself unless told to.
