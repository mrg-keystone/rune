#!/usr/bin/env bash
# Install the rune EDITOR tooling from source: the syntax helper (rune-syntax)
# + the language server (rune-lsp), then wire up editor integration.
#
# This is only the fast Rust side. For codegen + linting, install the `rune` CLI:
#   repo-root install.sh (prebuilt binaries), or `deno task install` from the root.
set -e

cd "$(dirname "$0")"

echo "Building and installing rune-syntax (parse/validate/format + editor installer)..."
cargo install --path cli 2>&1 | grep -v "^warning:" || true

echo "Building and installing rune-lsp (language server)..."
cargo install --path lsp 2>&1 | grep -v "^warning:" || true

echo
echo "Setting up editor integration..."
rune-syntax install -y
