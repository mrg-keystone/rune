# upgrades.md — merging the frontend & backend seams (the diamond)

**What this is:** the plan to make the sprig (frontend) and rune (backend) pipelines
*converge on one contract* instead of being hand-wired at the end ("a lot of
finagling"). Companion to the cross-repo contracts already in the sprig repo:
[`coms.md`](../sprig/coms.md) (the runtime seam) and
[`coordinate.md`](../sprig/coordinate.md) (the shared-`spec/` seam). Started 2026-06-30.

---

## TL;DR

The two pipelines aren't parallel lines that meet at the end — they're a **diamond**:
one product intent at the top, two tracks down the sides, **one contract at the
waist**, and a single running app at the bottom. The finagling happens because the
waist contract is *implicit* today. Make it explicit — **queries + commands, authored
once, derived everywhere** — and the two halves build in parallel and snap together.

The keystone is already built: the new prototype format (`sprig/rnd/proto`) is born
with the contract **pre-extracted** as two seams — `objects/` (reads) and
`commands.json` (writes). That turns the hardest bridge from a tool we had to build
into a property of the format.

---

## The diamond

```
                          ┌──────────┐
                          │  SCOPE   │        one product intent (rune:scope → spec/product)
                          └────┬─────┘
                 ┌─────────────┴─────────────┐
        FRONTEND track                 BACKEND track
        sprig:design                   rune:spec     ← ratifies the contract
        sprig:prototype  ── bridge 1 ─▶ (seeded by the prototype's two seams)
          objects/ + commands.json     rune:data     ← immutability, BELOW the waist
        sprig:breakdown ◀─ bridge 2 ── rune:build
        sprig:build     ◀─ bridge 2 ── (OpenAPI / DTOs)
                 └─────────────┬─────────────┘
                          ┌────┴─────────┐
                          │ THE CONTRACT │   queries (current-state DTOs) + commands (intents)
                          └────┬─────────┘
                          ┌────┴─────────┐
                          │  serveSprig  │   the runtime merge (already built — coms.md)
                          │ {keep, app}  │   SSR → inject(Backend) · islands → /api/*
                          └──────────────┘
```

- **Top (shared):** one scope. Both tracks descend from the same product intent.
- **Sides (parallel):** frontend and backend build at the same time.
- **Waist (the contract):** where they converge — **the one thing both sides bind to.**
- **Bottom (the merge):** the composed app. Already solved by `serveSprig` + the
  in-process `Backend`/`/api/*` split.

The two **bridges** stitch the sides to the waist — they are the actual upgrade.

---

## The waist: queries + commands (never editable records)

The single rule that makes everything else work:

> The contract is **queries** (read current-state DTOs) and **commands** (intent verbs).
> Never an "edit-this-record" endpoint.

Why it's load-bearing: `rune:data` reshapes the data to be **immutable / append-only**.
If the contract were CRUD-on-records (`PUT /thing/:id`), that reshaping would break the
frontend. Because the contract is queries + commands, immutability lives **below the
waist** — it changes storage and how current-state is folded, never the read DTO or the
command surface. The UI issues an intent and optimistically reflects it; whether the
backend appends an event, bumps a counter, or overwrites is decided underneath and the
UI never knows.

**The only thing that ever crosses the waist upward** is an *additive* "expose the
history" field — and only when the prototype showed a history panel (a product
decision), never a surprise from `rune:data`.

---

## The two seams (the contract, pre-extracted)

The new prototype format makes the contract concrete on the frontend side, before any
backend exists:

| Seam | Authored as | Runtime | Maps to (backend) |
|---|---|---|---|
| **Reads** | `objects/<type>.json` (one collection per type) | `window.objects.all/get/types` → `GET /objects/:type` | a `[NON]` type + **read DTO** + query endpoints (`<type>.all`, `<type>.get`) |
| **Writes** | `commands.json` (intent verbs + `kind`) | `window.commands.run(name, input)` → `POST /commands/:name` | **command verbs + input DTOs**; the `kind` seeds the immutability strategy |

The command `kind` vocabulary carries the write-side design forward:

| `kind` | prototype host does | rune:data strategy |
|---|---|---|
| `create` | append a new object (auto-id) | already-immutable (fresh ids) |
| `set` | record new field values | append-child / aggregate / overwrite — **decided below the waist** |
| `append` | push a child onto a collection field | append-child (history matters) |
| `adjust` | atomic numeric move | aggregate (derived counter) |
| `remove` | tombstone | remove command + retention |

The whole contract is introspectable over HTTP (`GET /objects` + `GET /commands`), so a
tool can read it and derive the rune spec without opening a file.

---

## The new process — the two bridges

### Bridge 1 (up): the prototype seeds the spec
The prototype is the **discovery** surface ("the prototype helps build the spec"). Its
two seams already *are* the draft contract:
- `objects/*.json` → draft **read DTOs** (one per type).
- `commands.json` → draft **command verbs + input DTOs** (with the `kind` immutability hint).

`rune:spec` consumes those as its seed inventory and **ratifies** them into canonical
DTOs — the "authored once" moment. The prototype isn't a competing source of truth; it's
the input to ratification. (Largely free now that the format pre-extracts both seams.)

### Bridge 2 (down): everyone derives from the ratified contract
- **`sprig:breakdown`** stops emitting its own `data-model.md` and instead **binds** each
  component's data-need to a real endpoint + DTO. A mismatch is a checkable **drift
  error** at breakdown time, not a runtime surprise.
- **`sprig:build`** generates a **typed client from the rune OpenAPI**; `resolve.ts` /
  islands import the real DTO types and call real endpoints — no hand-typing.

---

## The re-edged pipeline (input → output per stage)

| Stage | Consumes | Produces |
|---|---|---|
| rune:scope | the idea | `spec/product/` (spec.md + user-stories) |
| sprig:design | scope | `spec/ui/design-system/` |
| sprig:prototype | scope + design | `*-prototype.html` + **`objects/` + `commands.json`** (the two seams) |
| **rune:spec** | the prototype's two seams (**bridge 1**) | `spec/runes/*.rune` — **queries + commands** (the canonical contract) |
| rune:data | the contract | `spec/misc/data.json` — immutable storage + projections (**below the waist**) |
| rune:build | the contract + data.json | backend modules + **OpenAPI/DTOs** |
| sprig:breakdown | the OpenAPI/DTOs (**bridge 2**) | `spec/ui/breakdown/` with a **binding** (component → endpoint → DTO), not a re-derived schema |
| sprig:build | the breakdown + OpenAPI (**bridge 2**) | the sprig app + a **generated typed client** |
| runtime | both halves | `serveSprig({keep, app})` — the merge |

---

## Modification map (what to change so the skills know their edges)

Each skill declares only its edge against the one contract (the `interfaces/` discipline,
applied across the frontend/backend boundary).

**Keystone**
- New `spec/contract/` on-disk home (mostly *generated*: OpenAPI + DTOs; plus the
  prototype-seeded draft and the binding).
- New `contract.md` cross-repo doc (sibling to `coms.md`/`coordinate.md`) — owns "the
  contract is queries + commands," the seam formats, and the two bridges.

**rune** (`/Users/raphaelcastro/Documents/programming/rune`)
- `claude/skills/rune:spec/SKILL.md` + `claude/agents/rune-spec-author.md` — the **waist
  rule** (queries + command verbs; never an edit-the-record endpoint).
- `claude/skills/rune:scope/SKILL.md` — consume the prototype's two seams as the seed
  inventory (bridge 1).
- `claude/skills/rune:data/SKILL.md` + `claude/agents/rune-data-designer.md` — reinforce
  "stay below the waist": projection-maintenance keeps the query DTO stable; surface
  history only additively.

**sprig** (`/Users/raphaelcastro/Documents/programming/sprig`)
- `claude/skills/sprig:prototype/SKILL.md` + `claude/agents/sprig-prototype-builder.md` —
  emit the two-seam format (`objects/` + `commands.json`); this *is* bridge 1's producer.
- `claude/skills/sprig:breakdown/SKILL.md` + `claude/skills/interfaces/ui-breakdown.md` +
  `claude/agents/sprig-breakdown-analyst.md` — replace `data-model.md` with a **binding**
  against the contract (bridge 2).
- `claude/skills/sprig:build/SKILL.md` + `claude/agents/sprig-build-scaffolder.md` +
  `references/serving.md` — generate the **typed client** from the OpenAPI (bridge 2).
- `claude/skills/interfaces/README.md` — add the cross-boundary **contract** as a
  first-class artifact (point at `contract.md`).

---

## Already done vs. the upgrade

**Done (don't rebuild):**
- Shared `spec/` at the git root — `coordinate.md`.
- The runtime merge — `serveSprig({keep, app})`, in-process `Backend` for SSR + `/api/*`
  for islands — `coms.md`.
- Within-pipeline contracts — sprig's `interfaces/`.
- **The two-seam prototype format** — `sprig/rnd/proto` (objects + commands, append-only
  log, contract introspectable over HTTP). This is bridge 1's hard part, solved.

**The upgrade (this doc):**
- The **waist rule** in `rune:spec` (queries + commands).
- **Bridge 1** — prototype's two seams seed `rune:spec`.
- **Bridge 2** — breakdown binds + frontend generates its client from the OpenAPI.
- The **`contract.md`** keystone tying it together.

---

## Sequence

1. **Proto format** — DONE (`sprig/rnd/proto`). The keystone; proves the two seams
   extract cleanly because the prototype is *born* separated.
2. **Write `contract.md`** — ratify the seam formats + the waist rule as the shared
   cross-repo contract.
3. **Re-edge the skills** — apply the modification map, producer + consumer together per
   contract (a contract change is breaking for both sides; never edit one alone).

The riskiest unknown (does the prototype extract cleanly?) is retired by the format. What
remains is mechanical: declare the contract once, point each stage's edge at it.
