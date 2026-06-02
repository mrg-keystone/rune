#!/usr/bin/env sh
# Install the rune CLI (rune + rune-lsp + rune-syntax) from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/theTechGoose/rune/main/install.sh | sh
#
# Options (env vars):
#   RUNE_INSTALL   install dir (default: ~/.deno/bin)
#   RUNE_VERSION   tag to install (default: latest release)
#
# Prerequisite: `deno` on your PATH — the linter's type-aware rules spawn
# `deno lsp`. Set SHAPE_NO_LSP=1 to skip them.
set -eu

REPO="theTechGoose/rune"
BINDIR="${RUNE_INSTALL:-$HOME/.deno/bin}"

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

tag="${RUNE_VERSION:-}"
if [ -z "$tag" ]; then
  tag="$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -m1 '"tag_name"' | cut -d'"' -f4)"
fi
if [ -z "$tag" ]; then
  echo "rune: could not determine the latest release tag." >&2
  exit 1
fi

url="https://github.com/$REPO/releases/download/$tag/rune-$target.tar.gz"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "Downloading rune $tag ($target)…"
curl -fSL "$url" -o "$tmp/rune.tar.gz"

mkdir -p "$BINDIR"
tar -C "$BINDIR" -xzf "$tmp/rune.tar.gz"
chmod +x "$BINDIR/rune" "$BINDIR/rune-lsp" "$BINDIR/rune-syntax"

# Let Gatekeeper run the freshly downloaded macOS binaries.
if [ "$os" = "Darwin" ]; then
  xattr -dr com.apple.quarantine "$BINDIR/rune" "$BINDIR/rune-lsp" "$BINDIR/rune-syntax" 2>/dev/null || true
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
