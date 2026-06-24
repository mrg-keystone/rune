---
name: "rune:data"
description: >-
  Design the persistence layer for a rune module: read the `.rune` specs in
  `spec/`+`src/` and the HTML UI prototype in `spec/`, then emit a
  `spec/data.json` that assigns every entity to **Firestore or Deno KV by
  per-operation performance** and restructures the model to be **immutable —
  new objects, never edits**. Use whenever you need to decide *how data is
  stored*, *which store an entity belongs in*, or *how to make a flow append-only
  instead of mutating*: "design the data structure / data model", "Firebase or
  Deno KV for this?", "pick the datastore", "where should this entity live", "the
  audit edits the record — make it immutable", "model this append-only", "optimize
  read/write performance for this view", "generate the data.json", "what indexes /
  keys do we need". Trigger even when the user says "data layer", "storage design",
  or "persistence" without naming a store, and whenever a spec's flow does
  load→mutate→save (an in-place edit) that should become an appended record. This
  skill produces ONE artifact — `spec/data.json` — and stops; it does NOT rewrite
  specs or write adapters. NOT authoring the `.rune` DSL itself (entities, DTOs,
  `[SRV]`) → use `rune:spec`; NOT generating/filling the data-adapter code → use
  `rune:build`; NOT the runtime data clients or `[SRV]` transport wiring →
  `rune:framework`; NOT the cake's real-data walk → `rune:cake`.
user-invocable: true
argument-hint: "[module or feature whose data structure to design]"
---

# rune:data

The **data-design layer** of rune. Every other rune skill treats persistence as an
opaque `[SRV] db:` boundary — `db:task.save(...)`, `db:order.load(...)` — and never
asks *what* sits behind it. This skill answers that question. It reads the module's
specs and its UI prototype, then produces a single design artifact, **`spec/data.json`**,
that decides for every entity:

1. **Which store** — Firestore or Deno KV — based on the *performance profile of the
   actual operations* the app runs against it.
2. **How to key/index it** so those operations are fast.
3. **How to make it immutable** — restructure any "load → change → save" mutation into
   an append of a *new* object, so history is never overwritten.

The output is a **standalone design document**. It does not edit `.rune` files, does not
touch `core.rune`'s `[SRV]` blocks, and does not write adapter code — those are
`rune:spec` and `rune:build`. Your deliverable is `spec/data.json`: a faithful,
performance-justified, immutable-by-construction map of the module's data.

## This skill vs its siblings

- **`rune:data` (here)** — *what* the data is and *where/how* it's stored: Firestore vs
  Deno KV per operation, keys, indexes, immutability restructuring. Emits `spec/data.json`.
- **`rune:spec`** — authors the `.rune` DSL (`[NON]` entities, `[DTO]`s, `[SRV]`
  boundaries, `[TYP]`s). The entities and their save/load boundary steps that this skill
  reads are *declared* there.
- **`rune:build`** — turns the spec into code, including the per-noun data **adapters**
  that actually call the store. This skill tells build's adapters *which* store and
  *which* shape; it doesn't write them.
- **`rune:framework`** — the runtime data **clients** behind a `[SRV]` (transport, env
  wiring, the `src/core/data/<svc>` client). This skill decides Firestore-vs-KV at the
  design level; framework is how a chosen client connects.
- **`rune:cake`** — exercises the built module against real data end-to-end. If a walk is
  slow or a write clobbers history, that's a signal to revisit `spec/data.json` here.

## What you consume

Read all three inputs before deciding anything — the spec tells you the *entities and
their writes*, the prototype tells you the *reads and their performance demands*, and the
two together tell you where mutation hides.

1. **The `.rune` specs** (`spec/*.rune` and any `src/<module>/*.rune`). Pull out:
   - **`[NON]` nouns / `[DTO]`s** — the entities you must store and their field shape.
   - **Boundary save/load steps** — `db:order.save(OrderDto)`, `db:task.load(id)`. Each
     `.save` is a **write**; each `.load` is a **read**. The verb pair per noun is your
     write/read inventory.
   - **`[REQ]` flows** — the *sequence*. A flow that does `load → <mutate> → save` on the
     same noun is an **in-place edit** — the prime target for immutability restructuring
     (see below). A flow that only ever `.save`s new ids is already append-friendly.
   - **`(s)` array fields and nested DTOs** — these are your natural append targets
     (`reviews(s)`, `events(s)`).
2. **The HTML prototype** in `spec/` (the `sprig:prototype` output, e.g.
   `spec/<module>.html`). This is the **read-pattern oracle** — the spec rarely tells you
   how data is *queried*, but the UI shows it directly. For each screen/region, classify
   what it demands of the store (see *Reading the prototype* below).
3. **Existing `src/` adapters**, if any — to stay consistent with shapes already chosen
   and not contradict a store decision already in flight.

## The store decision — optimize each operation, not each entity

The question is never "is `order` a Firestore thing or a KV thing" in the abstract. It's
**"what operations run against `order`, and which store makes *those* operations fast?"**
Decide per operation, then assign the entity to the store that serves its *hottest, most
demanding* operations — and call out explicitly when an entity's operations split (some
reads want one store, some want the other) so the design can carry a secondary
projection.

Both stores must perform well — there is no "throwaway" side. The split is about which
engine's strengths match the operation:

**Firestore — when the operation is shaped like a query or a live view.** Firestore earns
its keep when reads are *not* a simple key lookup:

- **Lists, filters, sorts, pagination** — "all orders where status = paid, newest first."
  Indexed queries are Firestore's core competency.
- **Real-time / live views** — a screen that updates as data changes (listeners,
  `onSnapshot`). If the prototype shows a feed, a live dashboard, presence, or anything
  that should refresh without a reload, that's Firestore.
- **Client-direct reads & cross-device sync** — data the UI reads straight from the store,
  or that must be consistent across a user's devices.
- **Unbounded or large collections** browsed by humans.

**Deno KV — when the operation is a fast keyed access on a known id.** KV earns its keep on
the hot path where you already know the key:

- **Point lookups by id** — "load order `abc123`." A single `get` on a structured key,
  lowest latency, no index needed.
- **Hot-path reads/writes** the server itself makes mid-request — the `db:x.load` in the
  middle of a `[REQ]` that must return fast.
- **Atomic operations & transactions** — counters, idempotency keys, reserve-then-commit,
  anything needing `atomic()` compare-and-set.
- **Sessions, ephemeral state, queues, secondary indexes** you maintain yourself for O(1)
  reach.

**When operations on one entity disagree**, don't force a single store. Record the primary
store for the demanding read, and note a **projection**: e.g. `order` lives in Firestore
for the customer's order-history list, but a KV `order:byId` mirror serves the in-request
point lookup. Make the duplication explicit in `data.json` (`projections`) rather than
silently picking one and making the other slow.

### Reading the prototype for access patterns

Walk every screen and interactive region of the prototype and write down, for each, what
it asks of the store. These become the `accessPatterns` in `data.json` and they *drive*
the store choice — the store is a conclusion *from* the patterns, never a prior.

| In the prototype you see…                          | Operation shape | Leans |
| -------------------------------------------------- | --------------- | ----- |
| A list/table/feed, filters, sort, "load more"      | query           | Firestore |
| A view that updates live / "new" badges / presence | subscription    | Firestore |
| A detail page reached by clicking one row (`/x/:id`)| point-get       | Deno KV |
| A counter, like count, inventory number ticking    | atomic          | Deno KV |
| A form that submits then shows the new item         | write + read-back | match the read-back |
| Search across a collection                         | query/index     | Firestore |

Note **frequency and latency demands** too — a view on the landing screen that every user
hits is hotter than an admin report. Hot + point-lookup is the strongest KV signal; hot +
query is the strongest Firestore signal.

## Immutability — append new objects, never edit existing ones

This is the structural heart of the skill, and it is **not** about versioning rows for
their own sake. The rule is concrete: **a domain action that changes something must write
a NEW object, leaving every prior object exactly as it was.** History is the data.

**The canonical example.** An `audit` has an array of `reviews`. The first audit appends a
review holding that audit's findings. Later an **appeal** comes in. The wrong (mutable)
design edits the existing review with the appeal's outcome — the original finding is gone.
The right design **appends a second review** to the array; the appeal is a new object, the
original review is untouched. Reading "the current state" means taking the latest review;
the full trail is always intact.

```jsonc
// WRONG — appeal mutates the review, original lost
audit { id, status: "appealed", review: { outcome: "overturned" } }

// RIGHT — appeal appends; both objects survive, latest wins on read
audit {
  id,
  reviews: [
    { kind: "audit",  outcome: "failed",     at: "...", by: "..." },
    { kind: "appeal", outcome: "overturned", at: "...", by: "..." }  // appended
  ]
}
```

**How to apply it to a spec.** Any `[REQ]` flow shaped `load(noun) → noun.mutate() →
save(noun)` is an in-place edit and a candidate to restructure. In `data.json` you don't
rewrite the spec — you *describe the immutable shape the storage should take*:

- Identify the mutated field/state.
- Replace "update field X" with "append a child object to collection `Xs`" — name the
  collection, the per-action object shape, and what triggers each append (audit vs appeal).
- Define how **current state is derived on read** (latest child, or fold the collection).
- Note that the parent's identity (`id`) is stable; only children accrete.

Two storage realizations, both append-only — pick by the read patterns above:

- **Embedded array** on the parent document (Firestore array / KV value) — best when the
  collection is small and always read *with* the parent (the `reviews` case).
- **Child collection / keyed siblings** — Firestore subcollection or KV keys
  `audit:<id>:review:<seq>` — best when children are many, queried independently, or
  appended concurrently (KV `atomic()` on a monotonic seq guarantees no lost append).

### Immutability protects domain records — not aggregates

The rule guards **history-bearing domain records**: the things a user or auditor would be
upset to find silently rewritten — an audit, an order, a review, a message, a status
change. Those carry a trail that *is* the data, so you append instead of edit.

It does **not** mean "turn every changing number into an event log." A value that is itself
a **derived aggregate** — a counter, a running total, an inventory count, a cache, a
"latest" pointer, a like-count — is not a domain record; it is a *summary of events that
live elsewhere*. Updating it in place (atomically) is the correct, idiomatic design, **not**
a mutation to feel guilty about. Manufacturing a `movements`/`events` ledger just to back a
counter is over-engineering: you've reinvented event-sourcing for something whose only job
is to be read fast.

The test: **does anyone need the per-change history of this value as a feature?** If yes,
the *events* are the domain records (store them append-only) and the counter is a fast
projection over them. If no — it's a stock count, a session, a cache — then it's a pure
aggregate: store it in Deno KV, update it with `atomic()`, and mark it `aggregate`. Do not
wrap it in a ledger by default.

- ✓ A product's `stock` count → KV `atomic()` counter, `strategy: "aggregate"`. No ledger
  unless the business actually wants an auditable stock-movement history.
- ✓ A `like`/`view` count, a session token, a rate-limit window → `aggregate`, overwrite in
  place atomically.
- ✗ An `audit` whose appeal would overwrite the finding → `append-child` (history matters).

So `immutability.strategy` has four honest values: **`append-child`** (history-bearing
record — append), **`already-immutable`** (only ever writes fresh ids), **`aggregate`** (a
derived counter/cache — atomic in-place update is correct), and **`overwrite-justified`**
(a one-off forced overwrite — explain why). Prefer append-only for real domain records
"whenever humanly possible," but call a derived aggregate what it is rather than
event-sourcing it.

## The output — `spec/data.json`

The design itself is one file: **`spec/data.json`** (sibling to the specs and the
prototype) — the source of truth. `scripts/render_review.ts` then derives a human-facing
**`spec/data.review.html`** from it (see *Scripts*). Use this shape for `data.json`; keep
`rationale` fields short and concrete — they are the justification a reviewer reads (and
what the visualizer surfaces under each store choice).

```jsonc
{
  "module": "audits",
  "generatedFrom": {
    "specs": ["spec/audits.rune"],
    "prototype": "spec/audits.html"
  },
  "entities": [
    {
      "name": "audit",
      "dto": "AuditDto",
      "store": "firestore",
      "purpose": "A compliance review of a subject; its outcome is the latest entry in its review trail.",
      "usedBy": [
        { "by": "audit.run", "kind": "endpoint", "does": "creates the audit + first review" },
        { "by": "audit.appeal", "kind": "endpoint", "does": "appends an appeal review" },
        { "by": "QueueView", "kind": "screen", "does": "lists & filters open audits" }
      ],
      "rationale": "Reviewer dashboard lists/filters audits live — query + subscription.",
      "key": "audits/{auditId}",
      "document": {
        "id": "a_1011", "subjectId": "initech",
        "reviews": [
          { "kind": "audit",  "outcome": "failed",     "at": "...", "by": "..." },
          { "kind": "appeal", "outcome": "overturned", "at": "...", "by": "..." }
        ]
      },
      "accessPatterns": [
        { "operation": "list open audits, newest first", "source": "prototype: QueueView",
          "shape": "query", "store": "firestore", "hotness": "high" },
        { "operation": "open one audit by id", "source": "prototype: AuditDetail",
          "shape": "point-get", "store": "denokv", "hotness": "high" }
      ],
      "projections": [
        { "name": "audit:byId", "store": "denokv", "key": "audit:{auditId}",
          "why": "in-request point lookup during appeal flow must be sub-ms" }
      ],
      "indexes": [
        { "fields": ["status", "createdAt"], "for": "QueueView filter+sort" }
      ],
      "immutability": {
        "strategy": "append-child",
        "mutationFound": "spec audit.appeal does load→setOutcome→save (edits review)",
        "collection": { "name": "reviews", "appendOnly": true,
          "childShape": ["kind", "outcome", "at", "by"],
          "appendTriggers": ["audit", "appeal"] },
        "currentStateOnRead": "last element of reviews[]",
        "realization": "embedded array (small, read with parent)"
      }
    }
  ],
  "notes": [
    "Any entity whose only write is a fresh-id .save is already append-friendly."
  ]
}
```

**Always include `document`, `purpose`, and `usedBy`** — these three make the design
*reviewable by a human* rather than a pile of access metadata, and they are what
`render_review.ts` renders as each record's story:

- **`document`** — a concrete example of the stored record, real-ish values, with the
  nested append-only collection shown as a couple of sample entries. The hero of the view;
  it's what someone reads to grasp the shape. Make it faithful to the DTO + immutability
  shape, including any `listId`/`ownerId` the queries need.
- **`purpose`** — one sentence: *what this record is and what it's for* (lift it from the
  `[NON]` prose and the flows; e.g. "a single task in a list — added, completed, archived").
- **`usedBy`** — *where it's used*: one entry per endpoint/screen that touches it,
  `{ by, kind: "endpoint" | "screen", does }`. The `scan_spec.ts` output already maps which
  `[REQ]` reads/writes each noun — turn that into the endpoint rows, and add the prototype
  screens that read it. This is what connects the stored shape back to the app's behavior.

A design with only access-pattern metadata and no `document`/`purpose`/`usedBy` is
unreviewable — don't ship one.

Field guide: `store` ∈ `firestore` | `denokv`. `accessPatterns[].shape` ∈ `query` |
`subscription` | `point-get` | `atomic` | `write`. `immutability.strategy` ∈
`append-child` | `already-immutable` | `aggregate` | `overwrite-justified` — use
`aggregate` for a derived counter/cache (atomic in-place update, no ledger); the last two
require a `why`.
Every entity from the spec must appear; every access pattern must trace to a spec step or a
named prototype region in `source`.

## Scripts — the deterministic spine

The *judgment* in this skill — Firestore vs KV, domain-record vs aggregate, what's
query-shaped — is yours and can't be scripted without lying. But the mechanics *around* the
judgment are deterministic and must not be eyeballed, so three bundled Deno scripts own
them. Run them with `deno run -A`; they need no deps.

| Script | When | What it does (deterministic) |
| ------ | ---- | ---------------------------- |
| `scripts/scan_spec.ts` | **before** you design | Parses the `.rune` spec(s) → JSON inventory of entities, DTOs, every persistence read/write, and **every `load→…→save` mutation candidate**. So you never miss an entity or an in-place edit. |
| `scripts/validate_data.ts` | **after** you write `data.json` | Gates it against the schema + spec coverage: valid stores/shapes/strategies, every spec `[NON]` present, an `aggregate` that smuggled in a ledger, an `overwrite-justified` with no `why`. Exit 1 = fix it. |
| `scripts/render_review.ts` | **last** | Consumes `data.json` → a self-contained `spec/data.review.html`: the data structure, each store choice and *why*, the append-vs-edit diagram, and a **notes box per entity for a second pass**. This is the human-facing deliverable. |

The scripts handle *plumbing and verification*; you handle *the design in the middle*.

## The procedure

1. **Scan the spec (script).** `deno run -A scripts/scan_spec.ts spec/` → the entity/
   read/write inventory and the `mutationCandidates`. Read it: this is your checklist of
   entities to place and edits to make immutable. (In the repo, the spec dir is wherever the
   module's `.rune` files live.)
2. **Inventory reads from the prototype** — walk each screen, classify every read as
   query / subscription / point-get / atomic, with a hotness guess. Tie each to a region
   name you can cite in `source`. (The prototype is the read-pattern oracle; the script
   above only sees the spec's writes.)
3. **Assign stores per operation, then per entity** — apply the rubric; where operations
   on one entity disagree, pick the primary store for the hottest read and add a
   `projection` for the other.
4. **Classify each mutation candidate, restructure only the domain records** — for each
   `load → mutate → save` the scan flagged, ask *history-bearing domain record or derived
   aggregate?* Records become append-only (collection, child shape, triggers, read-
   derivation, embedded vs child-collection). Aggregates stay `aggregate` — atomic in-place,
   no ledger unless the history is itself a feature.
5. **Add keys & indexes** — KV key structure for point/atomic ops; Firestore composite
   indexes for each query's filter+sort.
6. **Write `spec/data.json`.**
7. **Validate (script).** `deno run -A scripts/validate_data.ts spec/data.json spec/` —
   must exit 0. Fix every `✗` (and consider the `⚠`s) before continuing; the gate is how you
   know the design conforms, instead of hoping it does.
8. **Render & hand off (script).** `deno run -A scripts/render_review.ts spec/data.json`
   then open `spec/data.review.html`. That visualizer — not the raw JSON — is what you show
   the user to review the decisions and leave second-pass notes. Then stop; do not edit
   specs or write adapters.

## Worked references

- `examples/shop/spec/orders.rune` — `order.place` only `.save`s a fresh id: already
  append-friendly. Add a KV `order:byId` for the receipt point-lookup and Firestore for an
  order-history list.
- `examples/todos/src/tasks/tasks.rune` — `task.complete` does `load → markDone → save`: a
  textbook in-place edit. The immutable redesign gives `task` a `states(s)` append-only
  collection (`{ done, at }`), current `done` = last state; the task id never changes.

For the spec constructs referenced here (`[NON]`, `[DTO]`, `[SRV]`, `(s)` arrays) see
`rune:spec`. For how the chosen store becomes a real client, see `rune:framework`.
