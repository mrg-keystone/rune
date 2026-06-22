# Task 05 — `rune dev`: the live spec→cake loop

Repos: **keep first, then rune**. Read `00-context.md` first.
**Prerequisite: task 02 complete** (the `emulatorShellHtml` `opts` param with the reserved `dev`
field must exist).

## Goal

One command — `rune dev [path]` — gives a live loop: save the `.rune` spec → re-check → re-sync →
app restarts → the open cake page reloads itself with session state intact (state already
survives reloads by design). Spec errors appear in the page banner while the last good server
keeps serving. Saving non-generated source restarts without a sync.

## Part 1 — keep (the reload channel)

1. `src/foundation/domain/business/emulator-ui/client.ts`: export a new `devReloadJs: string`
   (String.raw; HARD RULE: no backtick, no `${` inside). Behavior:
   - poll `fetch("_dev")` (relative — resolves to `/docs/_dev` from `/docs/<module>` and stays
     correct under a path-prefix mount) every 1500 ms, only while
     `document.visibilityState === "visible"`;
   - response `{ bootId, ok?, errors?, at? }`: store the first bootId; on a DIFFERENT bootId →
     `location.reload()` (never reload on recovery alone);
   - `errors` non-empty → show them in `#banner` (class `err`, joined with line breaks) — but
     OWNED: set a flag when the dev script writes the banner and only clear/overwrite banners it
     owns, so it never clobbers a run-all "Stopped at step …" message; `ok` → clear only an
     owned banner;
   - network failure (server restarting): tighten polling to 500 ms; after 2 consecutive
     failures show an owned info banner "server restarting…"; resume normal cadence on success;
   - HTTP 404 → stop polling permanently (prod fallback guard).
2. `src/foundation/domain/business/emulator-ui/mod.ts`: when `opts.dev` is true, append
   `<script>${devReloadJs}</script>` to the page (interpolation happens in mod.ts's own template,
   which MAY use `${}` — the constraint is only inside client.ts's raw strings).
3. `src/foundation/domain/coordinators/bootstrap-server/mod.ts`: read
   `const devStatusPath = Deno.env.get("KEEP_DEV")`. When set: mint
   `const bootId = crypto.randomUUID()` once per process; register
   `GET /docs/_dev` → JSON `{ bootId, ...status }` where `status` is a per-request
   `Deno.readTextFile(devStatusPath)` + `JSON.parse`, and ANY failure (missing file, partial
   write) degrades to `{ bootId }` alone; pass `dev: true` into every cake page's opts.
4. keep tests: an int test (pattern: `bootstrap-server/int.test.ts`) — boot with
   `KEEP_DEV=/tmp/<rand>.json`, GET `/docs/_dev` → has `bootId`; write a status file with
   errors → response includes them; corrupt file → `{ bootId }` only. Plus
   `emulator-ui/test.ts`: page HTML contains the dev script only when `opts.dev`.

Run keep verification now: `deno task test && deno task test:browser` green,
`deno task check:jsr` green.

## Part 2 — rune (the watcher/orchestrator)

1. `src/rune/entrypoints/sync/mod.ts` hardening (do this FIRST — it makes the watcher loop
   physically quiet):
   - every file write in the sync path (created, regenerated, deno.json, bootstrap files) must
     read-before-write and SKIP byte-identical content (modules.ts already does this — extend
     the pattern);
   - add an optional collector param (e.g. `runSync(args, written?: string[])`, backward
     compatible) that records every path actually written/deleted, plus BOTH sides of the spec
     move (`rune sync` relocates the spec into `src/<module>/` — record source and target).
2. New `src/rune/entrypoints/dev/mod.ts` exporting `runDev(args: string[]): Promise<number>`:
   - root: `args[0] ?? "."`; if it's a `.rune` file, derive the project root the way sync does
     (reuse its root-resolution helper) but always operate project-wide;
   - status file: `await Deno.makeTempDir()` + `/status.json`; write atomically (write
     `status.json.tmp`, `Deno.rename`); shape `{ ok: boolean, errors: string[], at: string }`;
   - child: `new Deno.Command("deno", { args: ["run", "-A", "bootstrap/mod.ts"], cwd: root, env: { ...KEEP_DEV: statusPath }, stdout/stderr: "inherit" }).spawn()`;
     on unexpected exit write `{ ok: false, errors: ["app exited (code N)"] }` and WAIT for the
     next save — no auto-restart loop;
   - watch: `Deno.watchFs([root+"/src", root+"/specs", root+"/bootstrap", root+"/deno.json"].filter(exists))`
     — NEVER the bare root (the child writes `deno.lock` there);
   - cycle engine: 200 ms trailing debounce; single-flight (events during a cycle buffer into at
     most one follow-up); drop events whose path is in the written-set (collector output) for
     the cycle duration + a 2 s tail; ignore dotfiles/`.DS_Store`;
   - cycle logic: changed path is a project spec (`isProjectSpec`) → run check (reuse the same
     parse+rules the `check` command uses) → errors? write status only : run sync (with
     collector) + write ok status + restart child (TERM → 2 s → KILL → respawn with SAME status
     path; the new process mints a new bootId by itself). Non-spec change → restart only;
   - shutdown: `Deno.addSignalListener("SIGINT"/"SIGTERM")` → flag, kill child (TERM, 2 s,
     KILL), remove temp dir, `Deno.exit(0)`; the child-exit watcher must not treat this as a
     crash.
   - Factor the pure parts (event filtering, suppression-set logic, cycle planning) into
     exported functions and unit-test them in `dev/test.ts`; the process/watch glue stays thin.
3. Register the command: export `runDev` from `src/rune/mod-root.ts`; add the dispatch block in
   `src/bootstrap/mod.ts` (copy the `sync` block's shape); add one help-text line.

## Verification (the whole task)

Scripted/manual session on a /tmp project (build it like task 03's verification, with keep
remapped to the local checkout and coordinator bodies filled):

1. `deno run -A src/bootstrap/mod.ts dev /tmp/devproj` (from the rune repo) → app boots; open
   or curl `http://localhost:<port>/docs/<module>` and `/docs/_dev` (has bootId).
2. Append a new `[ENT]` (+ its DTOs/TYPs) to the spec, save → within ~3 s `/docs/_dev` serves a
   NEW bootId; the page (via Playwright or curl of the page HTML) shows the new step; previously
   set cake variables survive (localStorage is untouched by reloads).
3. Break the spec (bad indentation), save → `/docs/_dev` serves `ok:false` with the `rune check`
   error text; the OLD server still answers; the page banner shows the errors.
4. Fix the spec → recovers, new bootId.
5. Ctrl-C the dev process → `pgrep -f "bootstrap/mod.ts"` finds no orphan.
6. Watch the dev process logs for ~30 s idle: ZERO cycles fire (the self-trigger loop is dead).
7. Both repos' test suites still green: keep `deno task test` + `deno task test:browser`; rune
   `deno test -A src/rune/entrypoints/dev/ src/rune/domain/business/rune-manifest/`.

## Definition of done

- [ ] keep: `/docs/_dev` registered only under `KEEP_DEV`; dev script injected only when `opts.dev`; tolerant status reads; tests green
- [ ] rune: sync skips byte-identical writes and reports written paths; `rune dev` command works end-to-end per the 7-step verification
- [ ] Banner ownership respected (dev messages never clobber run-all banners)
- [ ] No orphan processes; no idle-loop cycles; no commits; no `deno fmt` in rune
