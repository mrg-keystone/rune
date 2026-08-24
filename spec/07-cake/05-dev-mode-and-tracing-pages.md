## Dev mode and tracing pages

### Dev mode

- **`KEEP_DEV=<status file>`** — serves `/docs/_dev` (the
  injected poller fetches it from the browser, and it exposes only the
  watcher's status file verbatim) and injects a poller into every
  cake/map page. This is the channel `rune dev` drives
  ([03-cli.md](../03-cli/00-overview.md)). `KEEP_DEV` is orthogonal to
  `KEEP_DOCS`: it governs the dev poller and `/docs/_dev`, and takes effect
  only when the docs module is serving.

The status file's shape is pinned by its writer, dev's owner process
([03-cli/03](../03-cli/03-rune-dev-the-live-loop.md)): `{ bootId: string,
status: "green" | "check-error", error?: string }`. `/docs/_dev` and the
poller are readers only — they parse exactly those fields and mint no
schema of their own. The poller drives what an open page shows, off nothing
but those fields and reachability:

| Condition | Page display |
| --- | --- |
| `bootId` changes | Page auto-reloads |
| `status: "check-error"`, server live | Red banner, showing the status file's `error` text |
| Server unreachable — connection-refused (e.g. a crashed app child; [03-cli/03](../03-cli/03-rune-dev-the-live-loop.md)) | "server restarting…" notice |

### Tracing pages

- **`/docs/_trace`** — recent requests as bars; expand for the full span
  waterfall — `request` / `backend` / `user` lanes, labeled "request" /
  "backend" / "your functions" on the page, with ✖ marking the crash point —
  and route/method/status/user filters. Its sole data source is the open
  `/docs/_traces` door, polled from the page.

**`GET /docs/_traces`**

| Query param | Meaning |
| --- | --- |
| `?user=` | Scopes the result to one user, server-side |
| `?limit=` | Caps the number of traces returned — default 200, ceiling 1000 |

Response envelope: `{ app, enabled, persistent, users, traces }`

`app`, `enabled`, `persistent`, and `users` are computed over the full stored
trace buffer, independent of `?user=` and `?limit=` — only `traces` is
user-filtered and limit-capped. This keeps the dropdown `users` powers
complete even when `?user=` narrows the response or `?limit=` caps it below
the buffer's size.

| Field | Job |
| --- | --- |
| `app` | The app name tag |
| `enabled` | Mirrors `KEEP_TRACE` |
| `persistent` | Whether the sink is Deno KV (durable) vs the in-memory ring |
| `users` | The distinct `user` values seen across the full stored buffer — powers the page's user filter dropdown |
| `traces` | The trace records, user-filtered by `?user=` and limit-capped by `?limit=` — newest-first, one per request; shape below |

**`POST /docs/_traces {"clear": true}`** — empties the buffer.

**Trace record** — one per request:

| Field | Type | Meaning | Optionality |
| --- | --- | --- | --- |
| `id` | string | The request's `requestId` — one trace per request, and this is the *same* value as that request's log line `requestId`. This is where that correlation is defined; [06-runtime/04](../06-runtime/04-logging-tracing-alerting.md) states only the rationale (a log line and its trace correlate with no separate field). | required |
| `app` | string | The app name tag. | required |
| `method` | string | HTTP method of the request. | required |
| `route` | string | The matched route. | required |
| `user` | string | Whatever app code set via `traceUser(...)` / `tracer.setUser(...)`; keep attaches no identity of its own. | optional — absent unless the app sets it |
| `status` | number | HTTP status code of the completed response. | optional — absent when the request crashed before a status was set (`ok: false`) |
| `startedAt` | number | The trace's start time, epoch milliseconds — directly diffable against each span's ms-offset `start`/`end` with no parse step. | required |
| `durationMs` | number | Total wall-clock duration of the request, in milliseconds. | required |
| `ok` | boolean | `true` if the request completed normally; `false` if it crashed. | required |
| `crashedSpanId` | number \| null | The `id` of the span the waterfall marks with ✖ — the span where the crash happened — when `ok: false`; `null` when `ok: true`. | required (value is `null` when not applicable) |
| `spans` | span record[] | The full span waterfall for the request — shape below. | required |

**Span record:**

| Field | Type | Meaning | Optionality |
| --- | --- | --- | --- |
| `id` | number | Trace-local sequence number; the root span is always `id: 1`. | required |
| `parentId` | number \| null | The parent span's `id`; `null` for the root span. | required |
| `name` | string | The span's label (route or function name). | required |
| `kind` | `"request"` \| `"backend"` \| `"user"` | Which waterfall lane the span belongs to: `"request"` is the root span for the request itself; `"backend"` is an auto-spanned `backend.fetch` sub-call ([06-runtime/04](../06-runtime/04-logging-tracing-alerting.md)); `"user"` is the page's "your functions" lane — spans app code adds itself. | required |
| `start` | number | Start time, in ms offset from the trace's `startedAt`. | required |
| `end` | number | End time, in ms offset from the trace's `startedAt`. | required |
| `error` | string | The crash message, present on the span named by the trace's `crashedSpanId`. | optional — absent unless this span crashed |
| `meta` | object | Free-form key/value metadata the span's producer attaches (e.g. a `backend` span's called URL); shape isn't fixed by this spec. | optional |

**A worked trace**, root request span with one nested backend call:

```json
{
  "id": "req_9f2c1a",
  "app": "orders-api",
  "method": "GET",
  "route": "/orders/:id",
  "user": "u_482",
  "status": 200,
  "startedAt": 1737227582010,
  "durationMs": 42,
  "ok": true,
  "crashedSpanId": null,
  "spans": [
    { "id": 1, "parentId": null, "name": "GET /orders/:id", "kind": "request", "start": 0, "end": 42 },
    { "id": 2, "parentId": 1, "name": "backend.fetch /inventory/:sku", "kind": "backend", "start": 6, "end": 31, "meta": { "url": "/inventory/SKU-1180" } }
  ]
}
```

The crashed variant — the backend span fails, so `ok` flips to `false`,
`status` is absent, and `crashedSpanId` names the failed span, which also
carries `error`:

```json
{
  "id": "req_9f2c1b",
  "app": "orders-api",
  "method": "GET",
  "route": "/orders/:id",
  "user": "u_482",
  "startedAt": 1737227599512,
  "durationMs": 18,
  "ok": false,
  "crashedSpanId": 2,
  "spans": [
    { "id": 1, "parentId": null, "name": "GET /orders/:id", "kind": "request", "start": 0, "end": 18 },
    { "id": 2, "parentId": 1, "name": "backend.fetch /inventory/:sku", "kind": "backend", "start": 6, "end": 18, "error": "connection refused" }
  ]
}
```
