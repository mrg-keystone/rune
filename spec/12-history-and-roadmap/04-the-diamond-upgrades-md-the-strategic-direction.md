## The diamond (`upgrades.md`) — the strategic direction

The plan (started 2026-06-30) that merges the sprig (frontend) and rune
(backend) pipelines. The insight: the two tracks aren't parallel lines
hand-wired together at the end — they're a **diamond**: one product intent at
the top, two tracks down the sides, **one contract at the waist**, one running
composed app at the bottom (`Deno.serve(Backend(Frontend))`).

```
                                product intent
                                 (rune:scope)
                                       ◆
                                      ╱ ╲
                                     ╱   ╲
                     FRONTEND TRACK ╱     ╲ BACKEND TRACK
                                   ╱       ╲
                       sprig:design         rune:spec
                                   │         │  (consumes the two seams as
                    sprig:prototype│         │   its seed inventory, then
                      (births the  │         │   ratifies the contract)
                       two seams)  ╲         ╱
                     ══════════════ ╲ ═════ ╱ ══════════════
                                      ╲     ╱
                            THE WAIST — ONE CONTRACT
                       queries + commands, never an
                            "edit-this-record" verb
                     Bridge 1 (↑) arrives here from the prototype's
                     two seams; Bridge 2 (↓) leaves here for every
                     downstream consumer
                     ══════════════ ╱ ═════ ╲ ══════════════
                                    ╱         ╲
                      sprig:breakdown          rune:data
                                   │             │
                        sprig:build│             │rune:build
                                   │             │
                       sprig:audit │             │rune:cake
                                    ╲             ╱
                                     ╲           ╱
                                      ╲         ╱
                                       ◆───────◆
                            Deno.serve(Backend(Frontend))
```

Every strategic element above has an operational home on the 13-rung ladder
rune:diamond walks
([09-claude-skills/01](../09-claude-skills/01-the-eight-skills-in-pipeline-order.md)):

| Diamond element | Ladder rung |
| --- | --- |
| Bridge 1 (seams read from `spec/ui/<app>-prototype/`) | rung 4 |
| Waist ratification (`rune:spec`) | rung 5 |
| Bridge 2 (`openapi.json` + typed client emitted) | rung 9 |
| Bottom vertex (`Deno.serve(Backend(Frontend))`) | rung 12 — Merge |

- **The waist rule:** the contract is **queries** (current-state read DTOs)
  and **commands** (intent verbs) — never an "edit-this-record" endpoint.
  This is load-bearing: rune:data reshapes storage to be immutable/append-only
  *below* the waist, and because the contract is queries + commands, that
  reshaping never breaks the frontend.
- **Bridge 1 (up):** the sprig prototype is born with the contract
  pre-extracted as two seams — `objects/<type>.json` (reads) and
  `commands.json` (intent verbs with a `kind` vocabulary:
  create/set/append/adjust/remove that seeds the immutability strategy).
  rune:spec consumes them as its seed inventory and **ratifies** them. For
  example, a task intent's current-state read lives in `objects/task.json`
  (`{ "id": "t_1", "title": "...", "done": false }`) while `commands.json`
  carries a complete verb for completing it — `{ "verb": "completeTask",
  "kind": "set", "entity": "task" }`. That `kind: set` is what the prototype
  hands down: it's the seed rune:data acts on below the waist, free to
  reshape task completion into an append-only event trail without ever
  touching the `objects/task.json` shape the frontend already reads.
- **Bridge 2 (down):** the `contract client` tool emits the typed client from
  rune's `openapi.json` at rung 9; everyone downstream derives from that
  ratified, already-committed contract — sprig:breakdown binds components to
  real endpoints + DTOs (drift is a checkable error), and sprig:build (rungs
  11–12) *consumes* the committed client rather than generating it — the
  contract lets sprig build with no rune backend present.
- On-disk home: `spec/contract/` — its four members, their classes,
  provenance stamps, and committed-exception semantics are owned by
  [04-codegen/02](../04-codegen/02-the-contract-artifact-spec-contract.md).

Status: the two-seam prototype format, the shared `spec/`, and the runtime
merge were already done when the doc was written; the waist rule, both
bridges, and the conductor now live in the skills
([09-claude-skills.md](../09-claude-skills/00-overview.md) — rune:spec, rune:data,
rune:diamond).

