# Examples

Worked examples across the rune umbrella — `.rune` spec→code demos and runnable
`@mrg-keystone/keep` apps.

## rune — spec → generated code

Each is a `.rune` spec and the typed tree rune generates from it (the loop in the
root [README](../README.md)).

| Example | Shows |
| --- | --- |
| [`todos/`](todos/) | The canonical project — three real specs and their generated, type-checked, lint-clean trees. Start here. |
| [`shop/`](shop/) | A multi-module spec set (`catalog`, `orders`, `notify`, shared `core`). |
| [`cake/`](cake/) | A chained spec used to demo computed endpoints / the `@EndpointController`. |

## keep — runnable apps

| Example | Shows |
| --- | --- |
| [`in-process-client/`](in-process-client/) | The in-process `backend.fetch` client — dispatch against the exact server pipeline without binding a port. Run with `deno task example`. A workspace member, so it resolves the in-tree keep. |
| [`fresh-project/`](fresh-project/) | A standalone Fresh frontend embedding keep. Has its own lockfile; run via `cd examples/fresh-project && deno task dev`. Copy it out as a starting point. |
