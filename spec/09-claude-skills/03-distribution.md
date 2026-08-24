## Distribution

A pinned `RUNE_VERSION` install gets the skills bundled in that tag's
tarball — version-matched by construction: the tarball's `skill/` and
`agent/` dirs are cut from the same commit as the binaries, so what lands in
`~/.claude/skills/` and `~/.claude/agents/` matches what was just installed.
Exactly one place breaks that guarantee: the manifest fallback (row 2 of the
table below), where skills are fetched from `RUNE_REF` — a knob independent
of `RUNE_VERSION` — instead of coming out of the pinned tarball. Everything
past that fallback level is downhill from the same break.

Release tarballs bundle the skills as `skill/` and agents as `agent/` dirs;
`scripts/install.sh` installs both via per-entry base-level replace — each
skill folder / agent entry is its own key, so only that entry's destination
is removed and re-copied (`rm -rf` + `cp -R` on the entry alone), while every
unrelated sibling already in `~/.claude/skills/` or `~/.claude/agents/` is
left untouched. It skips entirely when `~/.claude` doesn't exist. Legacy
layout cleanup, `--dev` mode, and `rune update` are shared install/uninstall
machinery, not specific to skills/agents — see
[11-release-and-distribution/03-install-uninstall.md](../11-release-and-distribution/03-install-uninstall.md)
for their full semantics. What follows here covers only what's unique to
skill/agent distribution: the fallback cascade below and its version-match
consequences.

When a tarball doesn't have a matching `skill/` dir, `install.sh` falls back
through the cascade below. Agents have no equivalent fallback — they install
only from a tarball's `agent/` dir, or not at all — which is why the agents
column goes to "none" a level earlier than skills does at every fallback
level:

| Level / trigger | Skills installed | Agents installed | Version-matched? |
| --- | --- | --- | --- |
| **1. `skill/` dir present** (normal release) | Every skill folder in the tarball's `skill/`, per-entry replace | Every agent entry in the tarball's `agent/` dir, per-entry replace — no `agent/` dir means no agents | Yes — bundled with the binaries in the same tarball |
| **2. `skill/` missing → `claude/skills/MANIFEST.txt`** | Every file listed in the manifest — one repo-relative file path per line, covering each skill's `SKILL.md` plus every bundled support file (`references/`, `scripts/`, and any other bundled support dir the skill ships), each curled individually (e.g. `claude/skills/rune:spec/SKILL.md`, `claude/skills/rune:spec/references/foo.md`, `claude/skills/rune:data/scripts/render_review.ts`) — fetched from the repo at `RUNE_REF` (default `main`) and curled file-by-file into a staging tree mirroring `claude/skills/` | none — no agent manifest exists | No, unless `RUNE_REF` is also set to the pinned tag |
| **3. Manifest unreachable → `rune:spec` alone** | `rune:spec`'s `SKILL.md` only — one hardcoded fetch from `RUNE_REF`'s raw path; with no manifest to enumerate `rune:spec`'s bundled support files, none of them are fetched | none | No, same as row 2 |
| **4. That fetch fails too → binaries-only** | none — skills left as-is | none — agents left as-is | N/A — nothing skill/agent-related is touched |

**Example — hitting the one break point:** `RUNE_VERSION=v0.1.0` pins a
snapshot that predates `skill/`, so row 1 doesn't apply. With `RUNE_REF`
unset, it defaults to `main`: row 2's manifest fetch pulls `main`'s skills
down next to `v0.1.0`'s binaries — an unmatched pair. Setting
`RUNE_REF=v0.1.0` alongside `RUNE_VERSION=v0.1.0` fetches the manifest, and
the skills it lists, from the same tag as the binaries, restoring the match.

