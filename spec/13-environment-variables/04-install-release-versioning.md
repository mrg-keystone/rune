## Install, release & versioning

Three separate audiences read these vars, and two near-homograph pairs cross
audience lines — disambiguated inline below. This table gives each var's
default, one-line purpose, and where it's read; the full mechanics behind
each install-time and release-time var live in the owning spec linked from
its row.

### Install-time (user-facing) — `install.sh` / `rune update`

Set by whoever runs the installer or `rune update`.

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `RUNE_INSTALL` | `~/.deno/bin` | The **shell installer's** bin dir — the three binaries land directly in it. Not to be confused with `RUNE_BIN` below, the separate Rust `rune-syntax install`'s bin dir. Full install sequence: [11-release-and-distribution/03-install-uninstall.md](../11-release-and-distribution/03-install-uninstall.md). | `install.sh`, `uninstall.sh`, `update/mod.ts` |
| `RUNE_REF` | `main` | Git ref the manifest-fallback cascade fetches skills from when a tarball has no `skill/` dir — a knob independent of `RUNE_VERSION`, which is exactly why an unmatched `RUNE_REF`/`RUNE_VERSION` pair is the distribution pipeline's one version-match break. Full fallback cascade and that break: [09-claude-skills/03-distribution.md](../09-claude-skills/03-distribution.md). Also the ref the install sequence's step 1 falls back to for fetching `uninstall.sh` itself, when the release being installed predates that asset: [11-release-and-distribution/03-install-uninstall.md](../11-release-and-distribution/03-install-uninstall.md). | `install.sh` |
| `RUNE_VERSION` | unset → `latest` | Pins the release tag `install.sh` installs, used verbatim — no mapping, no validation: unset resolves to `latest`, `v0.1.0` pins a snapshot, `beta` installs the rolling develop channel, `develop` matches no release and 404s. Pins the **download** — not to be confused with `RUNE_VERSION_OVERRIDE` below, which stamps the **build**. Full resolution rules and the install sequence they feed: [11-release-and-distribution/03-install-uninstall.md](../11-release-and-distribution/03-install-uninstall.md). | `install.sh` |

### Release/build-time (CI-only) — read by `scripts/gen-version.ts`

Set only by the release pipeline (`release-rune.yml`'s **version** job), never
by an installer or its user.

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `RUNE_VERSION_OVERRIDE` | — | Stamps an explicit version into the gitignored `src/core/dto/version.gen.ts` (leading `v` stripped, so `rune -v` always prints bare). Stamps the **build** — not to be confused with `RUNE_VERSION` above, which pins the **download**. Full stamping mechanics and the per-trigger version table: [11-release-and-distribution/01-train-1-the-rune-toolchain-github-releases.md](../11-release-and-distribution/01-train-1-the-rune-toolchain-github-releases.md). | `scripts/gen-version.ts` |
| `RUNE_BUILT_AT_OVERRIDE` | — | Stamps an explicit build timestamp into `version.gen.ts`, overriding the baked UTC build time — stamping mechanics live in `scripts/gen-version.ts` itself; [11-release-and-distribution/01-train-1-the-rune-toolchain-github-releases.md](../11-release-and-distribution/01-train-1-the-rune-toolchain-github-releases.md) covers the release-side stamping and names this var. | `scripts/gen-version.ts` |
| `GITHUB_SHA` | — | CI-provided commit SHA baked into the version metadata by `scripts/gen-version.ts`, and separately written to `commit.txt` — the staleness marker `rune -v` fetches and compares against — by the **meta** job. Same owning spec as `RUNE_VERSION_OVERRIDE` above. | `scripts/gen-version.ts`, `release-rune.yml`'s **meta** job |

### The Rust `rune-syntax install`

Self-contained — no sibling spec owns this installer.

| Variable | Default | Purpose | Read at |
| --- | --- | --- | --- |
| `RUNE_BIN` | `~/.local/bin` | The Rust `rune-syntax install`'s target bin dir. Not to be confused with `RUNE_INSTALL` above, the shell installer's bin dir. | `lang/cli/src/commands/install.rs` |
| `RUNE_DATA` | platform data dir + `/rune` | The Rust `rune-syntax install`'s data dir (parsers, configs). | `lang/cli/src/commands/install.rs` |

