#!/usr/bin/env sh
# Install the rune CLI (rune + rune-lsp + rune-syntax) from GitHub Releases.
#
# Installs CLEANLY: it first UNINSTALLS any existing rune (every known location),
# then installs one fresh copy — so you never accumulate stale/duplicate binaries.
#
#   curl -fsSL https://raw.githubusercontent.com/mrg-keystone/rune/main/install.sh | sh
#
# Local dev build (compile from THIS checkout, skip the GitHub release):
#   ./install.sh --dev
#
# Options (env vars):
#   RUNE_INSTALL   install dir (default: ~/.deno/bin)
#   RUNE_VERSION   tag to install (default: latest release; e.g. develop, v0.1.0)
#   RUNE_REF       branch to fetch uninstall.sh from (default: main)
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

# --dev: build + install from this local checkout instead of a GitHub release.
DEV=0
for a in "$@"; do [ "$a" = "--dev" ] && DEV=1; done

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# --- 1. Uninstall any prior copy first (install = uninstall + fresh install) ---
echo "Removing any existing rune install…"
if curl -fsSL "https://raw.githubusercontent.com/$REPO/$RUNE_REF/uninstall.sh" \
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
  repo="$(cd "$(dirname "$0")" && pwd)"
  [ -f "$repo/src/bootstrap/mod.ts" ] || {
    echo "rune: --dev must be run as ./install.sh --dev from a rune checkout" >&2
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

# --- 3. Resolve the release tag ---
# The rolling release is ALWAYS tagged `latest`; pinned snapshots use their v* tag.
# Resolve directly — never via the GitHub "latest release" API, which is unreliable
# mid-deploy (it briefly returns an older pinned tag while `latest` is rebuilding).
tag="${RUNE_VERSION:-latest}"

# --- 4. Download + install ---
url="https://github.com/$REPO/releases/download/$tag/rune-$target.tar.gz"
echo "Downloading rune $tag ($target)…"
curl -fSL "$url" -o "$tmp/rune.tar.gz"

mkdir -p "$BINDIR"
tar -C "$BINDIR" -xzf "$tmp/rune.tar.gz"
for b in $BINS; do chmod +x "$BINDIR/$b"; done

# Let Gatekeeper run the freshly downloaded macOS binaries.
if [ "$os" = "Darwin" ]; then
  for b in $BINS; do xattr -d com.apple.quarantine "$BINDIR/$b" 2>/dev/null || true; done
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
