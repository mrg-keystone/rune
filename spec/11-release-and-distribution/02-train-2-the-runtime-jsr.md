## Train 2 — the runtime (JSR)

`publish-keep.yml`: a push touching `keep/**` on `main` → a pure JSR publish
of `@mrg-keystone/rune`, run through a reusable workflow. Mechanics
(documented in `keep/README.md` → Releasing):

1. **Fire** — a push touching `keep/**` lands on `main`.
2. **Preflight** — the workflow runs `check:keep-jsr` (the workspace-root
   `deno.json` alias that wraps keep's own `check:jsr` task, run from `keep/`
   against `keep/scripts/check-jsr-deps.ts` — see [10-testing-and-verification.md
   § Drift guards](../10-testing-and-verification/05-drift-guards-the-other-half-of-testing.md))
   plus `deno publish --dry-run`, to emulate JSR's server-side dependency
   validation locally so bad packages fail in seconds instead of after a
   ~10-minute server round trip. `check:keep-jsr` runs only as this publish
   preflight — it never runs inside `deno task verify`.
3. **Resolve version** — if `keep/deno.json`'s version isn't on JSR yet, it
   publishes as-is; otherwise the next version is derived from the latest
   published one by the bump rules below.
4. **Publish & poll** — the resolved version is published, and the workflow
   polls the JSR API rather than trusting the CLI. See **Run states** below
   for what a symptom during this step means.
5. **Auto-bump commit** — a derived bump lands back on main as a
   `release: vX (auto-bump)` commit, pushed as `GITHUB_TOKEN`. See
   **Anti-recursion** below for why this can't restart the cycle.

**Version bump rules:** the next version is derived from the latest published
one by commit conventions over the **triggering push's commits**:

| Triggering-push commit content | Bump level |
| --- | --- |
| no `feat:`, no `!:`/`BREAKING CHANGE` commit | **patch** (default) |
| contains a `feat:` commit, no `!:`/`BREAKING CHANGE` commit | **minor** |
| contains a `!:` or `BREAKING CHANGE` commit | **major** |

A `!:`/`BREAKING CHANGE` commit always wins: if the triggering push contains
both a `feat:` commit and a `!:`/`BREAKING CHANGE` commit, the bump is
**major**, not minor — the rows above are precedence-ordered highest-bump-wins,
not first-match top-to-bottom.

The bump levels above match `keep/README.md`'s own Releasing section; the
scan that walks the triggering push's commits is implemented in the external
reusable workflow in `mrg-keystone/actions`, to which `publish-keep.yml`
passes no commit range.

**Anti-recursion — why the auto-bump commit can't restart the cycle:** the
loop terminates at the trigger layer, not in the version branches:
`publish-keep.yml` hands the reusable only the `JSR_TOKEN` secret (plus a
`working-directory: keep` input) and grants `contents: write` to the run's
`GITHUB_TOKEN`, so the auto-bump commit is pushed as `GITHUB_TOKEN` — and a
`GITHUB_TOKEN`-authored push never starts a new workflow run, a GitHub
platform rule, not a mechanism either workflow implements. No second publish
run fires, so **resolve version** above only ever sees human pushes — an
already-published version at HEAD always means "derive the next bump", never
"the bump echoing back". And the commit touches only `keep/**` — squarely
inside `release-rune.yml`'s `paths-ignore` — so it could **not** rebuild rune
either way.

**Run states:** **never cancel a publish run that looks hung** — JSR holds
the package transaction lock across client disconnects, so a killed run
wedges the next attempt too.

| Symptom | Meaning | Action |
| --- | --- | --- |
| Real failure surfaces within ~20s of polling | a genuine task failure | inspect the surfaced error and fix it |
| Silence past ~20s (server-side processing has taken ~22 minutes for this package) | normal — JSR is still processing | wait; do **not** cancel |
| Still silent past the reusable's own timeout (defined in `mrg-keystone/actions`, not this repo) | the poll gave up before JSR finished | requeue the stuck task from the package's publishing-tasks page on jsr.io |
| Version live on JSR + publishing task complete, plus a `release: vX (auto-bump)` commit on `main` (derived-bump path — **resolve version** above derived the published version) | the release succeeded | none — no new run fires (see Anti-recursion) |
| Version live on JSR + publishing task complete, with **no** auto-bump commit (publish-as-is path — `keep/deno.json`'s version wasn't yet on JSR, so nothing was derived) | the release succeeded | none — there is no bump to commit |

**Example — a release trace:** a `feat:` commit merges to `main` touching
`keep/**`, with `keep/deno.json` at `1.4.2` already published on JSR →
preflight passes → the next version is derived as `1.5.0` (a `feat:` commit →
minor) → `1.5.0` publishes → the poll returns complete → a
`release: v1.5.0 (auto-bump)` commit lands on `main`, pushed as
`GITHUB_TOKEN` → no new run fires, because GitHub never triggers a workflow
run for a `GITHUB_TOKEN` push.

**Release order for coupled changes: keep first, then rune** — generated
projects pin keep's published JSR package, so any keep feature rune's
generated code depends on must be live on JSR before rune releases.

