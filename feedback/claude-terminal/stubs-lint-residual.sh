#!/usr/bin/env bash
# Repro — BUG: `rune lint --strict` flags `bootstrap/stubs.ts`, a file that `rune sync`
# itself GENERATES (the ghost stub for an unproduced [TYP:ext] input) and that the
# generated `bootstrap/modules.ts` imports. rune's generator emits a file rune's linter
# rejects; you can't "move" it (sync regenerates it + the import breaks).
#
# Hermetic: builds a throwaway project in a temp dir and cleans up. Needs `rune` on PATH.
set -u
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "rune: $(rune -v 2>&1 | head -1)"
cd "$WORK"; rune init demo >/dev/null 2>&1; cd demo

# A module that CONSUMES a [TYP:ext] field nothing in the project produces -> rune sync
# generates bootstrap/stubs.ts (a ghost stub minting a placeholder for it).
cat > spec/runes/greet.rune <<'RUNE'
[MOD] greet
[ENT] http.hello(HelloDto): GreetingDto
[REQ] greet.hello(HelloDto): GreetingDto
    [NEW] greeting
    greeting.toDto(): GreetingDto
[TYP:ext,nonempty,example=m_123] memberId: string
    minted by another module — external input, no producer in this project
[TYP:nonempty,example=hi] text: string
    the greeting text
[DTO] HelloDto: memberId
    input carrying an external id
[DTO] GreetingDto: text
    the greeting
[NON] greeting
    a greeting
RUNE

rune sync spec/runes/greet.rune --no-run >/dev/null 2>&1
echo
echo "rune sync generated the ghost stub?  -> $([ -f bootstrap/stubs.ts ] && echo 'yes: bootstrap/stubs.ts' || echo no)"
echo "generated modules.ts imports it?     -> $(grep -c stubs bootstrap/modules.ts) import(s)"
echo
echo "BUG — rune lint --strict flags rune's own generated file:"
rune lint --strict . 2>&1 | grep -iE 'stubs\.ts|not allowed here' | sed 's/^/   /' \
  || echo "   (no stubs.ts violation — bug appears fixed)"
