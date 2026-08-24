## `bootstrapServer(appName, module, options?)`

The composition root
(`keep/src/foundation/domain/coordinators/bootstrap-server/mod.ts`). It wires
logging, tracing, and the `RuneAssertError` → 422 filter, and builds each
module's OpenAPI document.

```ts
import { bootstrapServer } from "@mrg-keystone/rune";
import { OrdersModule } from "./orders/mod.ts";
import { PaymentsModule } from "./payments/mod.ts";

const api = bootstrapServer("orders", [OrdersModule, PaymentsModule], {
  port: 8080,
  onStart: () => console.log("orders API is up"),
  onStop: () => console.log("orders API is down"),
});

await api.listen();

const { listen, stop, backend, handler, docs } = api;
```

### Signature

| Parameter | Type | Default | Effect |
| --- | --- | --- | --- |
| `appName` | `string` | required | Names the app for the OpenAPI document's title and as the app tag on every log entry and trace this server produces. |
| `module` | module class or an **array** of module classes | required | The endpoint module(s) to serve. An array is composed into one root via `appModule`; each contributes its own OpenAPI document ([02-endpoint-endpointcontroller.md](./02-endpoint-endpointcontroller.md)). |
| `options.port` | `number` | `3000` | The port `listen()` binds. Inert under `Deno.serve` ([06-composition-serving.md](./06-composition-serving.md)). |
| `options.swagger` | `boolean \| { filters: string[] }` | `true` | Controls the per-module OpenAPI build — see the swagger table below. |
| `options.onStart` | `() => void \| Promise<void>` | — | Lifecycle hook fired once, before serving begins. |
| `options.onStop` | `() => void \| Promise<void>` | — | Lifecycle hook fired once, during shutdown. |

The `onStart`/`onStop` semantics — the once-only guard, the handler-path
`{ backend, port: 0 }`, the disposer, `stop()` ordering, and the
SIGINT/SIGTERM process-termination handler under `deno serve` (`Backend`
forwards its hooks into this same lifecycle) — are bedrock's
serving-lifecycle contract, not restated here.

### Swagger behavior

| `swagger` value | OpenAPI built? | `docs` entry? | Routes serve? | Discoverable? | Provider resolution affected? |
| --- | --- | --- | --- | --- | --- |
| `true` (default) | Yes, every module | Yes, every module | Yes | Yes | No |
| `false` | No | No — `docs` is empty | Yes | No | No |
| `{ filters }` — a listed module | No | No | Yes | No | No |
| `{ filters }` — every other module | Yes | Yes | Yes | Yes | No |

"Discoverable" means present in `docs`, the sole source the docs pages and
the headless runner (`exerciseEndpoints({ api: { backend, docs } })`) read
endpoint metadata from — see [07-cake.md](../07-cake/00-overview.md).
Excluding a module from the OpenAPI build always excludes it from discovery
too; its routes keep serving regardless. Provider resolution (custom DI
tokens — see below) never depends on `swagger`.

Each `filters` entry is a string, matched against a module's JS class name:

| Module kind | String to pass |
| --- | --- |
| Raw danet `@Module` class | The class's own name. |
| `endpointModule(name, controllers)` | The `name` argument (keep uses it as the generated module class's name). |

A string that matches no module's name is a silent no-op — the module it
was meant to exclude stays in the OpenAPI build.

Returns `{ listen, stop, backend, handler, docs }`:

- `listen()` / `stop()` — start/stop on the configured port.
- `handler` — the raw `(Request, info?) => Response` dispatcher (the same
  pipeline `listen()` serves). Serve without binding
  (`Deno.serve((req, info) => api.handler(req, info))` — forward `info` so
  logs stay attributable) or mount under a prefix with `withBasePath`.
- `backend` — the **in-process client**. `backend.fetch` is `typeof fetch` and
  behaves **exactly like browser `fetch`** against this app — body, query,
  headers, cookies, streaming, redirects, and errors byte-identical to the HTTP
  path; only the transport differs (no port, no TCP — speed is the whole
  point), and the full pipeline runs (guards, pipes, interceptors, filters, the
  request/response logging). Usable immediately, before `listen()`. The
  authoritative contract — URL resolution, the cookie-fidelity model, the
  two-channel transport table, how `Backend` provisions it into a frontend,
  and the differential parity suite that enforces "exactly" — is bedrock's
  in-process-client contract; keep implements it, this doc doesn't restate it.
- `docs` — the composed app's per-module OpenAPI documents (each carrying the
  `x-keep-process` metadata `@Endpoint` stamps), built at boot; which modules
  get an entry follows the swagger table above.

### Custom DI providers — `InjectValue` / `InjectFactory` / `InjectClass`

Beyond controllers, an app registers its own injectables through three
top-level provider-descriptor builders keep re-exports:

- `new InjectValue(token, value)` — bind a token to a ready-made value
  (`useValue`): a config object, a shared client, a constant.
- `new InjectFactory(token, factory)` — bind a token to a factory function
  (`useFactory`) invoked to build the value.
- `new InjectClass(token, Class)` — bind a token to a class (`useClass`) the
  container constructs.

Each is a thin carrier of `{ provide, useValue | useFactory | useClass }` — a
danet-shaped provider descriptor for a danet `@Module`'s `providers` list.
Keep's own `endpointModule(name, controllers)` and `appModule(name, modules)`
helpers take controllers/modules only — neither exposes a `providers` slot — so
registering a custom provider means declaring it on a danet `@Module` directly,
whose `providers` metadata the DI container reads to resolve tokens — this is
plain danet dependency injection, independent of the OpenAPI document builder
(which separately reads a module's metadata only to build its Swagger docs).
The bound service resolves by its `token` anywhere in the composed app
regardless of the `swagger` option (see the swagger table above — provider
resolution is never affected).

