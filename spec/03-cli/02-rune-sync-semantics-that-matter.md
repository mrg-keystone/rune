## `rune sync` — semantics that matter

Flags: `--root <dir>`, `--artifact <keywords.json>` (plan from an edited
language artifact instead of the engine defaults — its bindings, codegen
templates, and policies drive generation; the same flag on `rune manifest`;
artifact format: [08-language-tooling.md](../08-language-tooling/00-overview.md); an
unreadable or invalid artifact exits 2), `--dry-run` (report only — see
below), `--force` (delete dev-owned orphans), `--regen <path>`
(non-destructive single-file mode — see below), `--no-run` (skip the run-all
gate).

**Root resolution.** Absent `--root`, the codegen root is derived from the
spec's **own path**, never from cwd (`entrypoints/spec-root.ts` — one
`resolveRoot` shared by `sync`, `manifest`, `check`, and `dev`): a spec
in `<dir>/spec/runes/` (its durable shared home) — or a flat `<dir>/spec/` —
resolves to the sibling `<dir>/server/`, the composed-monorepo backend `rune
init` scaffolds; a spec in a legacy in-module `src/<module>/` layout resolves
to the directory above that `src/`; any other spec roots in its own directory
— including one in the
legacy plural `specs/`, which has no case here. Every path in this section
(`src/…`, `bootstrap/…`, `deno.json`) is root-relative — in the canonical
layout, generation lands in `<git>/server/src/<module>/`. Step 8's
heal-rules dir is the one exception: it resolves against the **git root**,
not this root — see step 8.

A sync run, in order (`src/rune/entrypoints/sync/mod.ts`):

1. **Plan** — `planSync` = `planManifest` (pure: spec text + existing file set
   → `{toCreate, toRegenerate, toSkip, errors}`) plus prune prediction.
   Dev-owned orphans are *reported*, not deleted, unless `--force`. Validation
   errors end the run here — printed, exit 2, nothing written (the same errors
   `rune check` reports).
2. **Create-once growth** — when a spec grows, missing members are appended to
   preserved dev-owned files as throwing stubs; anything un-locatable is
   reported as "owed" hand-work. Nothing dev-owned is silently clobbered.
3. **Write & prune** — the plan lands on disk: `toCreate` files are created,
   `toRegenerate` signatures rewritten (byte-identical writes skipped), step
   2's grown files written, then deletable orphans deleted — dev-owned ones
   only under `--force`, held back and reported otherwise (step 1). Write and
   delete failures are collected and turn the final exit into 2.
4. **Import map** — writes/merges the project `deno.json`: `REQUIRED_IMPORTS`
   pins `@mrg-keystone/rune@^4`, `#assert` (same major — the single-copy
   invariant, see [01-architecture.md](../01-architecture/00-overview.md)),
   `class-validator`, `class-transformer`, `reflect-metadata@0.1.13`, the
   decorator compiler options — the whole decorator stack the lockstep guard
   in [11-release-and-distribution.md](../11-release-and-distribution/00-overview.md)
   polices against keep's own ranges. On a *fresh*
   `deno.json` (none existed), sync additionally seeds
   `compilerOptions.strict = true`; where the file already existed, `strict`
   is left untouched.
5. **Spec stays put** — `spec/runes/<module>.rune` is the durable canonical
   home of the spec: sync **reads** it there and generates code into the
   root's `src/<module>/`, but never moves, renames, or relocates it out of
   `spec/`. A `.in-prog.rune` draft finalizes **in place** — the build drops
   the `.in-prog` infix, leaving `<module>.rune` beside it in `spec/runes/` —
   and while it still carries the infix it's excluded from every
   auto-discovery scan (dev watch, run-all, ghost stubs, lint) so a half-built
   spec can't break the running app. The rename is guarded: a draft may sit
   beside an already-finalized `<module>.rune` without conflict
   ([02-language.md § Comments and file conventions](../02-language/07-comments-and-file-conventions.md)),
   so if the target `<module>.rune` already exists, finalize refuses — exit
   2, naming both paths — rather than renaming over it; silently overwriting
   a hand-authored spec is destructive and unrecoverable, while a refusal
   only costs the author a manual merge/rename.
6. **Bootstrap** — regenerates `bootstrap/modules.ts` (the module registry) and
   creates-once `bootstrap/{mod.ts,config.ts}`.
7. **Ghost stubs** — for each `[TYP:ext]` input no module produces,
   `bootstrap/stubs.ts` mints a placeholder GET endpoint (`stub: true`,
   production-excluded via `DENO_ENV=production`); it evaporates on the next
   sync once a real producer exists.
8. **Heal rules** — scaffolds/merges the heal-rules file from the spec's
   declared fault slugs (merge-owned; `todo: true` entries carry a standing
   enrichment nudge). Its directory is the same fixtures directory the heal
   panel's reader resolves — canonically defined in
   [07-cake.md § The cake](../07-cake/02-the-cake-docs-module.md): the
   nearest git root's `spec/misc` when that root has a `spec/` directory of
   its own, else `<cwd>/spec/misc` when the cwd has one, else the legacy
   `<cwd>/fixtures`, with `KEEP_FIXTURES_DIR` overriding all three. This is
   an exception to this section's codegen root, which is where every other
   path above lands (see Root resolution, above). `rune init` always lays
   the shared `spec/` down at the git root, so in the canonical layout the
   file lands at `<git>/spec/misc/heal-rules.json` — the same file the heal
   panel's `GET /docs/_heal-rules` door reads.
9. **Diagnostics** — poly-barrel staleness warnings; input diagnostics
   (unproducible `$inputs`, required fields with no `example=` — a guaranteed
   422 at run time).
10. **The run-all gate** — writes a throwaway runner script and drives keep's
   `exerciseEndpoints` against keep alone, imported from `bootstrap/mod.ts` in
   a subprocess (not the composed `serve.ts`), printing the verdict last
   ("run-all: N/N steps passed"). Soft on every failure mode;
   `--no-run` skips it. The point: a build session *can't not notice* the app
   doesn't run.

A `rune sync <file.rune>` invocation processes exactly the one module named on
the command line ([03-cli.md § Command surface](01-command-surface.md)) — it
has no way to know whether other modules' specs still need generating, so the
ten steps above are this section's complete step list for one invocation.
Contract emission (`spec/contract/openapi.json` + `spec/contract/client/`) is
consequently not a step of this list: it is a separate, whole-spec pass a dev
or wrapping script runs once every module's own `rune sync` has completed,
regardless of that sync's own (advisory) run-all verdict — see
[04-codegen.md § The contract artifact](../04-codegen/02-the-contract-artifact-spec-contract.md)
for what that pass does and when it runs.

`--regen <path>` is a single-file **mode**, not a modifier: the run stops
after step 1's plan (validation errors still end it, exit 2) and handles only
the named file — steps 2–10 never run and nothing is pruned. Valid targets are
the files that plan generates for the spec's module — spec-owned and
create-once alike (`<path>` is resolved and matched root-relative); any other
path is an error (`not a generated file of <module>`, exit 2). An absent
target is created outright; one already byte-identical to the planned content
is left alone ("already matches the spec"); an existing, differing file gets
the planned content as a `<path>.new` sibling to diff in by hand — the
dev-owned original is never touched. Exit 0, else 2 on a write failure.

`--dry-run` is a report-only run: step 1 and step 2's growth analysis run in
full, then the usual report prints what a real run *would* create, regenerate,
extend, and prune (header suffixed "— dry run"), held-back orphans and owed
hand-work included — and steps 3–10 are skipped entirely: no writes, no prune,
no `deno.json` merge, no bootstrap/ghost-stub/heal-rules work,
no diagnostics, no run-all gate. Validation errors still end the run in step 1
with exit 2; otherwise it exits 0. Against its neighbors: `rune check` prints
errors only (no plan report); `rune manifest` actually writes.

Exit codes: 0 on success; 2 on a usage error, an unreadable spec or artifact,
validation errors, or any write/prune I/O failure. Held-back orphans and a red
run-all verdict are advisory — they print, they never change the exit.

Two write-discipline invariants:

- **Regenerate vs create-once vs merge.** Spec-owned files regenerate every
  sync (`mod-root.ts`, `bootstrap/modules.ts`, and the header-guarded
  ghost `bootstrap/stubs.ts`, rewritten or deleted as producers appear —
  DO-NOT-EDIT banners). Two files are merge-owned: `deno.json` gains missing
  import-map keys and compiler options, existing values never overwritten;
  `heal-rules.json` (in step 8's dir) gains new slugs, enriched entries
  never clobbered. Everything else is create-once and dev-owned ("Edit the body"
  banner).
- **Byte-identical writes are skipped** — no mtime change, no FS event — so
  re-syncs are physically quiet and `rune dev`'s watcher can't feed on itself.

