## The system map (`/docs/_map`)

### What it is

The whole composed app as one process graph: every module's endpoints as
nodes in module lanes, ranked left-to-right by dependency depth. The graph
and its layout are computed server-side and inlined into the shell as
`window.__KEEP_MAP__` — the client only draws, fetching nothing to render.
That means every visual element below, except the live status dot and the
skip decoration, is backed by an attribute already present on
`__KEEP_MAP__`'s nodes/edges (a `NodeEntry`/`EdgeEntry` array derived
server-side from each endpoint's `x-keep-process`, see
[06-runtime/02](../06-runtime/02-endpoint-endpointcontroller.md)); the table
doubles as that read contract — the dot and the skip decoration are the only
rows sourced from the cake session instead:

| Element | Encodes | `__KEEP_MAP__` field |
| --- | --- | --- |
| Node | One endpoint (`surface.action` id) | `nodes[]` |
| Module lane | The node's owning module | `node.module` |
| Left-to-right rank | Dependency depth — the node's distance from the walk's roots, computed server-side from `dependsOn` | `node.rank` |
| Solid edge | Intra-module bind — the endpoint consumes a field produced inside its own module | `edges[]` where `kind: "bind"` |
| Dashed edge | Cross-module `$input` contract — a producer node satisfies another module's declared `$input` (cross-module auto-wiring: [The cake](02-the-cake-docs-module.md)) | `edges[]` where `kind: "contract"` |
| Amber `$name` badge | A declared `$input` with no producer anywhere in the composed app | `node.unresolvedInputs[]` |
| Flow edge-tint | The endpoint's flow membership (`x-keep-process.flows`) | `edge.flows` |
| Optional chip | `optional: true` on the endpoint | `node.optional` |
| Stub chip | `stub: true` — a generated ghost-stub endpoint | `node.stub` |
| Status dot | The endpoint's live run status (see below) | not a `__KEEP_MAP__` field — read at draw time from the cake session in `localStorage` |
| Skip decoration | The step's skip flag (see below) | not a `__KEEP_MAP__` field — read at draw time from the cake session's skip flag in `localStorage` |

**Two-lane example.** Module `orders` (lane A) declares `orders.create`,
which mints `orderId`. Module `billing` (lane B) declares `billing.charge`,
which declares `$orderId` as an external input — auto-satisfied cross-module
by `orders.create`'s `orderId` output (cross-module auto-wiring: [The
cake](02-the-cake-docs-module.md)) — and also declares an unproduced
`$couponCode`, and `billing.refund`, which binds `chargeId` from
`billing.charge` (an intra-module bind on a produced field, not a declared
`$input`). The map draws: a **dashed edge** `orders.create` →
`billing.charge` (the declared `$orderId` contract, satisfied cross-module,
per `edges[].kind: "contract"`); an **amber `$couponCode` badge** on
`billing.charge` (no producer anywhere mints it, per
`node.unresolvedInputs[]`); and a **solid edge** `billing.charge` →
`billing.refund` (an intra-module bind, both nodes in lane B, per
`edges[].kind: "bind"`).

### Live status & Run all

The map is **live**: node status dots recolor from the cake sessions in
`localStorage` (any tab, so a second tab's run updates the map without a
reload). Each dot mirrors its endpoint's status in that module's session —
`keep:emulator:/docs/<module>` (full session shape: [The cake — session
state](02-the-cake-docs-module.md)) — and takes one of three colors, from
two different evaluators:

- **Neutral** — not yet run this session; no status recorded.
- **Green** — last run passed. What "passed" means depends on who wrote the
  status: a **map/runner-driven** status (written by Run all's
  `/docs/_run` stream, below) is a bare 2xx — the runner never reads
  `cake.json` and does not evaluate pinned expectations
  ([The cake — expectations](02-the-cake-docs-module.md)). A
  **page-evaluated** status (written by running or re-running a step from
  its own cake page) reflects that page's pinned expectations when the step
  has any, else the same bare-2xx rule. Opening a step's cake page after a
  map-driven run re-evaluates its pinned expectations against the session's
  stored response and may recolor the dot from green to red.
- **Red** — last run failed: a non-2xx (either evaluator), or, only when
  page-evaluated, a 2xx that fails a pinned expectation check.

A step's **skip** toggle is not a fourth color: the session stores a step's
status and its skip flag as separate fields (per [The cake —
skip](02-the-cake-docs-module.md)), and the dot's color always follows the
status field alone, per the Neutral/Green/Red rules above — a skipped step's
dot keeps whatever color it was parked at. Reading a node's skip flag
overlays a distinct decoration on that dot (a muted ring/badge over the
parked color) so a skipped step is visually distinguishable from an unskipped
one at the same status.

**Run all** POSTs `/docs/_run` with
`{ stream: true, orderBy: "module", flow: "__main" }` (the untagged-only
pseudo-flow — the cake's default walk) plus the sessions' seeds (Module-inputs
`$input` values, read from each module's session per [The cake — session
state](02-the-cake-docs-module.md)) and skips. Each streamed result is a runner-evaluated 2xx
pass/fail, written back into that module's session —
`keep:emulator:/docs/<module>`, updating that step's `status`, `captures`,
and response meta (field set: [The cake — session
state](02-the-cake-docs-module.md)) — as it lands: already-open cake tabs
updating live, a cake opened afterwards finding its steps green with
responses pre-filled (subject to pinned-expectation re-evaluation, above),
failed steps deep-linking into their cake step with the heal panel lit. A
headless caller (curl, CI) hitting the same door gets the same ndjson stream
but runs no page, so that write-back has no executor.

### Navigation

Clicking a node deep-links `/docs/<module>#<endpointId>`, where `endpointId`
is the node's `surface.action` id — the same id the node is keyed by in the
table above, and, per
[06-runtime/02](../06-runtime/02-endpoint-endpointcontroller.md), the
endpoint's only identifier. Anchoring on the full `surface.action` (rather
than a bare action name) is what disambiguates a module that declares the
same action under two surfaces. (Underscore-prefixed so a module named "map"
can still own `/docs/map`.)

