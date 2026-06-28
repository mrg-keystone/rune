#!/usr/bin/env bash
# Repro: `rune sync` mis-infers the project root and reports it as a SPEC error
# ("undeclared service …") instead of a root-resolution error. Hermetic: builds a
# throwaway nested project in a temp dir, runs three cases, cleans up. Needs `rune`
# on PATH (override with RUNE=/path/to/rune).
set -u
RUNE="${RUNE:-rune}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT; cd "$WORK"

# Nested rune project at server/ (like a cogasaur app): core lives at server/src/core.
mkdir -p server/src/core server/spec/runes spec/runes
cat > server/src/core/core.rune <<'EOF'
[MOD] core
[SRV] (SIDECAR)db: DB_URL
    the datastore
    @docs https://example.com/db
EOF
FOO='[MOD] foo
[ENT] http.make(MakeDto): FooDto
[REQ] foo.make(MakeDto): FooDto
    db:foo.save(FooDto): void
      write-failed
    foo.toDto(): FooDto
[TYP:nonempty] name: string
    a name
[DTO] MakeDto: name
    input
[DTO] FooDto: name
    output
[NON] foo
    a foo'
printf '%s\n' "$FOO" > server/spec/runes/foo.rune   # staged INSIDE the project
printf '%s\n' "$FOO" > spec/runes/foo.rune          # staged at the REPO ROOT (above server/)

echo "rune: $($RUNE -v 2>&1 | head -1)"; echo "workdir: $WORK"; echo
echo "### A) spec inside project (server/spec/runes), NO --root  → expect OK"
"$RUNE" sync server/spec/runes/foo.rune --dry-run 2>&1 | sed -n '1,4p'
echo
echo "### B) same spec at repo root (spec/runes), NO --root  → expect MISLEADING 'undeclared service db'"
"$RUNE" sync spec/runes/foo.rune --dry-run 2>&1 | sed -n '1,3p'
echo
echo "### C) repo-root spec + --root server  → expect OK"
"$RUNE" sync spec/runes/foo.rune --root server --dry-run 2>&1 | sed -n '1,4p'
