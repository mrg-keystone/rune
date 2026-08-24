# Release & Distribution

> Part of the [project spec series](README.md). Sources: `.github/workflows/`
> (`release-rune.yml`, `publish-keep.yml`), `scripts/{install,uninstall}.sh`,
> the build-time generators, and the root `deno.json` tasks.

Two publish trains, decoupled by path filters and kept compatible by the
**lockstep guard**: `deno task check:lockstep`
(`scripts/check-keep-lockstep.ts`) fails when the decorator-stack ranges rune
writes into generated projects drift from keep's own `keep/deno.json` ranges —
the single-copy invariant ([01-architecture.md](01-architecture.md)). Neither
workflow runs it; it is the first guard in `deno task verify`, run from the
checkout ([10-testing-and-verification.md](10-testing-and-verification.md)).

## Train 1 — the rune toolchain (GitHub releases)

`release-rune.yml`:

- **Push to `main`** → cuts **both** the rolling `latest` release (what
  `install.sh` pulls) **and** a pinned `vX.Y.Z` snapshot in the same run —
  byte-identical artifacts.
- **Push to `develop`** → the rolling **develop** channel (git tag `beta`,
  because a tag named `develop` would shadow the branch).
- **Push of a `v*` tag** → a pinned snapshot.
- `paths-ignore` keeps pushes touching **only** runtime-owned / non-binary
  facets (`keep/`, `e2e/`, `examples/`, `docs/`, `todos/`) from rebuilding the
  binaries. It is the trigger's sole path filter, so **any other push
  builds** — the binary inputs (`src/`, `lang/`, `claude/`, `scripts/`) but
  equally root files (`deno.json`, `README.md`, the workflows themselves) that
  the ignore list doesn't cover.

Jobs: **version** (one output, consumed by both the binary stamp and the pin
tag — a `v*` tag push → that tag verbatim; `main` → the next free patch
seeded from `keep/deno.json`'s semver, trying the seed itself first and
incrementing the patch past any `vX.Y.Z` with an existing tag or release —
so a main release can be exactly keep's version; `develop` →
`keep/deno.json`'s semver, for the binary stamp only) → **build** (matrix: Apple-silicon + Intel macOS, Linux x86-64;
`deno compile` for `rune`, `cargo build` for `rune-lsp`/`rune-syntax`; ad-hoc
codesign on macOS) → **meta** (`commit.txt`,
the staleness marker `rune -v` checks — an asset, not the tag, because rolling
releases freeze the tag but swap assets) → **release** + **pin**.

**Version stamping:** the version job's output feeds `scripts/gen-version.ts`
as `RUNE_VERSION_OVERRIDE`, which writes the gitignored
`src/core/dto/version.gen.ts` baked into the binary. `gen-version.ts` strips
any leading `v` from `RUNE_VERSION_OVERRIDE` before stamping, so `rune -v`'s
version number is always printed bare (no leading `v`), on every trigger: on
`main` it agrees with the pinned snapshot's `vX.Y.Z` tag (stripped to
`X.Y.Z`), and on a `v*` push it agrees with that same tag the same way
(`v1.2.3` stamps as `1.2.3`, not verbatim) — the pin tag itself still carries
the `v`, only the stamped/printed version never does. Develop's tag is the
rolling `beta`, so its binaries stamp `keep/deno.json`'s semver instead. The same generated file bakes the build commit and the UTC
build time; the commit (`GITHUB_SHA` in CI) is the binary-side half of the
staleness check — `rune -v` fetches the `latest` release's `commit.txt` (the
meta job writes it from the same `GITHUB_SHA`) and nags on any mismatch. The
check is channel-unaware — the fetch target is always `latest` — so the
no-nag guarantee is scoped to `latest` installs: a fresh `latest` install
never reports itself stale, while a `beta` install (develop SHA) or a pinned
snapshot nags whenever its commit differs from `latest`'s current build — the
nag means "a newer `latest` exists", not "your channel has an update".
Unknown or missing data never nags (never cry wolf): a source build's
`unknown` commit, an offline fetch, and a pre-`commit.txt` release (404) all
skip the check.

**Artifacts per target:** `rune-<target>.tar.gz` — `<target>` is the build
matrix's Rust triple: `aarch64-apple-darwin`, `x86_64-apple-darwin`, or
`x86_64-unknown-linux-gnu`, the exact strings `install.sh` maps
`uname -s`-`uname -m` onto (`Darwin-arm64`, `Darwin-x86_64`,
`Linux-x86_64`/`Linux-amd64`; any other platform exits pointing at the
build-from-source path). The tarball holds exactly the three binaries plus
`skill/` (all `rune:*` skill folders) and `agent/` (the agent fleet); every
other file is a sibling release asset — a `rune-<target>.tar.gz.sha256` per
tarball (published for out-of-band verification; `install.sh` never reads
it — it fetches over TLS and extracts directly) plus the release-wide
`commit.txt`, `install.sh`, `uninstall.sh`.

## Train 2 — the runtime (JSR)

`publish-keep.yml`: pushes touching `keep/**` on main run a pure JSR publish
of `@mrg-keystone/rune` via a reusable workflow. Mechanics (documented in
`keep/README.md` → Releasing):

- A **preflight** (`keep/scripts/check-jsr-deps.ts` + `deno publish
  --dry-run`) emulates JSR's server-side dependency validation locally, so bad
  packages fail in seconds instead of after a ~10-minute server round trip.
- If `keep/deno.json`'s version isn't on JSR yet it publishes as-is; otherwise
  the next version is derived from the latest published one by commit
  conventions over the **triggering push's commits** (**patch** default,
  **minor** when the push contains a `feat:` commit, **major** on
  `!:`/`BREAKING CHANGE` — the range as `keep/README.md` documents it; the
  scan itself is implemented in the external reusable workflow in
  `mrg-keystone/actions`, to which `publish-keep.yml` passes no commit range),
  the bumped version is published, and the bump lands
  back on main as a `release: vX (auto-bump)` commit. That commit cannot
  restart the cycle, because the loop terminates at the trigger layer, not in
  the version branches: `publish-keep.yml` hands the reusable only the `JSR_TOKEN` secret (plus a
  `working-directory: keep` input)
  and grants `contents: write` to the run's `GITHUB_TOKEN`, so the auto-bump
  commit is pushed as `GITHUB_TOKEN` — and GitHub never starts workflow runs
  for a `GITHUB_TOKEN` push (the same platform rule the pin job in
  `release-rune.yml` designs around). No second publish run fires, so the two
  branches above only ever see human pushes — an already-published version at
  HEAD always means "derive the next bump", never "the bump echoing back".
  And the commit touches only `keep/**` — squarely inside `release-rune.yml`'s
  `paths-ignore` — so it could **not** rebuild rune either way.
- The publish step polls the JSR API rather than trusting the CLI. **Never
  cancel a publish run that looks hung** — JSR holds the package transaction
  lock across client disconnects, so a killed run wedges the next attempt too.
  A real task failure surfaces its error within ~20 seconds of polling; a
  longer silence is server-side processing, which has taken ~22 minutes for
  this package. How long the poll waits before giving up is the reusable's own
  timeout (defined in `mrg-keystone/actions`, not this repo); a task still
  stuck when it expires can be requeued from the package's publishing-tasks
  page on jsr.io.

**Release order for coupled changes: keep first, then rune** — generated
projects pin keep's published JSR package, so any keep feature rune's
generated code depends on must be live on JSR before rune releases.

## Install / uninstall

```sh
curl -fsSL https://github.com/mrg-keystone/rune/releases/download/latest/install.sh | sh
```

- **Idempotent by construction**: uninstall-first — the installer fetches
  `uninstall.sh` (from the release being installed; the repo at `RUNE_REF`,
  default `main`, is only a fallback for releases that predate the asset) and
  runs it with uninstall's full semantics below: the binaries `rune`,
  `rune-lsp`, `rune-syntax` purged from every known location — `~/.deno/bin`,
  `~/.cargo/bin`, `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin` —
  plain `rm -f` per path (no `brew` command is ever invoked), plus the two
  legacy skill layouts. When neither fetch succeeds (offline, or
  `uninstall.sh` published nowhere), an inline **offline fallback purge**
  removes the binaries only, from those same locations. Then one fresh copy
  into `~/.deno/bin` (or `RUNE_INSTALL=<dir>`). No Deno or Rust toolchain
  required.
- Resolves the release tag directly (never the GitHub "latest release" API,
  which is unreliable mid-deploy). `RUNE_VERSION` **is** the release tag,
  used verbatim — no mapping, no validation: unset → `latest`;
  `RUNE_VERSION=v0.1.0` pins a snapshot; `RUNE_VERSION=beta` installs the
  rolling develop channel (`beta` is that channel's tag — Train 1 — so
  `RUNE_VERSION=develop` matches no release and 404s at download).
- Installs the Claude skills into `~/.claude/skills/rune:*/` and agents into
  `~/.claude/agents/` (skipped when `~/.claude` doesn't exist), cleaning up
  the legacy layouts: the pre-split monolith `~/.claude/skills/rune/` folder
  (removed whole, `rm -rf` — its triggers would collide with the `rune:*`
  set), the retired standalone `keep` skill (folded into the rune skills —
  removed by the uninstall-first step, not by install code of its own, with
  uninstall's semantics below; the offline fallback purge covers binaries
  only, so it survives an offline install), and symlinked skill dirs from the old README setup (unlinked, never
  followed into a checkout). On macOS it de-quarantines the binaries.
- `--dev` mode (`deno task install`) compiles from the checkout instead —
  binaries, skills, and agents straight from source.
- `rune update [tag]` (alias `upgrade`) re-runs the installer, forwarding
  the optional tag verbatim as `RUNE_VERSION` — same tag set: `latest`
  (default), `beta`, or a pinned `vX.Y.Z`. The installer script itself is
  fetched from the **target release's own** `install.sh` asset first (so its
  logic is version-matched to what it installs), falling back to
  `scripts/install.sh` on the repo's `main` branch only for releases that
  predate the asset; if both fetches fail, update errors out without running
  anything.
- Uninstall: the released `uninstall.sh` or `deno task uninstall` — removes
  the binaries from every known location plus the two legacy skill layouts:
  the pre-split `~/.claude/skills/rune/` monolith — unlinked if a symlink,
  else just its managed `SKILL.md` + `references/`, the folder itself only
  once empty (narrower than install's whole-folder `rm -rf` by design:
  anything else in the folder is the user's) — and the retired standalone
  `keep` skill: `~/.claude/skills/keep/` removed whole (`rm -rf`), but only
  when it is a real directory — a symlinked `keep` is left untouched, never
  unlinked or followed. It removes nothing else under `~/.claude`: the namespaced
  `rune:*` skills and the installed agents stay put — uninstall never touches
  `~/.claude/agents/`; both are only ever replaced, entry by entry, by the
  next install (which itself starts with this same uninstall).

## Build from source

```sh
deno task build       # setup (config + gen-shape-docs + gen-version) → deno compile →
                      # cargo build --release → dist/{rune,rune-lsp,rune-syntax}
deno task install     # build from this checkout straight into ~/.deno/bin
```

Build-time generators. `deno task setup` is exactly the three steps the code
block names — `src/bootstrap/config.ts` ("config": `which`-resolves the
configured LSP command — `deno lsp` by default, so the binary it looks up is
`deno`, never the yet-unbuilt `rune-lsp` — failing the build (exit 1) when it
isn't on PATH, and writes the generated `src/core/dto/lsp-config.ts` carrying
the bare command name, not the resolved path),
`gen-shape-docs.ts` (`docs/canonical-shape.md` from the artifact), and
`gen-version.ts` (the version stamp — with no `RUNE_VERSION_OVERRIDE`, the
source-build default, it stamps `keep/deno.json`'s semver as the version and
`git rev-parse HEAD` as the commit, `unknown` when either is unavailable) —
and CI's build job runs the same three inline before compiling. The
drift-gated generators —
`gen-artifact-schema.ts`, `gen-codegen-templates.ts`, and `generate.mjs`
(grammar + highlights; `deno task gen`) — are **not** part of `setup` or the
release build: they are re-run by hand when their inputs change, and
`deno task verify` gates their outputs against drift
([10-testing-and-verification.md](10-testing-and-verification.md)).
`.infra/git.json` is **not** a build input or output: it is deploy metadata
(repo/commit/branch/buildTime) written and committed by the external `ship`
promote tool — the `stamp: git <sha> → main (deploy metadata)` commits.
Neither `gen-version.ts` nor `rune -v` reads it; `ship` itself is out of
scope for this spec.
