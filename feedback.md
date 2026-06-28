# rune — feedback: misleading diagnostic when the project root is mis-inferred

**Type: diagnostics / UX, not a correctness bug.** `rune sync` works correctly once it
has the right root (`--root` is a valid workaround). The issue is that when rune infers
the *wrong* project root, it reports the failure as a **spec error** that sends you to
edit files that are already correct — a genuine red herring that cost real debugging time
on a first-run.

- Env: `rune 2.0.0 (192fc52)`, macOS
- Context: a cogasaur app — the rune project is nested at `server/` (so
  `server/src/core/core.rune` exists), while module specs are staged one level up at the
  **repo-root** `spec/runes/` (above the rune project).

---

## What happens

`rune sync` infers the project root as the folder **one level above** the spec's
`spec/runes/` directory, then expects `<root>/src/core/core.rune` and writes to
`<root>/src/`. There's no auto-discovery (it doesn't walk up to a `deno.json`/marker, and
doesn't consider cwd), and the inference is silent.

When the spec is staged **outside/above** the actual project, the inferred root has no
`src/core/core.rune`, so **every** service used by the spec is reported as undeclared:

```
$ rune sync spec/runes/environments.rune --dry-run      # run from the repo root
parse error in spec/runes/environments.rune:
  spec/runes/environments.rune:12: undeclared service "identity" — declare it as
      `[SRV] (TRANSPORT)identity: <ENV,…>` in src/core/core.rune
  spec/runes/environments.rune:18: undeclared service "db" — declare it as … in src/core/core.rune
  spec/runes/environments.rune:39: undeclared service "docker" — declare it as … in src/core/core.rune
```

**This is the bug in the message.** `core.rune` exists and declares `identity`, `db`,
`docker` — it's just at `server/src/core/core.rune`, not at the inferred
`<repo-root>/src/core/core.rune`. The real failure is *"I couldn't find a `core.rune` at
the root I guessed,"* but it's reported as *"your spec references services you never
declared — go add them to `src/core/core.rune`."* That points the user straight at editing
their (correct) spec and (correct) core, and never hints that root resolution is the
actual problem or that `--root` exists.

---

## Minimal repro (proves it's root inference, not the spec)

A hermetic, runnable repro is committed beside this file: **`./feedback-repro.sh`**
(needs `rune` on PATH; builds a throwaway nested project in a temp dir, runs the three
cases below, cleans up — `RUNE=/path/to/rune ./feedback-repro.sh` to point at a build).

The exact same spec succeeds or fails purely based on whether it sits inside the project:

```
# A) spec staged INSIDE the rune project (server/spec/runes/…), NO flag → resolves core, OK
$ rune sync server/spec/runes/foo.rune --dry-run
sync spec/runes/foo.rune (module: foo) — dry run
  Created N file(s): + src/foo/…        # root inferred = server/, finds server/src/core

# B) same spec at the repo-root spec/runes/, NO flag → "undeclared service …"
$ rune sync spec/runes/foo.rune --dry-run
parse error … undeclared service "db" — declare it … in src/core/core.rune

# C) repo-root spec/runes/ + point rune at the real root → OK
$ rune sync spec/runes/foo.rune --root server --dry-run
sync ../spec/runes/foo.rune (module: foo) — dry run
  Created N file(s): + src/foo/…
```

Only the inferred root differs between A/B/C; the spec and `core.rune` are identical.

---

## Suggestions (in priority order)

1. **Separate "no core.rune found" from "service not declared in core.rune."**
   Before blaming the spec, check whether `<root>/src/core/core.rune` actually exists.
   If it's **absent**, emit a root-resolution error instead of N undeclared-service errors:

   > `no core.rune found at <root>/src/core/core.rune (project root inferred as <root>
   > from the spec path "<spec>"). Pass --root <dir>, or move the spec into the project.`

   Only emit `undeclared service "X"` when a `core.rune` **exists** but genuinely lacks
   `X`. This one change turns a 10-minute red herring into a one-line fix.

2. **Surface `--root` in the failure and document how the root is resolved.**
   `rune sync --help` lists `--root <dir>` but never says how the root is *otherwise*
   determined (parent of `spec/runes/`). The error above should name `--root` as the fix;
   the help/docs should state the inference rule explicitly.

3. **Consider project-root auto-discovery via a marker.** Rather than assuming
   `root = parent of spec/runes/`, walk up from cwd (or the spec) to the nearest
   `deno.json` that maps the rune `@/` alias, or to the nearest `src/core/core.rune`. That
   makes nested/monorepo layouts (e.g. a rune project under `server/`) and out-of-tree
   staging "just work" without `--root`, matching how `deno`, `git`, etc. locate their
   root. (If `parent-of-spec/runes` is the intended, fixed contract, then #1 + #2 alone
   are enough — just make the failure say so.)

---

## Why this matters

The current behavior is *correct* but the *first-run experience* is the trap: a wrong
root produces a confident, specific, and **wrong** spec diagnostic. A user (or an agent)
following it will edit `core.rune`/the spec, re-run, get the same error, and burn time —
when the real answer was a single `--root` flag. Fixing the diagnostic (#1/#2) is cheap
and high-leverage; auto-discovery (#3) removes the flag entirely for nested layouts.

*Not a bug in codegen or resolution — `--root server` works and the generated output is
correct. This is purely about the error pointing at the wrong cause.*
