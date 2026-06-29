---
name: "rune:data"
description: >-
  Design the persistence layer for a rune module: read the `.rune` specs in
  `spec/runes/`+`src/` and the sprig UI prototype + design system in `spec/ui/`,
  then emit a
  `spec/misc/data.json` that assigns every entity to a store — **a single JSON
  file (`fs_json`) for the smallest local projects, SQLite when the
  app runs local-only but needs real queries/indexes, otherwise Firestore or Deno
  KV by per-operation
  performance, and S3 for large files / binary blobs** — restructures the
  model to be **immutable —
  new objects, never edits**, and sets a conscious **retention** per entity (a
  **TTL** for ephemeral data, or **no TTL — permanent** for domain records). Use
  whenever you need to decide *how data is
  stored*, *which store an entity belongs in*, *how to make a flow append-only
  instead of mutating*, or *how long the data should live*: "design the data
  structure / data model", "Firebase or
  Deno KV for this?", "is this local-only — can we just use SQLite?", "use sqlite
  for this", "where do big files / uploads / images go?", "store this blob in S3",
  "stub the large data with an s3 link", "how long should we keep this?", "does
  this need a TTL or should it persist forever?", "set an expiry / TTL on this",
  "just use a json file for this", "it's a small project — a flat file is fine",
  "pick the datastore", "where should this entity live", "the
  audit edits the record — make it immutable", "model this append-only", "optimize
  read/write performance for this view", "generate the data.json", "what indexes /
  keys do we need". Trigger even when the user says "data layer", "storage design",
  or "persistence" without naming a store, and whenever a spec's flow does
  load→mutate→save (an in-place edit) that should become an appended record. This
  skill emits `spec/misc/data.json` and then makes **minimal, data-driven nudges to the
  EXISTING `.rune` specs** so they best exploit that design — surface an append-only
  trail as a readable `(s)` field, add a projection-maintenance step to a write
  flow, retag a restructured boundary verb — keeping the spec `rune check`-clean.
  Also trigger on "nudge the runes to fit the data structure", "reconcile the spec
  to the data design", "make the spec use the ideal data model". It does NOT write
  adapters, and it does NOT author a `.rune` module from scratch (entities/DTOs/
  `[SRV]` from nothing, brand-new endpoints) → that is `rune:spec`; this skill only
  ADJUSTS an existing spec to fit the data design it just produced. NOT generating/
  filling the data-adapter code → use `rune:build`; NOT the runtime data clients or
  `[SRV]` transport wiring → `rune:framework`; NOT the cake's real-data walk →
  `rune:cake`.
user-invocable: true
argument-hint: "[module or feature whose data structure to design]"
---

# rune:data — orchestration playbook

The data-design layer of rune. The main session orchestrates three specialists —
survey → design → reconcile — and owns the **interactive store/retention decisions**
and the **terminal review gate**. The design comes first (`spec/misc/data.json`), then
minimal nudges to the existing spec; never the reverse.

## When this skill applies

Deciding how a module's data is stored — which store an entity belongs in, how to make
a flow append-only, how long data lives, what keys/indexes — or nudging the runes to fit
a finished design. NOT authoring a spec from scratch (→ `rune:spec`); NOT adapter code
(→ `rune:build`); NOT the runtime client/transport (→ `rune:framework`); NOT the cake
walk (→ `rune:cake`).

## Specialist roster

- **`rune-data-surveyor`** — read-only: runs `scan_spec.ts` + walks `spec/ui/**` →
  one inventory (entities, reads/writes, mutation candidates, access patterns). Runs
  `scripts/scan_spec.ts`.
- **`rune-data-designer`** — the judgment core: stores + immutability + retention +
  keys → writes `spec/misc/data.json`, validated to exit 0. Proposes ambiguous calls
  back. Runs `scripts/validate_data.ts`.
- **`rune-data-reconciler`** — minimal `.rune` nudges so flows exploit the design;
  `rune check` clean; re-scans to confirm. Runs `scripts/scan_spec.ts` to re-verify.

## The interactive decisions the main session owns (do NOT delegate)

Specialists PROPOSE with rationale; the main session CONFIRMS with the user:

- **The local-only gate** — single machine, no cloud/sync/client-direct reads? → one
  local store for everything: a single JSON file (`fs_json`) for the smallest projects
  (small bounded data, single writer, no indexed queries — prototypes/CLIs/utilities), or
  one SQLite file the moment it needs real queries/indexes/concurrency/growth. This flips
  the whole store strategy; confirm `fs_json`-vs-`sqlite` (and local-only itself) when ambiguous.
- **A genuine store tradeoff** — "Firebase or Deno KV?" on a split entity, or a
  deployment-preference call (use `AskUserQuestion`).
- **An ambiguous retention window** — "keep forever, or expire after N?" when the
  business window isn't inferable.

## The terminal review gate (the orchestrator owns it — fire it EVERY run)

However this skill runs — a fresh design, a re-run where `data.json`/`data.review.html`
already exist, or a reconcile-only pass — you FINISH by running
`deno run -A scripts/render_review.ts spec/misc/data.json` and **`open
spec/misc/data.review.html`** for the user. A file on disk is NOT the same as having shown
it: if you did not run `open` this session, you have not shown it. Never substitute a prose
chat summary for the visualizer (it supplements, never replaces). This gate stays in the
orchestrator (not a specialist) precisely because it must fire even on a reconcile-only
re-entry where no specialist runs. The orchestrator owns `scripts/render_review.ts` and
`evals/`.

## Flow

1. **(main session) Entry-mode** — fresh design, re-run (artifacts exist), or
   reconcile-only. For reconcile-only, skip to step 5 but still fire the review gate.
2. **Survey** → `rune-data-surveyor` (pass the spec dir, `spec/ui/`, project root, and the
   `scripts/scan_spec.ts` path). It returns the inventory + access patterns + mutation
   candidates. Summarize it.
3. **(main session) Resolve the interactive decisions** above with the user (local-only
   gate, any store tradeoff, retention windows), so the designer isn't guessing.
4. **Design** → `rune-data-designer` (pass the inventory, the confirmed decisions, the
   `scripts/validate_data.ts` path). It writes `spec/misc/data.json` (validated to exit 0)
   and returns the per-entity summary + any remaining PROPOSE item. Resolve those with the
   user and re-delegate if needed.
5. **Review gate (orchestrator)** — render + `open data.review.html`; collect the user's
   second-pass notes; fold them back via the designer if they change the design.
6. **Reconcile** → `rune-data-reconciler` (pass the validated `data.json`, the `.rune`
   files in scope, the `scripts/scan_spec.ts` path). It returns the spec diff + why each
   edit was forced + what it left untouched. **Show the diff to the user** (it's a change
   to their source of truth). If it reports a nudge that grew into re-modelling, hand to
   `rune:spec`.
7. **Review gate (orchestrator) — re-fire** after reconcile, then **hand off**: summarize
   the spec diff and stop. No adapters (`rune:build`), no re-modelling (`rune:spec`).

## Hard rule

The main session owns the interactive store/retention decisions and the terminal review
gate; it delegates survey, design, and reconcile to the named specialists and never
chooses a store, writes `data.json`, or edits a `.rune` inline.

## What's no longer here

The store rubric (local-only gate, Firestore/KV per-operation, S3 blobs), the immutability
strategies, the retention policies + mechanisms, the `data.json` shape, and the
reconcile-nudge patterns now live in the three specialists; this playbook keeps the
sequencing, the interactive decisions, and the review gate.
