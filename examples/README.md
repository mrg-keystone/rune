# Examples

Worked examples of rune end to end — `.rune` spec→code demos and runnable backends
(rune's runtime).

## Shaping — spec → generated code

Each is a `.rune` spec and the typed tree rune generates from it (the loop in the
root [README](../README.md)).

| Example | Shows |
| --- | --- |
| [`todos/`](todos/) | The canonical project — three real specs and their generated, type-checked, lint-clean trees. Start here. |
| [`shop/`](shop/) | A multi-module spec set (`catalog`, `orders`, `notify`, shared `core`). |
| [`cake/`](cake/) | A chained spec used to demo computed endpoints / the `@EndpointController`. |

## Runtime — runnable backends

| Example | Shows |
| --- | --- |
| [`in-process-client/`](in-process-client/) | The in-process `backend.fetch` client — dispatch against the exact server pipeline without binding a port. Run with `deno task example`. A workspace member, so it resolves the in-tree runtime. |

> The full **sprig UI + keep backend** composition (a single-origin `serveSprig` app
> run by `deno serve serve.ts`, with the in-process client bound to sprig's `Backend`
> DI token) is what `rune init` scaffolds — see the generated `serve.ts` + `app/` and
> the `rune:framework` skill's deployment notes.
