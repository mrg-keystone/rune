---
name: "rune:cake"
description: >-
  Prove a rune backend actually does what it's supposed to, end to end, through
  the per-module **cake** at `/docs/<module>` — real data, no mocks, real service
  connectivity — and fix the cake when a walk goes red. Use when the user says
  "run the cake", "exercise the endpoints", "walk the process", "does the app work
  end to end", "Emulate process / Run all in order", "the cake is red / a step
  fails / won't bind", "$input won't resolve", "run-all is red", "pin an
  expectation / save fixtures", "save/replay a scenario", "fix the heal rules /
  heal panel", or "drive the whole composed app headless" (`POST /docs/_run`,
  `exerciseEndpoints`). Covers serve-and-walk, the real-data e2e discipline,
  headless replay, Expectations→`spec/misc/cake.json`, Scenarios, response-diff,
  the system map, and the FIX-CAKE assist (stale entrypoint controller, missing
  schema example, unproduced `$input`, 422 assert failure, heal panel rules→Claude).
  NOT for writing/editing the `.rune` spec → use `rune:spec`; NOT for generating
  + filling bodies + unit/smoke tests + enriching heal-rules → use `rune:build`;
  NOT for runtime/auth/runner internals (`bootstrapServer`, 401/403, the
  `exerciseEndpoints` full option surface, mounting/deploy) → use `rune:framework`;
  NOT for per-endpoint Swagger examples → use `rune:docs`.
user-invocable: true
argument-hint: "[module to exercise, or the cake problem to fix]"
---

# rune:cake — orchestration playbook

The cake is rune's **end-to-end tier**: a per-module guided walk at `/docs/<module>`
that runs your real endpoints, in dependency order, against **real services with no
mocks**. The main session drives the **interactive** browser walk and pins the
contract itself; it delegates the **unattended/headless** drive-and-heal loop to a
specialist, and routes every real fix to the owning sibling skill.

## When this skill applies

"Does the composed app work right now, with real data?" or "the cake / heal / run-all
is broken — get it green". Serving and walking `/docs/<module>`, pinning
expectations/scenarios, replaying headless, or fixing a red walk.

## Specialist roster

- **`rune-cake-e2e-driver`** — drives the e2e walk UNATTENDED against a running
  localhost server (dryRun → `POST /docs/_run` → diagnose each failed row → heal →
  re-run to green), reports remaining failures with the owning sibling. Owns the
  headless diagnosis/heal procedure; reads `references/cake.md` + `references/heal-rules.md`.

## The interactive tier (main session runs this itself)

A subagent can't share the browser or talk to the user, so the interactive walk stays here:

```text
deno run -A bootstrap/mod.ts            # serve the composed app
open http://localhost:<port>/docs/<module>
   ├─ Emulate process    # send the next step, read the response, capture its output
   └─ Run all in order   # walk the active flow top-to-bottom, stop at the first failure
green ✓ on every step ⇒ the logic actually works (not just type-checks)
```

- Request bodies are generated from the input DTO schema; bound fields carry
  `{{step.field}}` refs resolved at send time. Captures + variables are shared across
  docs pages via `localStorage`. A `flows` module shows a **flow selector** (default
  **main** = untagged-only, so a destructive `teardown` never auto-runs). `/docs/_map`
  is the whole composed app as one live process graph.
- Prefer **`rune dev`** for the edit loop (watch → re-check/sync → restart; open pages
  self-reload). `rune dev` does **not** run `deno test` — that loop is `rune:build`'s.
- **Pin the contract (interactive):** **Expectations → `spec/misc/cake.json`** (each
  step's Expect block pins status + body checks; **Save fixtures** writes setup +
  expectations + variables) and **Scenarios → `spec/misc/scenarios/<name>.json`** (the
  Scenarios card freezes the whole walk). Full cake-page behavior, the Expectations
  grammar, Module setup, and response-diff are in **`references/cake.md`**.

## Real data, no mocks — the e2e discipline

The whole point: the cake hits **real services**. Do not stub the boundary, mock the
adapter, or hand-fake a response to force green — a green walk is only meaningful
because it proves the real call path (auth, the real DB/HTTP/queue adapter, real DTO
validation) works against a live dependency. This shares the smoke-connectivity premise
with `rune:build`'s `smk` tests. An unreachable service is an environmental failure to
fix or visibly seed past, never a reason to mock.

## When to delegate to `rune-cake-e2e-driver`

For unattended / CI / "drive it headless" runs, or an automated get-it-green loop:

1. **(main session) Start a real localhost listener first** — `deno run -A
   bootstrap/mod.ts`. `POST /docs/_run` (and `/docs/_heal`) are **localhost-only and
   refuse in-process dispatch**, so the driver needs a real loopback process.
2. **Delegate** to `rune-cake-e2e-driver` (Task tool). Pass: the running base URL, the
   modules in scope, any known `seeds`, and the absolute paths to
   `claude/skills/rune:cake/references/cake.md` + `references/heal-rules.md` (or the
   installed `~/.claude/skills/rune:cake/references/…`).
3. It returns the final verdict + each remaining failure with its diagnosed cause and
   the owning sibling. **Summarize** that and route the fixes (below).

## Routing a red walk to its owner

The driver (headless) and you (interactive) classify a failure, then hand the real fix
to the owner — this is the coordination map:

| Diagnosed cause | Owner |
| --- | --- |
| stale entrypoint controller; unimplemented/wrong body; heal-rule enrichment | **`rune:build`** |
| missing `[TYP:example=]`; wrong order/deps/bind; an echo that should mint; a contract fix | **`rune:spec`** |
| the runner option surface; `bootstrapServer`/auth/trust posture | **`rune:framework`** |
| a per-endpoint Swagger example/description | **`rune:docs`** |

This skill **owns the heal-rules schema** (documents it) but never authors rules —
`rune sync` scaffolds them from fault slugs and **`rune:build`** enriches them.

## Hard rule

The main session runs the interactive browser walk + GUI pinning itself and delegates
the unattended headless drive-and-heal to `rune-cake-e2e-driver`; it never mocks a
boundary to force green, and it routes every real code/spec fix to the owning sibling.

## What's no longer here

The detailed headless drive/heal procedure and the symptom→cause diagnostic method now
live in `rune-cake-e2e-driver` + `references/cake.md` + `references/heal-rules.md`; this
playbook keeps only the interactive walk and the cause→owner routing.
