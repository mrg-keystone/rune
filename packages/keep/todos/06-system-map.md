# Task 06 — System map at `/docs/_map`

Repo: **keep** (`/Users/raphaelcastro/Documents/programming/keep`). Read `00-context.md` first.
**Prerequisite: task 02 complete** (producers index). Task 04's composed fixture makes the best
verification target — if it exists, use it; otherwise compose two modules ad hoc.

## Goal

One page showing the WHOLE app as a process graph: every module's endpoints as nodes in module
lanes, bind edges inside modules, dashed `$input → producer` edges across them, flows as colored
paths, optional/stub badges — with **live run state** (dots recolor as steps run in any tab) and
click-through into the cake at the exact step. Mounted at `/docs/_map` (underscore: a module
named "map" would own `/docs/map`).

## Files

- `src/foundation/domain/business/map-ui/mod.ts` + `client.ts` (+ `test.ts`) — NEW, mirroring
  `emulator-ui`'s conventions exactly (mod.ts assembles HTML + inlines a JSON payload;
  client.ts exports CSS/JS as String.raw strings — no backticks/`${` inside them).
- `src/foundation/domain/coordinators/bootstrap-server/mod.ts` — route registration.
- `src/foundation/domain/business/index-page-builder/` — add a map link on the docs index.
- `src/foundation/domain/business/emulator-ui/client.ts` — hash deep-linking (small).

## Steps

1. **Server-side graph build** (`map-ui/mod.ts`, `mapShellHtml(appName, docs)`):
   - Flatten all docs with `endpointsFromDoc`; tag each endpoint with its module name (the docs
     path segment).
   - Nodes: `{ module, id, method, path, flows, optional, stub, docsPath }`.
   - Edges: for every bind value (normalize arrays): `"step.field"` → solid edge producer→consumer
     labeled with the field; `"$name"` → if the app-wide producers index (build it the same way
     task 02 does in bootstrap-server — or accept it as an argument) has a producer, a DASHED
     edge labeled `$name`; unfulfilled `$name` → render as a stub-colored input badge on the node.
   - Layout server-side: `processOrder` over the flattened endpoints gives a topological order;
     compute each node's rank (longest-path depth over the dependency edges) → column; group
     rows by module (lanes). Emit positions in the payload so the client only draws.
2. **Client render** (`map-ui/client.ts`): SVG — lane backgrounds with module names (each lane
   title links to `/docs/<module>`), nodes as rounded rects (status dot + METHOD + path tail +
   chips for flows/optional/stub), edges as bezier paths (flows tinted with the same palette
   family the cake uses; `$` edges dashed). A small legend. No external libraries.
3. **Live state**: read each module's session key `localStorage["keep:cake:/docs/<module>"]`
   (statuses by endpoint id) + the shared globals; color dots green/red/idle accordingly;
   `window.addEventListener("storage", ...)` re-reads and recolors. NOTE the map page's own path
   is `/docs/_map` — it reads OTHER pages' keys, so compute them from each node's `docsPath`,
   and mind a possible mount prefix: derive the prefix from `location.pathname` the way
   emulator-ui's client computes `appRoot`.
4. **Click-through + deep links**: node click → `/docs/<module>#<endpointId>`. In
   `emulator-ui/client.ts` boot section: if `location.hash` names a known endpoint id, expand
   that step (`toggleExpand(ep, true)`) and `scrollIntoView` it.
5. **Mounting** (bootstrap-server, inside the `if (swagger)` block): register
   `GET /docs/_map` serving `mapShellHtml(appName, docs)` (wrapped in `injectDocsScript` like
   the other pages). Add a "system map" link to the docs index (extend `index-page-builder`'s
   build input — keep its existing API shape backward compatible) and to the cake page
   header nav (next to the Swagger UI link).
6. **Tests**:
   - `map-ui/test.ts`: payload embeds the expected nodes and both edge kinds for a two-module
     doc fixture (build the fixture docs inline like `emulator-ui/test.ts` does); `<` escaping
     in the payload (copy the existing escaping test pattern).
   - Browser test (`emulator-ui/browser.test.ts` or a new `map-ui/browser.test.ts`, gated on
     `KEEP_BROWSER=1`): compose two modules; `/docs/_map` renders the right node count
     (`svg [data-node]` selectors); click a node → lands on the cake with that step
     expanded (`li.open[data-id=...]`); run the step there, navigate back to the map → its dot
     is green (storage-driven).

## Verification (the whole task)

```
deno task test                      # unit incl. new map tests
deno task test:browser              # browser incl. the map test
KEEP_BROWSER=1 deno task test:e2e   # fixtures unaffected
deno fmt --check src/ && deno task check:jsr
```

Then boot the composed checkout fixture (`MANUAL_KEY=k deno run -A --unstable-raw-imports
--config e2e/checkout/deno.json e2e/checkout/server.ts`), open `http://localhost:8723/docs/_map`,
and take a screenshot for the report: lanes, edges (incl. the dashed `$memberId` edge), legend,
and a green dot after running a step.

## Definition of done

- [ ] `/docs/_map` renders all modules' endpoints in lanes with solid bind edges and dashed `$` edges
- [ ] Live recolor via storage events; node click deep-links to the expanded cake step
- [ ] Linked from the docs index and cake headers; `_`-prefixed path (no module collision)
- [ ] New unit + browser tests green; all Verification commands green; screenshot captured
- [ ] No commits
