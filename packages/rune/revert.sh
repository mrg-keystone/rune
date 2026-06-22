#!/usr/bin/env sh
# Restore fixtures/specs to EXACTLY the snapshot captured alongside this script
# (.fixtures-specs.snapshot.tgz). It wipes the current fixtures/specs entirely and
# replaces it with the snapshot — so anything added since (generated src/ trees,
# moved specs, etc.) is removed and the originals are restored byte-for-byte.
set -eu

root="$(cd "$(dirname "$0")" && pwd)"
snap="$root/.fixtures-specs.snapshot.tgz"

[ -f "$snap" ] || {
  echo "revert: snapshot not found: $snap" >&2
  exit 1
}

rm -rf "$root/fixtures/specs"
tar -xzf "$snap" -C "$root/fixtures"
echo "revert: fixtures/specs restored to snapshot:"
find "$root/fixtures/specs" -type f | sed "s|$root/||;s|^|  |"
