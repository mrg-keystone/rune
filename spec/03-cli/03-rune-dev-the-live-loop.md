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
- **Cycle** — startup runs no check and no sync: the owner boots the app
  child from the tree as-is and, once it's up, writes a green status file
  with a fresh `bootId`; the first cycle fires on the first watched change.
  Every later restart repeats that same write — clean spec sync, source
  change, or spec removal all reboot the app child and then write a fresh
  green status file with a new `bootId`, which is what clears a red banner
  left by a prior check error and drives the pollers' auto-reload. Cycles:
  200 ms trailing debounce,
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
  (code N) — waiting for the next save` and writes that same error to the
  status file — but keep *is* the crashed app child, so `/docs/_dev` can't
  serve it live: open cake pages get connection-refused and fall into the
  poller's "server restarting…" notice (not the red banner, which is a
  check-error state that requires a live server to serve it) until a later
  cycle brings the app back up. The app stays down until that later cycle
  restarts it — the next source change, clean spec sync, or spec removal (a
  spec save with check errors does not restart).
- **Status file shape** — the wire contract between the owner (writer) and
  keep's `/docs/_dev` plus its browser poller (readers,
  [07-cake/05](../07-cake/05-dev-mode-and-tracing-pages.md)):
  `{ bootId: string, status: "green" | "check-error", error?: string }`.
  `bootId` is a fresh id minted on every successful boot — unchanged by a
  check-error write — and is what the poller diffs to detect a restart and
  reload. `status` is `"green"` after a successful boot and `"check-error"`
  when a spec check fails or the app child exits, with the last live
  `bootId` left in place either way. `error` carries the check error text (or
  the exit message) and is present only when `status` is `"check-error"`.
  No other fields exist.
- The app boots under `KEEP_DEV=<status file>` (atomic tmp+rename writes) —
  but `KEEP_DEV` alone only wires the dev channel into keep, it doesn't turn
  the docs surface on: per
  [13-environment-variables/02](../13-environment-variables/02-keep-runtime-serving-behavior.md),
  `/docs/*` is off by default and needs `KEEP_DOCS` truthy (which
  `bootstrapServer` uses to auto-register `DocsModule`), and per
  [07-cake/05](../07-cake/05-dev-mode-and-tracing-pages.md) `KEEP_DEV` takes
  effect only once the docs module is already serving. So the dev-booted app
  child also boots under `KEEP_DOCS=1`, alongside `KEEP_DEV`, so `DocsModule`
  is registered and serving — that's what makes `/docs/_dev` reachable, every
  cake/map page get its injected poller, and the pages auto-reload when the
  `bootId` changes. Cake session state lives in `localStorage` and survives
  every restart.

