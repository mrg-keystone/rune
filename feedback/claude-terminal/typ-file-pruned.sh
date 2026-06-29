#!/usr/bin/env bash
# Repro — BUG: `rune sync`'s prune deletes a disambiguated `<typ>-type.ts` file on a
# re-sync, but `rune lint` then demands that same file back. sync and lint disagree.
#
# Setup: a [TYP] whose name collides with a same-stem [DTO] (e.g. `[TYP] channel` +
# `[DTO] ChannelDto`). rune writes the type to dto/channel-type.ts so it doesn't
# clobber the DTO's dto/channel.ts. The first sync creates it; the SECOND sync prunes
# it as an "orphan" (no --force needed); then `rune lint` reports it missing.
#
# Hermetic: builds a throwaway project in a temp dir and cleans up. Needs `rune` on PATH.
set -u
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "rune: $(rune -v 2>&1 | head -1)"
cd "$WORK"; rune init demo >/dev/null 2>&1; cd demo

cat > spec/runes/widget.rune <<'RUNE'
[MOD] widget
[ENT] http.make(MakeDto): ChannelDto
[REQ] widget.make(MakeDto): ChannelDto
    [NEW] widget
    widget.toDto(): ChannelDto
[TYP:nonempty,example=main] channel: string
    a channel name — SAME STEM as ChannelDto, so its TYP file is disambiguated
[TYP] attached: boolean
    whether the channel attached
[DTO] MakeDto: channel
    input
[DTO] ChannelDto: channel, attached
    output (collides with [TYP] channel)
[NON] widget
    a widget
RUNE

rune sync spec/runes/widget.rune --no-run >/dev/null 2>&1
echo
echo "after sync #1 — dto/ channel files:"
ls src/widget/dto | grep channel | sed 's/^/   /'
echo "   lint missing-TYP complaints: $(rune lint src 2>&1 | grep -c 'channel-type')  (0 = fine)"

echo
echo "--- re-sync the SAME module (plain sync, NO --force) ---"
rune sync src/widget/widget.rune --no-run 2>&1 | grep -iE 'prune' | sed 's/^/   /'
echo "after sync #2 — dto/ channel files:"
ls src/widget/dto | grep channel | sed 's/^/   /'

echo
echo "BUG — lint now demands the file sync just pruned:"
rune lint src 2>&1 | grep -iE 'Missing TYP|channel-type' | sed 's/^/   /' \
  || echo "   (no missing-TYP error — bug appears fixed)"
