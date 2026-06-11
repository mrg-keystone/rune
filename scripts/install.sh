#!/usr/bin/env sh
# Install the keep Claude Code skill into user scope (~/.claude/skills/keep).
#
# keep itself is a JSR library (jsr:@mrg-keystone/keep) — there is no binary
# to install. This installs the SKILL (SKILL.md + references/) so the
# assistant always matches the published framework.
#
#   curl -fsSL https://github.com/mrg-keystone/keep/releases/download/latest/install.sh | sh
#
# Local dev (install from THIS checkout, skip the GitHub release):
#   sh scripts/install.sh --dev
#
# Options (env vars):
#   KEEP_VERSION        release tag to install (default: latest; e.g. v1.17.0)
#   KEEP_REF            fallback git ref for releases that predate the skill
#                       tarball asset (default: main)
#   CLAUDE_SKILLS_DIR   Claude Code skills dir (default: ~/.claude/skills)
set -eu

REPO="mrg-keystone/keep"
KEEP_REF="${KEEP_REF:-main}"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
# Resolve the tag directly — never via the GitHub "latest release" API, which
# is unreliable mid-deploy. The rolling release is always tagged `latest`.
tag="${KEEP_VERSION:-latest}"

# install_skill <dir containing SKILL.md (+ references/)> — copy the managed
# files into user scope. Only SKILL.md and references/ are managed; anything
# else in the installed folder (evals/, notes) is the user's. A symlinked
# skill dir is replaced with a real dir so we never write through the link
# into someone's checkout.
install_skill() {
  if [ ! -d "$HOME/.claude" ]; then
    echo "keep: ~/.claude not found — no Claude Code on this machine; nothing to do."
    return 0
  fi
  [ -L "$SKILLS_DIR/keep" ] && rm -f "$SKILLS_DIR/keep"
  mkdir -p "$SKILLS_DIR/keep"
  cp "$1/SKILL.md" "$SKILLS_DIR/keep/SKILL.md"
  if [ -d "$1/references" ]; then
    rm -rf "$SKILLS_DIR/keep/references"
    cp -R "$1/references" "$SKILLS_DIR/keep/references"
  fi
  echo "Installed the keep skill -> $SKILLS_DIR/keep/"
}

# --dev: install from this local checkout.
for a in "$@"; do
  if [ "$a" = "--dev" ]; then
    repo="$(cd "$(dirname "$0")/.." && pwd)"
    [ -f "$repo/skills/keep/SKILL.md" ] || {
      echo "keep: --dev must run from a keep checkout (no skills/keep/SKILL.md at $repo)." >&2
      exit 1
    }
    install_skill "$repo/skills/keep"
    exit 0
  fi
done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The skill tarball is a release asset, version-matched to the tag. Fallback
# for releases that predate it: the repo tree at $KEEP_REF.
if curl -fsSL "https://github.com/$REPO/releases/download/$tag/keep-skill.tar.gz" \
     -o "$tmp/keep-skill.tar.gz" 2>/dev/null; then
  mkdir -p "$tmp/pkg"
  tar -C "$tmp/pkg" -xzf "$tmp/keep-skill.tar.gz"
  install_skill "$tmp/pkg"
else
  echo "keep: release asset not found for tag '$tag' — falling back to the repo at $KEEP_REF."
  mkdir -p "$tmp/pkg/references"
  curl -fsSL "https://raw.githubusercontent.com/$REPO/$KEEP_REF/skills/keep/SKILL.md" \
    -o "$tmp/pkg/SKILL.md"
  for ref in process auth deployment; do
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$KEEP_REF/skills/keep/references/$ref.md" \
      -o "$tmp/pkg/references/$ref.md"
  done
  install_skill "$tmp/pkg"
fi

echo "keep skill $tag installed. The framework itself comes from JSR: jsr:@mrg-keystone/keep"
