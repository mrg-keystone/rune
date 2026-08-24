## The docs module (`DocsModule`)

The docs surface is **not hardwired into `bootstrapServer`** — it is an
addable Danet module. Import **`DocsModule`** into your Danet app and it
auto-wires the whole `/docs/*` tree:

| Path | What it serves | Detail spec | Backed by (DI) |
| --- | --- | --- | --- |
| `/docs` | the docs index — lists the composed modules | this doc | the `docs` object |
| `/docs/<module>` | the per-module cake — a guided walk of the module's process | [07-cake/02](02-the-cake-docs-module.md) | the `docs` object |
| `/docs/<module>/swagger` | standard Swagger UI | [07-cake/02](02-the-cake-docs-module.md) | the `docs` object |
| `/docs/<module>/json` | the raw OpenAPI spec | [07-cake/02](02-the-cake-docs-module.md) | the `docs` object |
| `/docs/_map` | the system map | [07-cake/03](03-the-system-map-docs-map.md) | the `docs` object |
| `POST /docs/_run` | the headless runner door | [07-cake/04](04-the-headless-runner-exerciseendpoints-opts.md) | the `docs` object + the in-process backend client |
| `GET`/`POST /docs/_fixtures` | fixtures door | [07-cake/02](02-the-cake-docs-module.md) | the fixtures store |
| `GET`/`POST /docs/_scenarios` | scenarios door | [07-cake/02](02-the-cake-docs-module.md) | the fixtures store |
| `POST /docs/_heal` | Ask-Claude heal door | [07-cake/02](02-the-cake-docs-module.md) | the heal store |
| `GET /docs/_heal-rules` | heal rules door | [07-cake/02](02-the-cake-docs-module.md) | the fixtures store |
| `GET /docs/_dev` | dev status door — serves the dev status file (`bootId` + `status`) verbatim, gated by `KEEP_DEV`; fetched by the poller injected into cake/map pages | [07-cake/05](05-dev-mode-and-tracing-pages.md) | the watcher's status file |
| `/docs/_trace` | the trace waterfall page | [07-cake/05](05-dev-mode-and-tracing-pages.md) | the tracer store |
| `GET`/`POST /docs/_traces` | trace data door | [07-cake/05](05-dev-mode-and-tracing-pages.md) | the tracer store |

It is **opt-in and OFF by default**, gated behind the env var **`KEEP_DOCS`**.

### Gating: when does `/docs/*` exist?

| `DocsModule` registered on the app | `KEEP_DOCS` truthy | `/docs/*` exposed? | `GET /docs/*` |
| --- | --- | --- | --- |
| No | No | No | 404 |
| No | Yes | No¹ | 404 |
| Yes | No | No¹ | 404 |
| Yes | Yes | Yes | served |

¹ The gate is **AND**, not OR — see below.

The gate is **AND**: `/docs/*` exists only when `DocsModule` is registered
on the app **and** `KEEP_DOCS` is truthy — the table above is definitive.
This is a security-relevant choice, not a documentation detail: under an
OR gate, merely registering `DocsModule` (e.g. left in for local-dev
convenience) would expose the fully-open interactive surface in production
regardless of `KEEP_DOCS`. AND keeps the surface off unless a deploy
deliberately does both, so the interactive cake/runner never reaches
production unless explicitly opted in. This doc owns the gate;
[06-runtime/05](../06-runtime/05-the-docs-surface-an-addable-module.md),
[06-runtime/06](../06-runtime/06-composition-serving.md), and
[13-environment-variables/02](../13-environment-variables/02-keep-runtime-serving-behavior.md)
all state the same AND gate.

`bootstrapServer` shortcuts the "registered" leg for you: setting
`KEEP_DOCS` truthy makes it register `DocsModule` on your behalf, so a bare
`KEEP_DOCS=1` already lands you in the bottom-right cell — no explicit
import required. The explicit import matters when you compose the Danet app
yourself outside `bootstrapServer`'s convenience, or when you want
`DocsModule` present in code year-round while still letting `KEEP_DOCS` gate
whether it actually serves per deploy.

```ts
// Path A — explicit import: DocsModule is always in the module tree;
// KEEP_DOCS still has to be truthy for it to actually serve (the AND
// gate above).
import { bootstrapServer, DocsModule } from "@mrg-keystone/rune";
import { OrdersModule } from "./orders/mod.ts";

const api = bootstrapServer("orders", [OrdersModule, DocsModule]);
```

```ts
// Path B — KEEP_DOCS-via-bootstrapServer: no import needed. Set the env var
// and bootstrapServer registers DocsModule for you, satisfying both legs.
// $ KEEP_DOCS=1 deno run -A serve.ts
import { bootstrapServer } from "@mrg-keystone/rune";
import { OrdersModule } from "./orders/mod.ts";

const api = bootstrapServer("orders", [OrdersModule]);
```

With neither leg satisfied, no `/docs/*` route exists — the production
default, so the cake never ships to prod unless you opt in. The UI shell
builders and handler factories are already standalone pure functions — only
the wiring moves into the module.

