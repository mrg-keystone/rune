## Train 1 — the rune toolchain (GitHub releases)

`release-rune.yml`:

| Trigger | Release(s) cut | Git tag(s) | Version source | `rune -v` stamp |
| --- | --- | --- | --- | --- |
| Push to `main` | Rolling `latest` (what `install.sh` pulls) **and** a pinned `vX.Y.Z` snapshot, same run, byte-identical artifacts | `latest` (rolling, moved) + new `vX.Y.Z` | Next free patch seeded from `keep/deno.json`'s semver — the seed itself is tried first, then the patch increments past any `vX.Y.Z` with an existing tag or release, so a `main` release can land exactly on keep's version | That version, `v` stripped (e.g. `1.4.1`) |
| Push to `develop` | Rolling develop-channel release | `beta` (rolling — a tag named `develop` would shadow the branch) | `keep/deno.json`'s semver, binary stamp only (no version job–assigned tag) | `keep/deno.json`'s semver, `v` stripped |
| Push of a `v*` tag | Pinned snapshot | That tag, verbatim | The tag, verbatim | The tag, `v` stripped (`v1.2.3` → `1.2.3`) |
| Other build-triggering push (any branch/ref besides `main`/`develop`, no `v*` tag) | None — build runs, no release or pin | None | `keep/deno.json`'s semver, binary stamp only — same as `develop`, since no tag is cut for this trigger either way | `keep/deno.json`'s semver, `v` stripped |
| `paths-ignore`-only push (touches only `keep/`, `e2e/`, `examples/`, `docs/`, `todos/`) | None — build skipped entirely | None | n/a | n/a |

`paths-ignore` is the trigger's sole path filter: only pushes touching
**exclusively** those runtime-owned / non-binary facets skip the build.
Anything else builds — the binary inputs (`src/`, `lang/`, `claude/`,
`scripts/`) but equally root files (`deno.json`, `README.md`, the workflows
themselves) that the ignore list doesn't cover.

Jobs: **version** → **build** → **meta** → **release** + **pin**.

| Job | Role | Key input | Key output |
| --- | --- | --- | --- |
| **version** | Resolves this run's release version | Trigger type + `keep/deno.json`'s semver + existing tags/releases (see the trigger table above) | One version string, consumed by the binary stamp and by **release**/**pin** |
| **build** | Compiles the toolchain | matrix: Apple-silicon + Intel macOS, Linux x86-64; `deno compile` for `rune`, `cargo build` for `rune-lsp`/`rune-syntax`; ad-hoc codesign on macOS | Three per-target binaries, stamped with **version**'s output |
| **meta** | Records the build's provenance | `GITHUB_SHA` | `commit.txt` — the staleness marker `rune -v` checks; an asset, not the tag, because rolling releases freeze the tag but swap assets |
| **release** | Cuts the rolling release(s) this trigger calls for | **version** + **build** + **meta**'s outputs | `latest` and/or `beta` — tag moved, assets swapped |
| **pin** | Cuts the pinned `vX.Y.Z` snapshot (`main`/`v*` triggers only) | **version** + **build** + **meta**'s outputs | A pinned release — byte-identical artifacts to **release**'s |

On a `main` trigger, **pin** pushes the new `vX.Y.Z` tag using `GITHUB_TOKEN`.
A `GITHUB_TOKEN`-authored push never starts a new workflow run — the same
no-retrigger platform rule Train 2's anti-recursion depends on — so this
push does not re-fire Train 1, despite matching the "push of a `v*` tag" row
in the trigger table above; that row governs only tags pushed by other
means (e.g. a human pushing a tag directly).

**Example — a push to `main`:** `keep/deno.json` is at `1.4.0`, and tag
`v1.4.0` already exists (a prior release claimed it). The version job tries
`1.4.0` first, finds it taken, and yields `1.4.1`. Build compiles the three
binaries (`rune`, `rune-lsp`, `rune-syntax`) for each of the three targets
(`aarch64-apple-darwin`, `x86_64-apple-darwin`,
`x86_64-unknown-linux-gnu`), one tarball per target. Meta writes `commit.txt`
from `GITHUB_SHA`. Release cuts the rolling `latest` release, and pin cuts
the pinned `v1.4.1` snapshot, in the same run — byte-identical artifacts;
each tarball holds its target's three binaries plus `skill/` and `agent/`.
On an installed machine, `rune -v` prints `1.4.1` — bare, no leading `v`.

**Version stamping:** the version job's output feeds `scripts/gen-version.ts`
as `RUNE_VERSION_OVERRIDE`, which writes the gitignored
`src/core/dto/version.gen.ts` baked into the binary. `gen-version.ts` strips
any leading `v` from `RUNE_VERSION_OVERRIDE` before stamping, so `rune -v`'s
version number is always printed bare (no leading `v`) on every trigger — the
pin tag itself still carries the `v` (`v1.2.3`), only the stamped/printed
version never does (`1.2.3`); see the trigger table above for what each
trigger stamps. The same generated file bakes the build commit and the UTC
build time; the latter is `RUNE_BUILT_AT_OVERRIDE`'s target — like
`RUNE_VERSION_OVERRIDE`, it's read by `scripts/gen-version.ts` and, when
set, overrides the baked UTC build time. The commit (`GITHUB_SHA` in CI) is
the binary-side half of the
staleness check — `rune -v` fetches the `latest` release's `commit.txt` (the
meta job writes it from the same `GITHUB_SHA`) and nags on any mismatch. The
check is channel-unaware: the fetch target is always `latest`, regardless of
which channel the installed binary came from. Its outcomes:

| Install channel | Nag behavior | Meaning |
| --- | --- | --- |
| `latest` (fresh) | Never nags | Its own commit always matches `latest`'s `commit.txt` |
| `beta` (develop channel) | Nags whenever its commit differs from `latest`'s current build | "A newer `latest` exists" — not "your channel has an update" |
| Pinned snapshot (`vX.Y.Z`) | Nags whenever its commit differs from `latest`'s current build | Same as `beta` — "a newer `latest` exists" |
| Source build (`unknown` commit) | Never nags | Unknown data never nags (never cry wolf) |
| Offline (fetch fails) | Never nags | No data to compare against |
| Pre-`commit.txt` release (404) | Never nags | No data to compare against |

**Artifacts per target:** one `rune-<target>.tar.gz` per build-matrix target —
`<target>` is the matrix's Rust triple: `aarch64-apple-darwin`,
`x86_64-apple-darwin`, or `x86_64-unknown-linux-gnu`, the exact strings
`install.sh` maps `uname -s`-`uname -m` onto (`Darwin-arm64`,
`Darwin-x86_64`, `Linux-x86_64`/`Linux-amd64`; any other platform exits
pointing at the build-from-source path).

```
rune-<target>.tar.gz              # exactly these five entries
├── rune                          # deno compile
├── rune-lsp                      # cargo build
├── rune-syntax                   # cargo build
├── skill/                        # every rune:* skill folder
└── agent/                        # the agent fleet

release (sibling assets, one set per release — not inside any tarball)
├── rune-<target>.tar.gz.sha256   # one per tarball, out-of-band verification only —
│                                 # install.sh fetches over TLS and extracts directly, never reads it
├── commit.txt                    # release-wide staleness marker (see Version stamping)
├── install.sh                    # release-wide
└── uninstall.sh                  # release-wide
```

`skill/` and `agent/` are cut from the same commit as the binaries, so a
tarball's skills and agents are always version-matched to what it installs.
This build always ships a `skill/` dir; what `install.sh` does when
installing from an *older* tarball that predates it — the fallback cascade
down to a manifest fetch, a single hardcoded skill, or binaries-only — is
runtime-side install behavior, out of scope for this release pipeline; see
[09-claude-skills/03-distribution.md](../09-claude-skills/03-distribution.md)
for that cascade in full.

