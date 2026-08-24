## Install / uninstall

### Entry points

Four entry points, one shared engine underneath:

- **Install (prebuilt):**
  ```sh
  curl -fsSL https://github.com/mrg-keystone/rune/releases/download/latest/install.sh | sh
  ```
- **Install (dev):** `deno task install` — the same engine, run as `--dev`:
  it swaps only the artifact source, compiling binaries and copying skills
  and agents straight from the checkout instead of a downloaded tarball;
  every other step below is unchanged.
- **Update:** `rune update [tag]` (alias `upgrade`) re-runs the installer,
  forwarding the optional tag verbatim as `RUNE_VERSION` — same tag set as
  below. The installer script is fetched from the **target release's own**
  `install.sh` asset first (so its logic is version-matched to what it
  installs), falling back to `scripts/install.sh` on the repo's `main`
  branch only for releases that predate the asset; if both fetches fail,
  `update` errors out without running anything. `update` is a thin wrapper —
  it has no install logic of its own.
- **Uninstall:** the released `uninstall.sh`, or `deno task uninstall` —
  runs the engine's uninstall half directly, without the extract/copy steps
  that follow it inside install.

Every path except direct uninstall funnels through the same engine, whose
first act is always to uninstall itself. **Install ⊇ uninstall** — that
containment is the main source of idempotency: installing twice, or
installing over a half-broken install, converges on the same state as
installing once. The one exception is offline: step 1 then runs the
narrower binaries-only purge instead of full uninstall semantics, so a real
`keep` directory is not removed the way a bare uninstall would remove it.
Idempotency still holds there, but it rests on that purge being
deterministic (same five locations, same `rm -f`, every time), not on
containment of uninstall's full behavior.

**Version resolution:** the tag installed is resolved directly, never
through the GitHub "latest release" API, which is unreliable mid-deploy.
`RUNE_VERSION` **is** the release tag, used verbatim — no mapping, no
validation: unset → `latest`; `RUNE_VERSION=v0.1.0` pins a snapshot;
`RUNE_VERSION=beta` installs the rolling develop channel
(`RUNE_VERSION=develop` matches no release and 404s at download — see
[Train 1](01-train-1-the-rune-toolchain-github-releases.md) for why `beta`,
not `develop`, is that channel's tag).

### Install sequence

The sequence below picks up after a platform-matched tarball is already in
hand: platform detection (`uname`-to-target-triple mapping), the download
itself, and the unsupported-platform exit to the build-from-source path are
covered in [Train 1](01-train-1-the-rune-toolchain-github-releases.md), not
here.

1. **Uninstall first.** Fetch and run `uninstall.sh` — from the release
   being installed, falling back to the repo at `RUNE_REF` (default `main`)
   only for releases that predate the asset — applying its full semantics
   (table below: binaries purged, monolith narrowed, `keep` removed if
   real). When neither fetch succeeds (offline, or `uninstall.sh` published
   nowhere for that release), run the inline **offline-fallback purge**
   instead: binaries only, from the same five locations, `rm -f`.
2. **Extract.** One fresh copy of the three binaries into `RUNE_INSTALL`
   (default `~/.deno/bin`). No Deno or Rust toolchain required.
3. **De-quarantine.** On macOS, clear the quarantine attribute on the
   freshly extracted binaries.
4. **Copy skills and agents.** Per-entry replace (`rm -rf` + `cp -R` on each
   entry alone) installs every `rune:*` skill folder into
   `~/.claude/skills/` and every agent into `~/.claude/agents/`, leaving
   unrelated siblings untouched; skipped entirely when `~/.claude` doesn't
   exist.
5. **Retire the monolith.** `rm -rf` the entire pre-split
   `~/.claude/skills/rune/` folder, whatever step 1 left behind — its
   triggers would collide with the `rune:*` set just installed. This is a
   second, independent touch of the monolith, not a contradiction of step
   1's narrower removal: step 1 is uninstall's own conservative pass
   (shared with a bare uninstall run), step 5 is install's own guarantee
   that the monolith is gone before the namespaced skills take over.

### What each target does

| Target | Install | Uninstall | Offline-fallback purge | Symlink handling |
| --- | --- | --- | --- | --- |
| **Binaries** — `rune`, `rune-lsp`, `rune-syntax` | Purged first via step 1; step 2 copies the fresh three into `RUNE_INSTALL` (default `~/.deno/bin`); step 3 de-quarantines them on macOS. | `rm -f` per path from all five known locations: `~/.deno/bin`, `~/.cargo/bin`, `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin` — no `brew` command is ever invoked. | *Is* the purge: same five locations, same `rm -f`, binaries only. | `rm -f` unlinks a symlinked binary the same as a regular file. |
| **Pre-split monolith** — `~/.claude/skills/rune/` | Step 1 narrows it (see Uninstall column); step 5 then `rm -rf`s whatever remains, unconditionally. | Unlinked if a symlink; else only its managed `SKILL.md` + `references/` are removed, and the folder itself only once empty — anything else a user put there survives. | Not covered (binaries only) — but install's step 5 still runs regardless of online/offline, so the monolith is gone by the end of an offline install too. A bare (non-install) uninstall run has no step 5, so it always stays at the narrower removal. | Unlinked, never followed — at both step 1 and step 5. |
| **Retired `keep` skill** — `~/.claude/skills/keep/` | Removed only via step 1; install has no independent step of its own for it (unlike the monolith's step 5). | `rm -rf` whole, but only when it is a real directory. | Not covered (binaries only), and install has no step-5 equivalent here — `keep` survives an offline install. | A symlinked `keep` is left completely untouched — never unlinked, never followed. |
| **Namespaced skills** — `~/.claude/skills/rune:*/` | Step 4: per-entry replace from the tarball's `skill/` dir (or the checkout, under `--dev`). Fallback cascade for tarballs missing `skill/`: [09-claude-skills/03-distribution.md](../09-claude-skills/03-distribution.md). Skipped entirely when `~/.claude` doesn't exist. | Untouched — uninstall never removes a `rune:*` folder; only the next install replaces it. | Not covered; unaffected either way. | n/a — entirely rune-managed, no legacy symlink case. |
| **Agents dir** — `~/.claude/agents/` | Step 4: per-entry replace from the tarball's `agent/` dir (or the checkout, under `--dev`) — no fallback cascade; a tarball with no `agent/` dir installs no agents. Skipped entirely when `~/.claude` doesn't exist. | Untouched — uninstall never touches `~/.claude/agents/`. | Not covered; unaffected either way. | n/a. |

Any other legacy symlinked skill dir found under `~/.claude/skills/` — left
over from the old README's manual-symlink setup, and not one of the four
skill/agent targets above — gets the same treatment: unlinked, never
followed into a checkout.

### Golden path — `rune update beta`

Tracing every path touched, in order, on a machine that already has a
`latest` install:

1. `rune update beta` re-runs the installer with `RUNE_VERSION=beta`; the
   installer script is fetched from that release's own `install.sh` asset —
   the develop channel's rolling `beta` tag (see
   [Train 1](01-train-1-the-rune-toolchain-github-releases.md) for what
   feeds that channel).
2. **Uninstall first** (step 1): the `beta` tarball's `uninstall.sh` runs,
   `rm -f`-ing `rune`, `rune-lsp`, `rune-syntax` out of `~/.deno/bin`,
   `~/.cargo/bin`, `~/.local/bin`, `/usr/local/bin`, `/opt/homebrew/bin`;
   removing only its managed `SKILL.md` + `references/` from
   `~/.claude/skills/rune/` (anything else a user put there survives), or
   unlinking it whole, if it's a symlink; `rm -rf`-ing `~/.claude/skills/keep/`
   if it's a real directory.
3. **Extract** (step 2): the `beta` tarball's three binaries land fresh in
   `RUNE_INSTALL` (`~/.deno/bin`, unset here).
4. **De-quarantine** (step 3): macOS clears the quarantine bit on all three.
5. **Copy skills and agents** (step 4): every `rune:*` folder from the
   tarball's `skill/` dir replaces its `~/.claude/skills/rune:*/`
   counterpart entry-by-entry; every agent from `agent/` replaces its
   `~/.claude/agents/` counterpart the same way.
6. **Retire the monolith** (step 5): whatever step 1's uninstall pass left of
   `~/.claude/skills/rune/` is `rm -rf`'d whole.

End state: `rune -v` reports the version stamped from `keep/deno.json`'s
semver (develop's binaries stamp that, not a `vX.Y.Z` tag), every `rune:*`
skill and agent is the `beta` build's copy, the monolith is gone outright
(unlinked if it was a symlink, `rm -rf`'d whole if real — step 5 makes no
exception), and `keep` is gone too — unless it was a symlink, in which case
the rules above leave it in place untouched.

### Post-conditions

**After install:**

- `rune`, `rune-lsp`, and `rune-syntax` each resolve to exactly one path,
  inside `RUNE_INSTALL` — no stale copy in any of the other four bin dirs
  answers first.
- `~/.claude/skills/rune/` (the monolith) does not exist.
- Every `rune:*` skill folder present matches the tarball or checkout just
  installed — except via the manifest-fallback cascade (row 2+ of
  [09-claude-skills/03-distribution.md](../09-claude-skills/03-distribution.md)'s
  table), where skills come from `RUNE_REF` (default `main`) and are
  version-matched only if `RUNE_REF` is pinned to the same tag as
  `RUNE_VERSION`.
- Every agent present matches the tarball or checkout just installed — true
  only when `~/.claude` existed before step 4 (step 4 is skipped entirely
  otherwise, so no `~/.claude/agents/` is ever created) and the tarball
  carried an `agent/` dir (an older tarball without one installs no agents,
  leaving any prior agent set stale).

**After uninstall:**

- No `rune`, `rune-lsp`, or `rune-syntax` binary remains in any of the five
  bin dirs.
- `~/.claude/agents/` and every `rune:*` skill folder are untouched —
  uninstall never reaches them.
- A symlinked `keep` is left exactly as found — never unlinked, never
  followed; a real `keep` directory is `rm -rf`'d whole and no longer
  exists.
- A symlinked monolith is unlinked (the link is gone; whatever it pointed at
  is untouched); a real monolith directory keeps anything beyond its
  managed `SKILL.md` + `references/`.

