# The `rune` CLI

> Part of the [project spec series](README.md). Engine source: `src/` (Deno
> TypeScript, compiled to a single binary). Front door: `src/bootstrap/mod.ts`,
> which dispatches on `Deno.args[0]` — every command is either a `run*`
> entrypoint re-exported from `src/rune/mod-root.ts` or a passthrough to a Rust
> helper binary (`rune-lsp` / `rune-syntax`).

The CLI is the user-facing surface of the **shaping layer**: it validates
specs, generates and reconciles module trees, lints the result against the
architecture, and runs the live dev loop. Codegen and lint live in Deno;
speed-critical authoring paths (LSP, format, editor install) are delegated to
the Rust helpers built from `lang/`.

## Command surface

| Command | What it does |
| --- | --- |
| `rune init <name>` | Scaffold a fresh **composed monorepo**. When the sprig CLI is present — the binary probed on `PATH` then at `~/.deno/bin/sprig` — rune shells out for the `ui/` half (`sprig init <name>`; a failed sprig run → exit 1 with its output), and the sprig scaffold writes the git-root `serve.ts` composition root (`Deno.serve(Backend(Frontend))`) and the workspace `deno.json`. **When sprig is absent, init degrades gracefully instead of exiting**: rune scaffolds the backend, writes the neutral git-root files itself (the workspace `deno.json` and the `serve.ts` composition root), lays down the shared `spec/` skeleton, and emits a marker telling the user to add the UI half with `sprig init ui/` (install sprig first via `deno run -A jsr:@sprig/core/cli install` if needed). Either way rune overlays the keep backend — `server/bootstrap/`, shared `spec/{runes,misc,ui}/`, a starter `spec/runes/core.rune`, and a durable `spec/manifest.json` (the durability manifest — see [01-architecture.md](01-architecture.md) — written idempotently if absent) — and merges its engine import map into `server/deno.json`. Records the layout decision in `spec/misc/layout.md`. Which repo owns the composed-monorepo git root is an open cross-repo decision ([DECIDE] — coordinated in tooling/coms.md). (`src/rune/entrypoints/init/mod.ts`) |
| `rune sync <file.rune>` | The reconcile pass: parse + validate the spec, then scaffold/prune/preserve the generated tree (see below and [04-codegen.md](04-codegen.md)). |
| `rune check <file.rune>` | Validate only — same parser + planner errors as sync, zero writes. Exit 0 clean / 2 errors. (`entrypoints/check/mod.ts`) |
| `rune manifest <file.rune>` | One-shot generate — sync's step 1 (plan + validate) plus the create/regenerate writes, **and nothing else**: no create-once growth, no `deno.json` merge, no bootstrap regen, no ghost stubs, no heal rules, no diagnostics, no prune, no run-all gate. `[--root] [--artifact] [--json]`. `--json` prints one object — `{ module, rune, created, regenerated, appended, skipped, errors }` (root-relative path arrays; `appended` is always empty; `errors` collects I/O failures) — or, on failure, exactly one of three error objects: `{ error: "io", path, message }` for an unreadable spec, `{ error: "artifact", path, message }` for an artifact file that can't be read or isn't JSON, `{ error: "parse_error", rune, errors }` for spec validation errors. Two failures ignore `--json` and print plain text to stderr: a usage error (argument parsing fails before the flag is honored) and an artifact that parses as JSON but fails artifact validation (`loadArtifact`'s `invalid <path>:` diagnostics). Exit 0 on success; 2 on every failure above and on any write I/O failure (a non-empty `errors` array in the success shape). (`entrypoints/manifest/mod.ts`) |
| `rune lint [dir]` | The architecture linter — 27 rules over the project tree (see [05-linter.md](05-linter.md)). `[dir]` (default `.`) is the start point, not the walk root: lint walks **up** to the nearest `deno.json(c)` (falling back to `[dir]` when none is found), then descends into `server/` when that root has no `src/` of its own but holds `server/bootstrap/mod.ts` — so run at a composed-monorepo git root it lints `server/`, never `ui/`. Finding paths are relative to that lint root. Flags: `--strict` (sets `RUNE_LINT_STRICT=1`, also honored as the alias `RUNE_STRICT`, for strict-gated rules — currently only `rune-heal-todo`, silent in a plain lint but failing under `--strict` on any heal-rules entry still carrying `todo: true`; it adds findings, so it can only turn a clean exit into a violating one, never the reverse — see [05-linter.md](05-linter.md)), `--module <name>` (scopes the report, not the walk: every rule still runs over the whole lint root, then only findings whose path is under `src/<name>/` are printed and counted toward the exit code), `--json`, `--no-suggest`. Exit 1 on any violation. |
| `rune dev [path]` | The live loop: watch → check → sync → restart the app under `KEEP_DEV` (see below). |
| `rune stop [path]` | Stop this repo's shared `rune dev` process and reap its app child. Nothing registered for the repo → a "no shared dev process registered" notice, not an error. Always exit 0. |
| `rune validate <keywords.json>` | Meta-validate a language artifact against the artifact contract — the `keywords.json` format and its contract are defined in [08-language-tooling.md](08-language-tooling.md). `[--json]` prints `{ ok, errors }`, each error a `{ path, message }` pair; usage/read/parse failures print plain text regardless. Exit 0 valid / 1 invalid / 2 on a usage error or an unreadable/unparseable file. |
| `rune lsp` | Start the language server (delegates to the Rust `rune-lsp` binary). |
| `rune fmt` / `format` / `install` / `uninstall` / `completions` | Fast authoring commands — verbatim passthrough to the Rust `rune-syntax` binary (formatting, editor integration, shell completions). |
| `rune update [tag]` (alias `upgrade`) | Self-update from GitHub Releases on `mrg-keystone/rune`: fetches the target release's own `install.sh` asset — `[tag]` defaults to the rolling `latest` release; `main`'s `scripts/install.sh` is the fallback for releases predating the asset — and runs it: binaries, Claude skills *and* agents. |
| `rune -v` / `version` | Prints the baked version/commit (`src/core/dto/version.gen.ts`) and checks the `mrg-keystone/rune` `latest` release's `commit.txt` asset for a newer build (asset, not tag — gh rolling releases freeze the tag but swap assets). |

Dispatch notes: the first argument must be one of the commands above. There is
no bare-directory shorthand — the linter always runs as `rune lint [dir]`
(`rune .` is an unknown command) — and a bare `foo.rune` argument is **not** a
sync shorthand: it errors with a `sync`/`check` hint. Both cases exit 2; bare
`rune` with no args prints the help (exit 0). Rust helper binaries are resolved
by probing `RUNE_BIN_DIR`, the directory next to the installed `rune`,
`lang/target/{release,debug}/`, then `PATH`.

From a checkout, run without compiling: `deno run -A src/bootstrap/mod.ts <args>`.

## `rune sync` — semantics that matter

Flags: `--root <dir>`, `--artifact <keywords.json>` (plan from an edited
language artifact instead of the engine defaults — its bindings, codegen
templates, and policies drive generation; the same flag on `rune manifest`;
artifact format: [08-language-tooling.md](08-language-tooling.md); an
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
(`src/…`, `bootstrap/…`, `deno.json`, step 8's heal-rules dir) is
root-relative — in the canonical layout, generation lands in
`<git>/server/src/<module>/`.

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
   invariant, see [01-architecture.md](01-architecture.md)),
   `reflect-metadata@0.1.13`, the decorator compiler options. On a *fresh*
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
   spec can't break the running app.
6. **Bootstrap** — regenerates `bootstrap/modules.ts` (the module registry) and
   creates-once `bootstrap/{mod.ts,config.ts}`.
7. **Ghost stubs** — for each `[TYP:ext]` input no module produces,
   `bootstrap/stubs.ts` mints a placeholder GET endpoint (`stub: true`,
   production-excluded via `DENO_ENV=production`); it evaporates on the next
   sync once a real producer exists.
8. **Heal rules** — scaffolds/merges the heal-rules file from the spec's
   declared fault slugs (merge-owned; `todo: true` entries carry a standing
   enrichment nudge). Its directory mirrors keep's cake-config resolution:
   `spec/misc/` when the root has a `spec/` directory **of its own**, else the
   legacy `fixtures/`, with `KEEP_FIXTURES_DIR` overriding both. The shared
   `spec/` `rune init` lays down sits at the git root, not under `server/`, so
   in the canonical layout the file lands at
   `<git>/server/fixtures/heal-rules.json`.
9. **Diagnostics** — poly-barrel staleness warnings; input diagnostics
   (unproducible `$inputs`, required fields with no `example=` — a guaranteed
   422 at run time).
10. **The run-all gate** — writes a throwaway runner script and drives keep's
   `exerciseEndpoints` against keep alone, imported from `bootstrap/mod.ts` in
   a subprocess (not the composed `serve.ts`), printing the verdict last
   ("run-all: N/N steps passed"). Soft on every failure mode;
   `--no-run` skips it. The point: a build session *can't not notice* the app
   doesn't run.

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

## `rune dev` — the live loop

`rune dev [path]` (`entrypoints/dev/mod.ts`) runs the spec→cake loop
unattended. `[path]` defaults to `.` and locates the backend root: a directory
is taken as the root itself; a `.rune` path means "dev the project that owns
this spec" (sync's root rule); a root without `bootstrap/mod.ts` descends into
`server/` when that holds the backend — and exits 2 when neither does. The
app child is that backend root's `bootstrap/mod.ts`, spawned directly
(`deno run -A bootstrap/mod.ts`) — its own `import.meta.main` guard is what
binds the port. That's keep alone, not the composed `serve.ts`
(`Deno.serve(Backend(Frontend))`) that `rune init` scaffolds at the git root for
sprig UI + keep together — which is why the cycle below only ever mentions
keep's `/docs/_dev` and cake pages, never the sprig UI.

- **One shared process per git repo**, registered in `~/.rune/dev.json` — the
  global rune state dir `~/.rune` (which holds both `dev.json` and the rotating
  logs) is overridable via `RUNE_HOME`. The
  first run owns the watcher + app child (output teed to a rotating log
  folder — rolled to a fresh timestamped file every 2000 lines, 20 files kept
  per repo with the oldest pruned); later runs in the same repo attach to the
  live log; a dead owner's
  stale entry is reclaimed after reaping its orphaned app child by recorded
  pid. `rune stop [path]` tears it down (`[path]` defaults to `.`). The
  registry key is the enclosing git repo's folder name, so any path inside
  the repo works; outside any git repo it falls back to the target
  directory's own folder name (sanitized) — run `dev` and `stop` against the
  same directory there. The key is a folder *name*, not a path — a known
  limitation: two repos whose folders share a name share one slot, so the
  second repo's `rune dev` attaches to the first's live process and its
  `rune stop` stops it; give clones distinct folder names to run both at
  once.
- **Watch targets** — under the backend root: `src/`, `spec/`, `specs/` (the
  older plural staging layout — dev keeps watching it so legacy projects still
  re-sync on save; those syncs land in the backend because dev pins `--root`,
  see the cycle), `bootstrap/`, `deno.json`; plus the `spec/` in the
  backend root's parent directory — the shared git-root `spec/` in the
  canonical layout, where the spec now durably lives. Because the spec is no
  longer relocated into `src/`, the shared `spec/runes/` is an **active spec
  target**: a `.rune` edit there reaches dev as a `../spec/runes/…` path and
  fires a spec cycle (check → sync → restart, pinned to the backend `--root`).
  The sibling `../spec/misc/` and `../spec/ui/` stay classified out (not
  backend codegen source). Each target
  is watched only when it exists — and never the
  bare root itself (the child writes `deno.lock` there). Sync's own writes are
  suppressed from the watcher.
- **Cycle** — startup runs no check and no sync: the owner writes a green
  status file and boots the app child from the tree as-is; the first cycle
  fires on the first watched change. Cycles: 200 ms trailing debounce,
  single-flight with one queued follow-up. The spec/source split is
  `classifyPath`, over event paths relative to the backend root: a path with
  any dot-prefixed segment is **ignored** — dotfiles, and anything outside the
  backend root, which arrives as `../…`, is discarded — **except the shared
  git-root `spec/runes/`**: a `../spec/runes/<m>.rune` edit is recognized as a
  spec change (the durable spec lives there now, so dev must watch it), while
  `../spec/misc/` and `../spec/ui/` remain classified out. A
  `.rune` file is a **spec** change only at a project-spec path (the shared
  `spec/runes/`, flat `spec/`/`specs/`, or `src/<module>/<module>.rune` /
  `src/<module>/spec.rune` — both in-module names are accepted by the shared
  `isProjectSpec` predicate (`rune-bindings`), which every auto-discovery scan
  uses, not a dev-only tolerance); `.in-prog.rune` drafts and every other
  `.rune` —
  a doc, a vendored spec, one nested deeper — are ignored. Every other file,
  whatever its extension (a root-local `spec/misc/layout.md` included), is a
  **source** change. A debounce batch is one cycle: its changed specs are
  deduped and sorted, **all** of them are checked before anything syncs (any
  error stops the cycle at the status file — no sync, no restart), then each
  clean spec is synced in order, then the app restarts **once**; source
  changes in a mixed batch add nothing beyond that single restart. A **spec**
  change runs `rune check`
  first: errors go to the
  status file **only** (keep's `/docs/_dev` serves them; open cake pages show
  a red banner) while **the last good server keeps serving**; a clean check
  runs a full `rune sync`, always invoked with an explicit `--root <backend
  root>` — the watched spec's own location (e.g. the legacy `specs/`, which
  `resolveRoot` roots in its own directory) never re-derives the root — and
  with no `--no-run`, so the run-all gate runs every clean cycle. That never
  collides with the running app child: the
  gate's subprocess imports `api` from `bootstrap/mod.ts`, whose `listen()` is
  guarded by `import.meta.main`, so the walk runs in-process without binding a
  port. Its verdict prints in dev's own console output like the rest of sync's
  report (it never reaches the status file) — then the app restarts. A
  **source** change restarts without sync. A vanished spec — a watched
  `.rune` file deleted or renamed away — is treated as a removal, not an
  error: with no spec text left to check or sync against, dev runs neither —
  the module's previously generated tree is left on disk untouched — and the
  removal event itself is the restart trigger, joining clean spec sync and
  source change on that list. An app child that **exits on its own** (crash or clean exit) is
  never respawned in place — no retry, no backoff: dev prints `app exited
  (code N) — waiting for the next save`, writes that same error to the status
  file (the red banner shows it), and the app stays down until a later cycle
  restarts it — the next source change, clean spec sync, or spec removal (a
  spec save with check errors does not restart).
- The app boots under `KEEP_DEV=<status file>` (atomic tmp+rename writes), so
  keep serves `/docs/_dev`, every cake/map page polls it, and the pages
  auto-reload when the `bootId` changes. Cake session state lives in
  `localStorage` and survives every restart.

## The authoring loop (end to end)

```sh
# 1. write a spec at spec/runes/<module>.rune (or draft as <module>.in-prog.rune)
rune check spec/runes/tasks.rune       # validate as you go (same errors as the LSP)

# 2. generate / reconcile
rune sync spec/runes/tasks.rune        # scaffold into server/src/tasks/, red by design

# 3. fill the dev-owned bodies (coordinator cores, adapters); contracts (mod-root.ts) are generated
deno check server/src/**/*.ts          # shows exactly what to reconcile after a spec edit

# 4. lint against the architecture
rune lint                              # lints server/ from the git root; "All clear — no violations found." = exit 0

# or run 1-4 continuously — the spec stays put in the shared git-root
# spec/runes/, which dev watches as an active spec target: a spec edit there
# auto-fires a check → sync → restart cycle (see the cycle), no manual
# `rune sync` needed. dev also watches the generated source under server/src/
# and restarts on save.
rune dev
```
