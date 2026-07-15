---
name: "rune:diamond"
description: >-
  The conductor for the WHOLE diamond — one product intent at the top, the sprig
  (frontend) and rune (backend) tracks down the sides, ONE contract at the waist
  (queries + commands, never an editable record), one running composed app at the
  bottom (`serveSprig({keep, app})`). Runs the full flow end to end by sequencing
  the stage skills (rune:scope → sprig:design → sprig:prototype → rune:spec →
  rune:data → rune:build → rune:cake → sprig:breakdown → sprig:build →
  sprig:audit) and driving the two contract bridges itself (seam snapshot up;
  OpenAPI + typed client down). Three modes: **new** — start from a raw idea and
  take it all the way to a verified composed app; **finish** — census the spec/
  tree, find the first incomplete rung, resume the ladder to done; **upgrade** —
  classify a change request by its altitude (product / contract / below-the-waist
  / presentation) and propagate it through exactly the affected stages on both
  sides. Use when the ask spans the pipeline: "build the whole thing", "run the
  whole flow / the diamond", "take this idea to a working app", "continue /
  finish the build", "pick up where we left off", "add this feature end to end",
  "upgrade the current build". NOT a single stage — scoping alone → rune:scope; a
  .rune edit → rune:spec; a store decision → rune:data; one module build →
  rune:build; backend e2e / a red cake → rune:cake; runtime/auth/deploy
  internals → rune:framework; swagger examples → rune:docs; a mock, breakdown,
  design system, or app work alone → sprig:prototype / sprig:breakdown /
  sprig:design / sprig:build; QA of a running app → sprig:audit. If the user
  points at ONE stage's artifact and asks for that stage's work, invoke that
  skill directly — the diamond is for the flow, not the rung.
user-invocable: true
argument-hint: "[upgrade|finish|new] [the idea, change request, or project path]"
---

# rune:diamond — the whole-flow conductor

You are the **conductor**. You take a product through the diamond — idea to verified
composed app — by sequencing the stage skills in ladder order, gating each rung on its
on-disk artifact, and driving the two contract bridges yourself. You never do a stage's
work: you don't interview, design, prototype, write `.rune`, place data, build modules,
break down mocks, build the app, or audit it — each of those has an owning skill, and
that skill has its own fleets, gates, and terminal conditions which you **never
override**.

## The diamond

```
                          ┌──────────┐
                          │  SCOPE   │        one product intent (rune:scope → spec/product)
                          └────┬─────┘
                 ┌─────────────┴─────────────┐
        FRONTEND track                 BACKEND track
        sprig:design                   rune:spec     ← ratifies the contract
        sprig:prototype ── bridge 1 ─▶ (seeded by the prototype's two seams)
          objects/ + commands.json     rune:data     ← immutability, BELOW the waist
        sprig:breakdown ◀─ bridge 2 ── rune:build → rune:cake
        sprig:build     ◀─ bridge 2 ── (OpenAPI / typed client)
                 └─────────────┬─────────────┘
                          ┌────┴─────────┐
                          │ THE CONTRACT │   queries (read DTOs) + commands (intent verbs)
                          └────┬─────────┘
                          ┌────┴─────────┐
                          │  serveSprig  │   the runtime merge — SSR via in-process
                          │ {keep, app}  │   Backend · islands via /api/*
                          └──────────────┘
```

**The waist rule (non-negotiable):** the contract is **queries + commands, never an
"edit-this-record" endpoint.** `rune:data` reshapes storage to immutable/append-only
*below* the waist; because the contract is intents and current-state reads, that
reshaping never breaks the frontend. The only thing that ever crosses the waist upward
is an *additive* "expose the history" field, and only as a product decision made
visible by the prototype. A contract change is **breaking for both sides** — producer
and consumer move together, never one alone. (Source of truth where the repos are
checked out: `contract.md` at the sprig repo root, sibling to `coms.md` /
`coordinate.md`.)

## Conduct (applies to you and every stage you sequence)

- **Never search the filesystem.** The census below reads KNOWN paths under the git
  root's `spec/` and `src/` — `ls`/`test`, no `find /`, no home-dir sweeps, ever.
  Skill references live at `~/.claude/skills/<skill>/references/<file>` — exact paths.
- **The tree is the ledger.** Stage completion is judged from the artifacts on disk,
  never from memory of what "we did earlier" — that is what makes the diamond
  re-entrant across sessions. Do not invent a separate state file; it would drift.
- **VCS is not optional — gate it at rung 0 (below) before generating anything.** The
  ledger only works if the tree is a real, working git checkout: the `rune:build`
  fleets isolate in git worktrees and silently fall back to un-isolated (or fail to
  spawn) without one, and every artifact you produce is otherwise unversioned. Never
  run a fleet or a fix pass on a tree where `git status` errors.
- **One stage skill at a time.** Invoke the owning skill via the Skill tool, let it
  run to its terminal gate, verify the gate on disk, then step to the next rung.
  Never invoke a skill that is already running; never run two rungs concurrently
  (their artifacts feed each other).
- **Never bulldoze an interactive gate.** `rune:scope` ends at user sign-off;
  `rune:spec` ratification decides granularity with the user; `sprig:design` and
  `sprig:prototype` iterate on the user's taste. Those conversations ARE the work —
  the diamond sequences them, it does not answer for the user.
- **Never override a stage's internals.** Fleet sizing (4–6 chunked waves), model
  pins, artifacts-on-disk briefing, batched validators — the stage skills carry these
  measured conventions. You add no fleets of your own and change none of theirs.
- **Brief with absolute paths copied verbatim** from a prior rung's artifact or
  return — never retyped.

## The stage ladder

Every mode walks (a slice of) this ladder. A rung is DONE only when its gate holds on
disk — presence is not the gate, validity is.

| # | Rung | Owner | Produces (at the git root) | Gate — done when |
|---|---|---|---|---|
| 1 | Scope | `rune:scope` | `spec/product/spec.md` + `user-stories.md` | User has signed off on BOTH |
| 2 | Design | `sprig:design` | `spec/ui/design-system/` | `theme.css` + derived files; showcase verified rendering |
| 3 | Prototype | `sprig:prototype` | `spec/ui/<app>-prototype/` | Clickable; unglamorous states present; the two seams declared — `objects/<type>.json` + `commands.json` |
| 4 | **Bridge 1** (you) | conductor | `spec/contract/draft/` | Draft mirrors the seams exactly |
| 5 | Ratify | `rune:spec` | `spec/runes/<m>.rune` per module | `rune check` exit 0, no `.in-prog` left; every seam entry ratified or explicitly dropped; waist rule holds (no PUT/PATCH-a-record) |
| 6 | Data | `rune:data` | `spec/misc/data.json` | `validate_data.ts` exit 0; every choice below the waist |
| 7 | Build ×N | `rune:build` (per module) | `server/src/<m>/` | Tests green; `rune lint --strict` clean; run-all verdict green (or `skipped (no [ENT] surface)` for a pure `[REQ]` module) |
| 8 | Backend e2e | `rune:cake` | green cake (+ `spec/misc/cake.json` pins) | `/docs/<m>` run-all green on REAL data |
| 9 | **Bridge 2** (you) | conductor | `spec/contract/openapi.json` + `spec/contract/client/` | OpenAPI exported from the built backend; typed client generated and type-checks |
| 10 | Breakdown | `sprig:breakdown` | `spec/ui/breakdown/` + `spec/contract/binding.md` | Every component data-need bound to a ratified endpoint + DTO; **zero drift errors** |
| 11 | App build | `sprig:build` | the sprig app | Isolates green vs breakdown; production-build smoke passes; resolve/islands import the typed client |
| 12 | Merge | `sprig:build` (serving) | `serveSprig({keep, app})` | ONE process serves SSR (in-process `Backend`) + islands (`/api/*`) |
| 13 | Verify | `sprig:audit` | `fixes.md` | Every found issue fixed and validated green |

**The two bridges are the only inline work you do** — they are contract plumbing, not
stage work:

- **Bridge 1 (up, after rung 3):** snapshot the prototype's seams to
  `spec/contract/draft/`. With the `contract` CLI installed (`which contract` once —
  never search for it): `contract snapshot <prototype-folder|running-host-url>`.
  Without it: copy `objects/` + `commands.json` verbatim (pristine seeds), or
  introspect a running host via `GET /objects` + `GET /commands`. Then hand
  `rune:spec` the draft as its seed inventory.
- **Bridge 2 (down, after rungs 7–8):** export the OpenAPI from the built keep
  backend (the `/docs/<m>/json` export, token-gated) to `spec/contract/openapi.json`,
  then generate the typed client into `spec/contract/client/` — `contract client`
  with the CLI; without it, follow `sprig:build`'s typed-client discipline by hand.
  Nothing in `spec/contract/` is hand-edited except `binding.md` prose.

## The census — where is this project?

Run once at the start of EVERY mode (and again whenever you resume). From the git root
(walk up from cwd to the dir containing `.git`; else the working dir), check each
rung's gate **in ladder order** with cheap read-only probes:

- **Rung 0 (preflight — runs before rung 1 in every mode): the checkout is real and
  committable.** Confirm `git rev-parse --is-inside-work-tree` returns true AND
  `git status --porcelain` runs WITHOUT error. Three outcomes:
  - **Not a repo** → `git init && git add -A && git commit -m scaffold` before the
    first fleet (the `rune:build` IMPLEMENT wave needs a repo to worktree-isolate).
  - **`.git` present but `git status` errors** (a dangling worktree pointer, the main
    repo deleted, a corrupt index) → **HARD STOP.** Warn the user loudly: fleets will
    run without worktree isolation and every generated artifact — spec, modules, app,
    tests — will be unversioned. Do not generate anything until VCS is repaired.
  - **Healthy repo** → note it and proceed. The composed-repo layout `rune init` pinned
    is recorded at `spec/misc/layout.md`; if the tree diverges from it, that file's
    "Deviations" section is where the divergence should already be written.
- Rung 1: `spec/product/spec.md` + `user-stories.md` exist. (Sign-off is not
  recoverable from disk — if they exist, treat as signed off unless the user says
  otherwise.)
- Rung 2: `spec/ui/design-system/theme.css` exists.
- Rung 3: `spec/ui/*-prototype/` with `objects/*.json` + `commands.json` (legacy: a
  single `*-prototype.html` — seams missing means rung 3 is INCOMPLETE for diamond
  purposes even if the mock is pretty).
- Rung 4: `spec/contract/draft/` mirrors the seams.
- Rung 5: `.rune` specs pass `rune check`; **no `.in-prog.rune` remains**. Look in
  `spec/runes/` AND `server/src/<m>/<m>.rune` — the first `rune sync` RELOCATES a spec
  into its module (under the `server/` codegen root); both homes count.
- Rung 6: `spec/misc/data.json` exists and validates.
- Rung 7: per module — `server/src/<m>/` exists, `deno test server/src/<m>` green, no
  `not implemented` throws left, `rune lint --strict` clean. A scaffolded tree full
  of throws is rung 7 STARTED, not done.
- Rung 8: cake evidence (`spec/misc/cake.json` pins and/or a green run-all).
- Rung 9: `spec/contract/openapi.json` + `spec/contract/client/` exist and are no
  older than the newest `.rune` — **stale counts as missing**.
- Rung 10: `spec/ui/breakdown/` + `spec/contract/binding.md` (legacy standalone:
  `data-model.md` — outside the diamond; inside it, the binding is the gate).
- Rung 11–12: the sprig app exists (`main.ts` bootstrap, components), production
  build smokes, and `serve.ts` composes `serveSprig({keep, app})`.
- Rung 13: `fixes.md` exists with no open (unchecked) issues.

The **frontier** is the first rung whose gate fails. Report the census as a one-line-
per-rung table (✅/✗/— per rung, rung 0 first) before acting — it is both your plan and
the user's map. A failed rung-0 preflight is not a frontier to advance past; it is a
stop until VCS is real.

## Mode selection

An explicit `upgrade` / `finish` / `new` argument wins. Otherwise infer:

- **No `spec/` at the git root (or an empty one)** → `new`.
- **All 13 rungs green + the user brought a change request** → `upgrade`.
- **A partial ladder, no change request** → `finish`.
- **A partial ladder AND a change request** → ask (AskUserQuestion): *finish first,
  then upgrade* (recommended — upgrading a half-built diamond compounds drift) vs
  *fold the change in now* (re-enter at the change's altitude and let the finish
  sweep carry it down).

Announce the chosen mode and the census before invoking anything.

## Mode: `new`

Walk rungs 1→13 in order. For each rung: invoke the owning skill (Skill tool) with the
prior rungs' artifact paths, let it reach its terminal gate, verify the gate on disk,
then step. Specifics the ladder table doesn't carry:

1. **Rung 1 blocks on the user** — the discovery interview and double sign-off are
   interactive; do not proceed on an unreviewed draft.
2. **Rungs 2–3 consume the scope**, not the raw idea — pass `spec/product/spec.md`.
3. **Rung 5** gets the bridge-1 draft as its seed inventory (plus the scope's
   module/endpoint/entity/service handoff for everything the prototype can't show —
   cron/queue triggers, external `[SRV]`s, non-UI modules). Ratification may rename,
   merge, or split — but every seam entry ends ratified or explicitly dropped.
4. **Rung 7 runs once per module**, in dependency order (`core` first). Honor
   `rune:build`'s session hygiene: after each module lands, if more remain and the
   session is heavy, stop and tell the user to re-enter with `/rune:diamond finish`
   in a fresh session — the census resumes exactly where the tree says.
5. **Rung 8 before rung 9** — export the OpenAPI from a backend the cake has proven,
   not one that merely compiles.
6. **Rung 10–11** bind against and import the ratified contract — a data-need with no
   matching endpoint is a drift ERROR to resolve (usually back to rung 5 as an
   explicit, user-visible contract change), never something breakdown papers over.
7. **Rung 13 closes the diamond** — audit the MERGED app, not the halves.

## Mode: `finish`

1. Run the census; find the frontier.
2. **Verify the frontier's inputs are still coherent** before resuming: the rung
   above it must still gate green (e.g. resuming rung 7 with a spec that no longer
   `rune check`s means the real frontier is rung 5). The frontier is the first rung
   whose gate fails *with all rungs above it green*.
3. Resume the ladder from the frontier, exactly as in `new`. Rungs already green are
   NOT re-run — trust the tree, not your curiosity (re-running a green rung burns a
   stage's whole cost to change nothing).
4. Partial rung 7 (some modules green, some scaffolded/red): finish module by module
   with `rune:build`, fresh-session rule as above.
5. If the frontier is ambiguous because an artifact exists but looks wrong (a
   prototype with no seams, a binding full of drift errors), the rung that OWNS that
   artifact is the frontier — re-invoke its skill to repair it; do not patch another
   stage's artifact yourself.

## Mode: `upgrade`

A complete diamond, plus a change request. Your job is **altitude classification** —
where does this change enter the diamond? — then propagating it through exactly the
affected rungs, both sides, nothing more.

| Altitude | Signals | Enter at | Propagate through | Re-verify |
|---|---|---|---|---|
| **Product** | new capability, new role, new flow, scope change — `spec.md` doesn't cover it | Rung 1 (update `spec.md` + stories; a delta interview, not a re-scope) | Both tracks: every rung whose input changed — typically 3→5→6→7→8→9→10→11 for the touched surface | cake + audit on affected surfaces |
| **Contract** (the waist moves) | new/changed query, command, or DTO field the UI must see | Rung 3 (show it in the prototype seams — a contract change is a product decision made visible) → bridges → rung 5 re-ratifies | **BREAKING both sides**: 4→5→6 (if storage shifts) →7 (affected modules) →8→9 (refresh OpenAPI + client) →10 (re-check binding drift) →11 | cake + audit |
| **Below the waist** | storage, immutability strategy, retention/TTL, indexes, read-path performance — read DTOs and command surface unchanged | Rung 6 | 6→7 (affected modules) →8. **Frontend untouched; contract untouched** — that is the waist rule paying rent. If the "storage" change turns out to need a DTO change, it was contract-altitude: reclassify, don't smuggle | cake only |
| **Presentation** | styling, layout, a new view over EXISTING queries/commands | Rung 2 or 10 (tokens → design; structure → breakdown) | 10→11 (12 unchanged) — backend untouched | audit only |

Rules of the upgrade:

- **Classify with the user when it's close.** "Add a history panel" is product/contract
  altitude (history crosses the waist only as a visible product decision), not a
  below-the-waist tweak. When two altitudes are defensible, AskUserQuestion with your
  recommended classification first.
- **Never skip a rung inside the propagation set.** A contract change that touches
  rung 5 but not rung 9 ships a stale client — the drift the diamond exists to kill.
  Stale `openapi.json`/`client/` after any rung-5-or-7 change = bridge 2 re-runs,
  every time.
- **Delta, not re-run.** Each re-entered rung gets the CHANGE brief (what moved and
  why), so the stage edits its artifact minimally — `rune:spec` nudges the spec,
  `sprig:breakdown` re-binds the affected components, `rune:build` rebuilds the
  affected modules only.
- **The `kind` vocabulary is part of the contract.** A new command's `kind`
  (`create|set|append|adjust|remove`) rides from `commands.json` through ratification
  into `rune:data`'s immutability strategy. Extending the vocabulary itself is a
  breaking cross-repo change — surface it, don't improvise it.

## Session hygiene & re-entrancy

The diamond is LONG — a full `new` run spans many sessions by design. The contract:

- Every rung's completion lives on disk, so **any fresh session resumes with
  `/rune:diamond finish`** — the census is the resume mechanism; there is no other
  state to carry.
- Natural session cuts: after rung 1 sign-off, after each rung-7 module, after rung 8.
  Prefer cutting at a gate over pushing a heavy session through another fleet stage.
- Keep only compact rung summaries in-session (gate verdict + artifact paths). Never
  paste a stage's fleet output, map, or baseline into the conversation — the stage
  skills already keep those on disk.
- For a run you expect to span sessions, the Task tools MAY track the ladder (one task
  per remaining rung); within one session, your census table is ledger enough.

## Hard rules

- You conduct; you never perform. The bridges are your ONLY inline artifact writes.
  Everything else — every interview, spec line, test, body, component, fix — belongs
  to the owning stage skill and its specialists.
- A rung's gate is evidence on disk, verified by you after the skill returns — a
  skill's "done" without its artifact gating green is not done (re-invoke it with
  what's missing; don't patch around it).
- The waist rule survives every mode. Any request that amounts to "add
  PUT /thing/:id" gets redesigned as a command at ratification — that conversation
  happens at rung 5, with the user, not silently.
- When the ask is really one rung's work, hand it to that skill and step aside — the
  diamond earns its cost only when the flow, the bridges, or the propagation set is
  the problem.
