#!/usr/bin/env sh
# Install the rune CLI (rune + rune-lsp + rune-syntax) from GitHub Releases,
# plus the rune Claude Code skills (rune:spec, rune:build, rune:framework,
# rune:cake, rune:docs) into user scope (~/.claude/skills/). Between them the
# skills cover both layers — spec authoring and the generated runtime.
#
# Installs CLEANLY: it first UNINSTALLS any existing rune (every known location),
# then installs one fresh copy — so you never accumulate stale/duplicate binaries.
#
#   curl -fsSL https://github.com/mrg-keystone/rune/releases/download/latest/install.sh | sh
#
# Local dev build (compile from THIS checkout, skip the GitHub release):
#   deno task install        (= sh scripts/install.sh --dev)
#
# Options (env vars):
#   RUNE_INSTALL        install dir (default: ~/.deno/bin)
#   RUNE_VERSION        tag to install (default: latest release; e.g. develop, v0.1.0)
#   RUNE_REF            fallback ref for uninstall.sh + the skill, used only for
#                       releases that predate those assets (default: main)
#   CLAUDE_SKILLS_DIR   Claude Code skills dir (default: ~/.claude/skills)
#
# Prerequisite: `deno` on your PATH — the linter's type-aware rules spawn
# `deno lsp`. Set SHAPE_NO_LSP=1 to skip them.
set -eu

REPO="mrg-keystone/rune"
BINDIR="${RUNE_INSTALL:-$HOME/.deno/bin}"
RUNE_REF="${RUNE_REF:-main}"
# The binaries this installer manages. Add a fourth here and every loop below
# (purge / chmod / xattr / codesign) picks it up — no other edit needed.
BINS="rune rune-lsp rune-syntax"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"

# The release tag to install. The rolling release is ALWAYS tagged `latest`;
# pinned snapshots use their v* tag. Resolve directly — never via the GitHub
# "latest release" API, which is unreliable mid-deploy (it briefly returns an
# older pinned tag while `latest` is rebuilding). Resolved up front because the
# release is the source of truth for every asset below (binaries, uninstall.sh,
# the skill), so each fetch is version-matched to the tag being installed.
tag="${RUNE_VERSION:-latest}"

# install_skill <src skill dir> [name] — install/UPDATE one Claude Code skill
# into user scope by BASE-LEVEL REPLACE: the skill folder is the base unit, so
# its destination is removed and re-copied whole. This is the spread merge
#   skillFolder = { ...skillFolder, ...toInstall }
# applied one key at a time — the named skill is replaced outright; every other
# skill already in $SKILLS_DIR is left untouched. `name` defaults to the source
# dir's basename. A symlinked dest (the old README setup) is unlinked first so
# we never write through the link into a checkout.
install_skill() {
  src="$1"
  name="${2:-$(basename "$src")}"
  dst="$SKILLS_DIR/$name"
  [ -e "$src/SKILL.md" ] || { echo "rune: '$src' has no SKILL.md — skipping." >&2; return 0; }
  [ -L "$dst" ] && rm -f "$dst"
  rm -rf "$dst"
  cp -R "$src" "$dst"
  echo "Installed the $name skill -> $dst/"
}

# install_skills <dir of skill folders> — install/update EVERY skill under a
# skills/ dir (the `toInstall` operand), each via base-level replace. Skipped
# wholesale when ~/.claude is absent (no Claude Code on this machine).
install_skills() {
  if [ ! -d "$HOME/.claude" ]; then
    echo "rune: ~/.claude not found — skipping the Claude Code skills."
    return 0
  fi
  mkdir -p "$SKILLS_DIR"
  # Cutover: the monolith `rune` skill was split into rune:spec/build/framework/
  # cake/docs. Remove a stale colon-less `rune` so it can't linger as a sixth
  # skill whose triggers collide with the five (harmless if it was never there).
  [ -d "$SKILLS_DIR/rune" ] && rm -rf "$SKILLS_DIR/rune"
  for d in "$1"/*/; do
    [ -d "$d" ] || continue
    install_skill "${d%/}"
  done
}

# --dev: build + install from this local checkout instead of a GitHub release.
DEV=0
for a in "$@"; do [ "$a" = "--dev" ] && DEV=1; done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- 1. Uninstall any prior copy first (install = uninstall + fresh install) ---
# uninstall.sh comes from the release being installed; the repo at $RUNE_REF is
# only a fallback for releases that predate the standalone asset.
echo "Removing any existing rune install…"
if curl -fsSL "https://github.com/$REPO/releases/download/$tag/uninstall.sh" \
     -o "$tmp/uninstall.sh" 2>/dev/null ||
   curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/scripts/uninstall.sh" \
     -o "$tmp/uninstall.sh" 2>/dev/null; then
  RUNE_INSTALL="$BINDIR" sh "$tmp/uninstall.sh" || true
else
  # Fallback (offline, or uninstall.sh not yet published): purge known locations.
  for d in "$BINDIR" "$HOME/.deno/bin" "$HOME/.cargo/bin" "$HOME/.local/bin" \
           /usr/local/bin /opt/homebrew/bin; do
    for b in $BINS; do rm -f "$d/$b" 2>/dev/null || true; done
  done
fi

# --- 1b. --dev: compile + install from the local checkout (no release needed) ---
if [ "$DEV" = "1" ]; then
  # The script lives in <repo>/scripts/, so the checkout root is one level up.
  repo="$(cd "$(dirname "$0")/.." && pwd)"
  [ -f "$repo/src/bootstrap/mod.ts" ] || {
    echo "rune: --dev must be run as \`deno task install\` (or" >&2
    echo "      \`sh scripts/install.sh --dev\`) from a rune checkout" >&2
    echo "      (no src/bootstrap/mod.ts found at $repo)." >&2
    exit 1
  }
  command -v deno >/dev/null 2>&1 || { echo "rune: --dev needs deno on PATH." >&2; exit 1; }
  command -v cargo >/dev/null 2>&1 || { echo "rune: --dev needs cargo (rust) on PATH." >&2; exit 1; }
  mkdir -p "$BINDIR"

  echo "Compiling rune from source…"
  deno compile --allow-read --allow-write --allow-net --allow-env --allow-run \
    --config "$repo/deno.json" -o "$BINDIR/rune" "$repo/src/bootstrap/mod.ts"

  # Rust helpers only change with the Rust sources — reuse an existing build.
  if [ ! -x "$repo/lang/target/release/rune-lsp" ] ||
     [ ! -x "$repo/lang/target/release/rune-syntax" ]; then
    echo "Building rust helpers (rune-lsp, rune-syntax)…"
    ( cd "$repo/lang" && cargo build --release )
  fi
  cp "$repo/lang/target/release/rune-lsp" \
     "$repo/lang/target/release/rune-syntax" "$BINDIR/"

  if [ "$(uname -s)" = "Darwin" ]; then
    for b in $BINS; do codesign -f -s - "$BINDIR/$b" 2>/dev/null || true; done
  fi
  install_skills "$repo/skills"
  echo "Installed rune (dev build from $repo) -> $BINDIR"
  command -v deno >/dev/null 2>&1 && echo "Run: rune --help"
  exit 0
fi

# --- 2. Pick the prebuilt for this platform ---
os="$(uname -s)"
arch="$(uname -m)"
case "$os-$arch" in
  Darwin-arm64) target="aarch64-apple-darwin" ;;
  Darwin-x86_64) target="x86_64-apple-darwin" ;;
  Linux-x86_64 | Linux-amd64) target="x86_64-unknown-linux-gnu" ;;
  *)
    echo "rune: no prebuilt binary for $os-$arch." >&2
    echo "Build from source: git clone https://github.com/$REPO && cd rune && deno task install" >&2
    exit 1
    ;;
esac

# --- 3. Download + install (the tag was resolved up top) ---
url="https://github.com/$REPO/releases/download/$tag/rune-$target.tar.gz"
echo "Downloading rune $tag ($target)…"
curl -fSL "$url" -o "$tmp/rune.tar.gz"

# Unpack to a staging dir (the tarball also carries the skill/ dir, which must
# not land in BINDIR), then move the binaries into place.
mkdir -p "$tmp/pkg" "$BINDIR"
tar -C "$tmp/pkg" -xzf "$tmp/rune.tar.gz"
for b in $BINS; do
  mv -f "$tmp/pkg/$b" "$BINDIR/$b"
  chmod +x "$BINDIR/$b"
done

# Let Gatekeeper run the freshly downloaded macOS binaries.
if [ "$os" = "Darwin" ]; then
  for b in $BINS; do xattr -d com.apple.quarantine "$BINDIR/$b" 2>/dev/null || true; done
fi

# The skills ship as a skill/ dir inside the release tarball, version-matched to
# the binaries — that dir CONTAINS all five skill folders (rune:spec, rune:build,
# rune:framework, rune:cake, rune:docs), so install_skills replaces each in turn.
# Fallback for releases that predate the dir: fetch skills/MANIFEST.txt from the
# repo at $RUNE_REF and curl each listed repo-relative path into a staging tree
# mirroring skills/, then install every folder under it.
if [ -d "$tmp/pkg/skill" ]; then
  install_skills "$tmp/pkg/skill"
elif curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/skills/MANIFEST.txt" \
       -o "$tmp/MANIFEST.txt" 2>/dev/null; then
  # Each line is a repo-relative path like skills/rune:spec/SKILL.md. Mirror the
  # skills/ layout under $tmp/skill so install_skills sees one folder per skill.
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    case "$path" in skills/*) rel="${path#skills/}" ;; *) continue ;; esac
    dst="$tmp/skill/$rel"
    mkdir -p "$(dirname "$dst")"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/$path" \
      -o "$dst" 2>/dev/null || true
  done < "$tmp/MANIFEST.txt"
  install_skills "$tmp/skill"
else
  # No manifest either — fetch just rune:spec/SKILL.md so something installs.
  mkdir -p "$tmp/skill/rune:spec"
  if curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/skills/rune:spec/SKILL.md" \
       -o "$tmp/skill/rune:spec/SKILL.md" 2>/dev/null; then
    install_skills "$tmp/skill"
    echo "rune: skills manifest unavailable — installed rune:spec only." >&2
  else
    echo "rune: could not fetch the rune skills — binaries installed, skills left as-is." >&2
  fi
fi

echo "Installed rune $tag -> $BINDIR"
case ":$PATH:" in
  *":$BINDIR:"*) ;;
  *) echo "NOTE: add $BINDIR to your PATH (e.g. export PATH=\"$BINDIR:\$PATH\")." ;;
esac
if command -v deno >/dev/null 2>&1; then
  echo "Run: rune --help"
else
  echo "NOTE: install Deno (https://deno.com) so rune's type-aware lint rules work."
fi
