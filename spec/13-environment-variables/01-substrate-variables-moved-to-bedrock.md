## Substrate variables — moved to bedrock

**The ownership principle:** a variable governs bedrock's layer-neutral
substrate — behavior a frontend-only app gets identically to keep, with
nothing backend-specific involved
([06-runtime/04](../06-runtime/04-logging-tracing-alerting.md)) — or it
governs keep's backend-specific behavior; never both. Of
[06-runtime/04](../06-runtime/04-logging-tracing-alerting.md)'s three
observability concerns — request/response logging (including `PORT` and the
Datadog gate), tracing, and the structured logger — all three are
layer-neutral substrate by that rule and move to bedrock; the docs module,
Part 3 ([06-runtime/05](../06-runtime/05-the-docs-surface-an-addable-module.md)),
stays here as keep's own — its `KEEP_DOCS` variable is specced in
[02-keep-runtime-serving-behavior.md](02-keep-runtime-serving-behavior.md).

bedrock's runtime code and keep's own code (the docs module, cake, heal,
fixtures) both live in-repo under the shared `keep/src/foundation/`
([01-architecture/04](../01-architecture/04-cross-boundary-contracts.md)) —
foundation is a shared root, not bedrock-exclusive — and bedrock ships
bundled inside the single published package (`@mrg-keystone/rune`, exporting
only `.` and `./assert` —
[06-runtime/07](../06-runtime/07-package-hygiene.md)) rather than as a
package of its own. bedrock's own reference doc is therefore a `## bedrock`
section of `keep/README.md`, not a standalone file under
`keep/src/foundation/`: bedrock has no source root of its own to host a
standalone README, and a section keeps the redirect target singular without
carving an exclusive space out of the shared foundation root. Every row
below redirects there, with one dormant exception noted in the table.

This table is a redirect index, not a reference: it names each moved
variable's concern so a search for it here still gets a hit and points to
`keep/README.md`'s `## bedrock` section; each variable's default and read
site are stated there, not restated here — except the dormant `INFRA_URL`
row, which has no current default or read site anywhere to redirect to.

| Variable(s) | Concern | Owner |
| --- | --- | --- |
| `KEEP_REQUEST_LOG` | Request/response logging — capture rules, redaction, the Datadog gate | bedrock |
| `PORT` | The port `listen()` binds (inert under `Deno.serve`) | bedrock |
| `DD_API_KEY`, `KEEP_DD_LOCAL` | Gates whether logs and traces ship to Datadog | bedrock |
| `KEEP_TRACE`, `KEEP_TRACE_BUFFER`, `KEEP_TRACE_KV`, `KEEP_TRACE_TTL_DAYS`, `KEEP_TRACE_OTLP_URL`, `KEEP_TRACE_OTLP_TOKEN` | The ring/KV/OTLP trace substrate | bedrock |
| `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM`, `POSTMARK_TO`, `POSTMARK_ALERT_COOLDOWN_MS` | The structured logger's `critical` catcher's failure-alert emails | bedrock |
| `INFRA_URL` (removed from keep, dormant) | No longer read by keep — keep is auth-agnostic and specs no bedrock auth substrate ([06-runtime/00](../06-runtime/00-overview.md)); this row has no current default or read site, and is kept only as a placeholder in case bedrock later specs an optional auth substrate | none currently — would be bedrock's only if that substrate is ever added |

