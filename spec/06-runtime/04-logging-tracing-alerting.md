## Logging, tracing, alerting

The observability design is **layer-neutral bedrock substrate** — a
frontend-only app gets the identical substrate, and in-process calls are
logged and traced exactly like HTTP ones — with keep contributing only the
backend-specific wiring and consumers on top. The boundary, concern by
concern:

| Concern | Owned by bedrock | Keep's contribution | Where specced |
| --- | --- | --- | --- |
| Request/response logging | Capture rules, redaction, `KEEP_REQUEST_LOG`, the Datadog gate | `bootstrapServer` initializes the substrate and registers `appName` as the app tag | bedrock's own reference |
| Structured `logger` + `critical` catcher | The structured `logger`, and its bottom-level `critical` catcher, which forwards to Postmark | — (keep consumes it as-is; no keep-specific wiring) | bedrock's own reference |
| Tracing (ring / KV / OTLP) | The trace substrate — ring buffer, Deno KV persistence, OTLP export | `backend.fetch` sub-calls are auto-spanned; traces render at `/docs/_trace` via the docs module | bedrock's own reference (substrate); [07-cake/05](../07-cake/05-dev-mode-and-tracing-pages.md) (trace page + `/docs/_traces` door) |
| `RuneAssertError` → 422 filter | — (keep's own, not bedrock) | Bootstrap registers a global filter mapping `RuneAssertError` to HTTP 422 | [06-runtime/03](03-the-assert-runtime-assert.md) (the assert runtime) |

Attribution throughout is by `requestId`, never a caller identity — keep has
none. For traces, that attribution is the trace record itself: 07-cake/05
specs one TRACE record per request, and that record's top-level `id` **is**
the `requestId` — a log line's `requestId` and its trace's `id` are the same
value, which is how a log line and its trace correlate directly, with no
separate correlation field needed. A span's own `id` / `parentId`, by
contrast, are trace-local sequence numbers (the root span is always
`id: 1`), not request identifiers.

**A concrete walkthrough.** A handler calls `backend.fetch('/orders')` once,
in-process, from inside another endpoint's handler. That single call:

- emits a request log line for the sub-call carrying `app=<appName>`
  (registered by `bootstrapServer`) and the same `requestId` as the outer
  request — request/response logging treats the in-process call exactly like
  an HTTP one;
- appends a span of `kind: "backend"` to the trace, nested under the outer
  handler's root span of `kind: "request"`. The full trace and span record
  shape is specced in [07-cake/05](../07-cake/05-dev-mode-and-tracing-pages.md),
  not restated here; the trace record's top-level `id` is the same
  `requestId` as the request's log line, which is how a log line and its
  trace correlate — nested spans (like this `backend` one) don't carry a
  `requestId` themselves, since they already belong to the one trace whose
  `id` identifies the request.

That trace renders at `/docs/_trace` (data door `/docs/_traces`) once the
docs module is serving ([07-cake/01](../07-cake/01-the-docs-module-docsmodule.md)).
The log line carries `requestId` directly; the trace carries the identical
value as its top-level `id`, which is how the two correlate. Neither carries
a caller identity, per the attribution rule above.

