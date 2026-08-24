## Composition & serving

`Backend` is a **keep export** — the primitive this doc specifies — and
`Backend(appName, module, options?)` mirrors `bootstrapServer(appName,
module, options?)` exactly — the same `appName`/`module` args, and
`swagger`/`onStart`/`onStop` all forward through unchanged (`bootstrapServer`
returns `{ listen, stop, backend, handler, docs }` — see [06-runtime.md §
`bootstrapServer(appName, module, options?)`](01-bootstrapserver-appname-module-options.md))
— plus one addition on `options`: `frontend`, an optional `Frontend` handler
(a frontend framework's export — sprig's own `ui/` export contract, out of
scope for this spec; see [01-architecture.md § The canonical
generated-project shape](../01-architecture/05-the-canonical-generated-project-shape.md))
to compose with. This three-arg primitive is what a generated project's
`server/bootstrap/mod.ts` calls, with `appName` and `module` inlined, to
build the `Backend` export it hands to `serve.ts`; a generated `serve.ts`
never calls this primitive directly — see the golden path below for how
`bootstrap/mod.ts` wires it up. `bootstrap/mod.ts` exports one more thing
besides `Backend`: `api`, the awaited `bootstrapServer(appName, module,
options)` result itself, kept separate for callers that need `{ backend,
docs }` rather than a composed handler — see the golden path below.

It calls `bootstrapServer` internally but never calls its `listen()` — it
takes the `handler` and mounts it under `/api/`, so the composed app's
endpoint modules are registered the same way they are for `bootstrapServer`,
through `module`; it also takes `backend`, the in-process client, and
provisions it downward into the wrapped `frontend` (see the delegation
boundary below). `Backend(...)` **evaluates to that composed fetch
handler** itself — a `(Request, info?) => Response` — not to an object you
unwrap: there's no separate `listen()` to call. You pass it straight to
`Deno.serve`.

### The golden path

The canonical generated `serve.ts` ([01-architecture.md § The canonical
generated-project
shape](../01-architecture/05-the-canonical-generated-project-shape.md)):

```ts
// serve.ts
import { Backend } from "./server/bootstrap/mod.ts";
Deno.serve(Backend(Frontend));
```

The `Backend` `serve.ts` imports here is not the keep primitive called
directly — it's `./server/bootstrap/mod.ts`'s own export, generated with
`appName` and `module` already bound. Internally, `bootstrap/mod.ts` calls
the keep primitive described above, `Backend(appName, module, { frontend })`,
with those two args inlined, so its own export takes just the one remaining
argument — the frontend handler — and forwards it through as
`options.frontend`. From `serve.ts`'s perspective, calling `Backend(Frontend)`
and passing the result straight to `Deno.serve` is the whole picture; the
`appName`/`module` binding and the primitive's three-arg signature are
`bootstrap/mod.ts`'s concern, not `serve.ts`'s.

`bootstrap/mod.ts` exports `api` alongside `Backend`: the awaited
`bootstrapServer(appName, module, options)` result, `{ listen, stop, backend,
handler, docs }`, with the same `appName`/`module`/`options` inlined (see
[06-runtime.md §
`bootstrapServer(appName, module, options?)`](01-bootstrapserver-appname-module-options.md)).
Nothing in the golden path above touches it — `serve.ts` imports `Backend`
only — but [the run-all gate](../04-codegen/06-the-run-all-gate.md) imports
`bootstrap/mod.ts`'s `api` export directly to hand `exerciseEndpoints` its
`{ backend, docs }`, and any other in-process caller of the composed backend
(bypassing HTTP and `serve.ts`'s frontend wiring entirely) reaches for the
same `api.backend`. This is how the gate keeps keep boot alone from
`Backend`'s frontend composition: it never touches the composition function
or `serve.ts`'s wiring, only `bootstrap/mod.ts`'s `api` export.

- `Backend(Frontend)` evaluates to the fetch handler `Deno.serve` runs
  directly — no intermediate `listen()` call.
- `GET /api/things` reaches `module`'s registered endpoint through the
  `/api/` mount (the keep dispatcher).
- `GET /` — or any other path not under `/api/` — reaches `frontend`
  unmodified.
- With `KEEP_DOCS` truthy and `DocsModule` registered on `module`,
  `POST /api/docs/_run` reaches the docs module through the same `/api/`
  mount (see [06-runtime.md § The docs surface — an addable
  module](05-the-docs-surface-an-addable-module.md) and
  [13-environment-variables.md § keep runtime — serving &
  behavior](../13-environment-variables/02-keep-runtime-serving-behavior.md)).

### Routing table

| Path | Handler | Notes |
| --- | --- | --- |
| `/api/docs/*` | the docs module (`DocsModule`) | only when `KEEP_DOCS` is truthy and the module is registered on `module` — off by default; see [06-runtime.md § The docs surface](05-the-docs-surface-an-addable-module.md) and [13-environment-variables.md § keep runtime — serving & behavior](../13-environment-variables/02-keep-runtime-serving-behavior.md) |
| `/api/*` (all other) | the keep dispatcher — `module`'s registered endpoints | mounted under `/api/` via `withBasePath`, bedrock's low-level mount primitive |
| everything else | the wrapped `frontend` handler | |
| everything else, `frontend` absent | the composed app is bedrock's raw-`handler` canonical shape, unwrapped | see the delegation boundary below — the three canonical shapes are bedrock's, not restated here |

### The delegation boundary

Keep's `Backend` is a **bedrock layer**: it intercepts `/api/`, delegates
everything else to the wrapped frontend handler, and provisions the
in-process client downward. The full serving contract — the three canonical
shapes, the `/api/` mount and wire-URL model, `port` being inert under
`Deno.serve`, `withBasePath` as the low-level mount primitive, and the
`onStart`/`onStop`/signal lifecycle — is bedrock's, as is the provisioned
client's contract; keep conforms, this doc doesn't restate them.

Bundler-safe: the Swagger builder (and its CommonJS handlebars dependency) is
lazy-loaded so importing the backend into a bundled SSR frontend works.

