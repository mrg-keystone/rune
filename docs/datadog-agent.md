# Datadog Agent for trace ingestion (OTLP) — deployment runbook

keep ships finished request traces as **OTLP/JSON** to an endpoint
(`KEEP_TRACE_OTLP_URL`). That endpoint is a **Datadog Agent** running the OTLP
HTTP receiver, which forwards to Datadog APM. This doc records the live
deployment and how to operate it.

> The trace **shipper** (keep side) is documented in the README under
> "Request tracing → Shipping to an APM". This file is the **infra** side.

## Live deployment

| | |
| --- | --- |
| Host | `srv1049775.hstgr.cloud` (Hostinger VPS, `72.60.169.192`) — chosen as the lowest-usage box |
| Compose project | `datadog-agent` (`/docker/datadog-agent/docker-compose.yml`) |
| Network | joins the existing **`n8n_default`** network (external) so the box's Traefik can route to it — the `n8n` project is **untouched** |
| Image | `gcr.io/datadoghq/agent:7`, `DD_SITE=us5.datadoghq.com`, APM + OTLP HTTP on `:4318` |
| Public endpoint | `https://otlp.srv1049775.hstgr.cloud/v1/traces` |
| TLS | Let's Encrypt via the box's existing Traefik `mytlschallenge` resolver |

### Security model

- The Agent publishes **no host ports** — `:4318` is reachable only through
  Traefik on the `n8n_default` docker network.
- The Traefik router matches **only** requests carrying the secret header
  `X-Keep-Token: <token>`. No header → no route → `404` (the endpoint isn't even
  revealed). keep sends this header via `KEEP_TRACE_OTLP_TOKEN`.
- The token is the **only** thing between the public internet and your Datadog
  ingestion (an open OTLP intake has no auth of its own). Treat it as a secret;
  rotate if leaked (see below). The token value is **not** stored in this repo —
  it lives in the VPS project's environment and in the keep app's
  `KEEP_TRACE_OTLP_TOKEN`.

### docker-compose

```yaml
services:
  agent:
    image: gcr.io/datadoghq/agent:7
    restart: always
    environment:
      - DD_API_KEY=${DD_API_KEY}
      - DD_SITE=us5.datadoghq.com
      - DD_APM_ENABLED=true
      - DD_APM_NON_LOCAL_TRAFFIC=true
      - DD_OTLP_CONFIG_RECEIVER_PROTOCOLS_HTTP_ENDPOINT=0.0.0.0:4318
      - DD_HOSTNAME=keep-otlp-agent
      - DD_LOG_LEVEL=warn
      - DD_INVENTORIES_ENABLED=false
    labels:
      - traefik.enable=true
      - traefik.docker.network=n8n_default
      - "traefik.http.routers.ddotlp.rule=Host(`otlp.srv1049775.hstgr.cloud`) && Header(`X-Keep-Token`, `${KEEP_TOKEN}`)"
      - traefik.http.routers.ddotlp.entrypoints=web,websecure
      - traefik.http.routers.ddotlp.tls=true
      - traefik.http.routers.ddotlp.tls.certresolver=mytlschallenge
      - traefik.http.services.ddotlp.loadbalancer.server.port=4318
    networks:
      - n8n_default
networks:
  n8n_default:
    external: true
```

Project environment (set on the VPS, not in the repo):

```
DD_API_KEY=<datadog API key for the us5 org>
KEEP_TOKEN=<the shared secret, == the app's KEEP_TRACE_OTLP_TOKEN>
```

Deployed via the Hostinger VPS API (`createNewProject`, project `datadog-agent`,
VM `1049775`). Redeploying with the same project name replaces it.

## keep app configuration

```bash
KEEP_TRACE_OTLP_URL=https://otlp.srv1049775.hstgr.cloud   # /v1/traces appended automatically
KEEP_TRACE_OTLP_TOKEN=<shared-secret>                     # == KEEP_TOKEN above
# Deno Deploy ships automatically; from a local run also set:
KEEP_DD_LOCAL=1
```

## Verify

```bash
URL=https://otlp.srv1049775.hstgr.cloud/v1/traces
TOKEN=<shared-secret>

# minimal OTLP/JSON trace
TID=$(openssl rand -hex 16); SID=$(openssl rand -hex 8); NOW=$(date +%s)
BODY='{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"smoke"}}]},"scopeSpans":[{"spans":[{"traceId":"'$TID'","spanId":"'$SID'","name":"smoke","kind":2,"startTimeUnixNano":"'$NOW'000000000","endTimeUnixNano":"'$NOW'000000000","status":{"code":0}}]}]}]}'

# guard: without the header → 404
curl -s -o /dev/null -w "no-token: %{http_code}\n" -X POST "$URL" -H 'content-type: application/json' -d "$BODY"
# delivery: with the header → 200 {"partialSuccess":{}}
curl -s -w "\nwith-token: %{http_code}\n" -X POST "$URL" -H 'content-type: application/json' -H "X-Keep-Token: $TOKEN" -d "$BODY"
```

Expected: `404` without the token, `200` with it. Then a real keep request with
`KEEP_TRACE_OTLP_URL`/`KEEP_TRACE_OTLP_TOKEN`/`KEEP_DD_LOCAL=1` should ship with
no `trace OTLP intake returned …` warning in the app log.

To eyeball the spans: **Datadog → APM → Traces**, filter by `service:<appName>`
and `env:local` / `env:production`. (Querying APM via the API needs a Datadog
**Application key** in addition to the API key.)

## Operations

- **Health / logs:** Hostinger VPS API — project `datadog-agent` on VM `1049775`
  (`getProjectList`, `getProjectLogs`). The container reports `healthy`. Noisy
  `WARN`/`ERROR` lines from `process-agent` / `system-probe` / `security-agent` /
  `agent-data-plane` are **expected and harmless** — those host-collection
  sub-agents need host mounts/capabilities this container intentionally doesn't
  grant. The **core agent** and **trace-agent** are what matter, and they run.
- **Rotate the token:** redeploy the `datadog-agent` project with a new
  `KEEP_TOKEN`, then update the app's `KEEP_TRACE_OTLP_TOKEN` to match.
- **Move boxes:** redeploy the project on another VM that runs the same Traefik
  setup; update DNS (`otlp.<host>`) and `KEEP_TRACE_OTLP_URL`. The compose
  assumes the box's Traefik uses the `mytlschallenge` resolver and a
  `<project>_default` network named `n8n_default` — adjust both if different.

## Defense in depth (optional)

The header guard is the primary control. Optionally add a Hostinger firewall
group on the VM allowing only inbound `80`/`443` (and SSH) so nothing else is
reachable even by IP.
