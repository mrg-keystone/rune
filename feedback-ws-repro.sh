#!/usr/bin/env bash
# Repro: a WebSocket [ENT:ws] module can't run on a fresh `rune init` project.
# Reliably demonstrates BUG 1 (init pins the runtime too old for the CLI's own WS
# codegen). BUG 2 (the @^2 SwaggerBuilder crash on a WS controller) is documented
# with its real stack trace in feedback.md — it fires on every boot of a real @^2
# project with a [ENT:ws] module + default swagger; a throwaway `rune init` project
# can't reach it because `deno run bootstrap/mod.ts` there trips an unrelated deno
# graph quirk ("@/bootstrap/modules.ts not a dependency").
# Needs `rune` (CLI) on PATH. Hermetic: builds in a temp dir, cleans up.
set -u
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
echo "rune: $(rune -v 2>&1 | head -1)"

cd "$WORK"; rune init demo >/dev/null 2>&1; cd demo
cat > spec/runes/sock.rune <<'RUNE'
[MOD] sock
[ENT:ws] s @ /sock
    ping(PingDto): PongDto
[REQ] sock.ping(PingDto): PongDto
    [NEW] beat
    beat.fill(nonce): beat
    beat.toDto(): PongDto
[TYP:example=ping] nonce: string
    a ping nonce
[TYP] alive: boolean
    liveness reply
[DTO] PingDto: nonce
    a ping
[DTO] PongDto: nonce, alive
    a pong
[NON] beat
    a heartbeat
RUNE
rune check spec/runes/sock.rune >/dev/null 2>&1 && echo "spec: rune check OK"
rune sync spec/runes/sock.rune --no-run >/dev/null 2>&1 && echo "sync: generated the @WsEndpointController"

echo
echo "BUG 1 — \`rune init\` pins the runtime at @mrg-keystone/rune@^1, but the CLI"
echo "        generates WS controllers importing WsEndpoint/WsEndpointController,"
echo "        which only exist in @^2. So a fresh WS module fails to import:"
echo
timeout 25 deno run -A --unstable-kv bootstrap/mod.ts 2>&1 | grep -m1 -iE "WsEndpoint" \
  || echo "   (no WsEndpoint import error — BUG 1 appears fixed)"
echo
echo "(Fix BUG 1 by pinning @^2; then BUG 2 — see feedback.md — fires: the runtime"
echo " SwaggerBuilder crashes generating the OpenAPI doc for the WS controller.)"
