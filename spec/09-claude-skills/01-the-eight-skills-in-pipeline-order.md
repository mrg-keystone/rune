## The eight skills, in pipeline order

Eight skills split into three kinds. Five form the **spine** —
rune:scope → rune:spec → rune:data → rune:build → rune:cake — a linear
pipeline where each skill's Produces is the next skill's Consumes, one
skill per rung of the ladder below (rungs 1, 5, 6, 7, 8). Two are
**advisors** — rune:framework and rune:docs — invoked on demand rather
than in sequence: neither holds a rung of its own (see the ladder below),
each answers questions about a running surface (the runtime/deploy split,
doc and example correctness) without consuming a spine artifact, and each
routes any real fix back out to the spine skill that owns it rather than
applying the fix itself — except rune:framework's `-deploy` specialist,
which itself edits serve/composition wiring, a surface owned by no spine
skill. The eighth, rune:diamond, is the **conductor**: a
diamond drawn over all seven others, sequencing the rune spine and the
sibling sprig skills together and gating every rung on disk, but
performing none of a stage's work itself. The table below marks each
skill's kind in its own column.

### The skill table

| Skill | Kind | Consumes → Produces | Role |
| --- | --- | --- | --- |
| **rune:scope** | spine | an idea → `spec/product/spec.md` + `user-stories.md` | The product-definition layer before any `.rune`: a structured discovery interview (thesis, roles, goals/non-goals, the core mechanism, `[DECIDE]` decisions with defaults, an M0..Mn milestone ladder, risks, feasibility). Interactive in the main session; only story derivation is delegated (`rune-scope-story-deriver`). It ships its own **house-style source** — the exemplar pair `references/example-spec.md` + `references/example-user-stories.md` (a real, signed-off portable dev-workstation product) to internalize once and reproduce, no toolchain to run — plus a concrete authoring methodology: a **13-section `spec.md` anatomy** (among them: title/thesis, the called-out *heart*, explicit non-goals, architecture, key flows, milestone table, risks, verdict), the `[DECIDE — D-<slug>]` **decision discipline** (each open fork marked inline with a recommended default, collected in a *Decisions to confirm* section, promoted to a *Settled this round* recap once the user picks — the spec never stalls on an open question), and a **walking-skeleton-first `M0..Mn` ladder** where `M0` is the thinnest end-to-end thread proving the riskiest assumption. Ends at sign-off, handing the inventory to rune:spec — not a separate artifact: `spec/product/spec.md` itself must make the four inputs explicit (deployable surfaces → `[MOD]`s, externally-callable endpoints/triggers → `[REQ]`s — the request logic; whether each one is reachable over HTTP is decided later, when rune:spec fronts the owning module with an `[ENT]`, entities → `[NON]`s (the domain-noun tag — see [02-language.md](../02-language/00-overview.md))/`[DTO]`s, external services → `[SRV]`s), and the handoff is that inventory summarized in-session, plus the two-seam paths when a prototype exists. `[ENT]` itself is not one of scope's four inputs — it has no scope-side origin; see rune:spec's row for where it's declared. |
| **rune:spec** | spine | the inventory (+ the prototype's two seams) → a `rune check`-clean `spec/runes/<m>.in-prog.rune` | Authors the DSL. The main session owns granularity decisions — one `[REQ]` = one feature, `[ENT]` is the only HTTP surface: rune:spec declares one `[ENT]` per served module, fronting whichever of that module's `[REQ]`s scope flagged as externally-callable endpoints/triggers — an endpoint is a `[REQ]` for its logic plus the `[ENT]` that exposes it over HTTP; a module with no externally-callable `[REQ]`s gets no `[ENT]` and stays a pure library, never HTTP-reachable — then the **waist rule** (queries + command verbs, never edit-a-record). Delegates the author/check loop to `rune-spec-author`. Stops at the clean draft deliberately, once the user signs off — the `.in-prog`→`.rune` rename happens later, at rune:build's scaffold (see the `.in-prog` lifecycle below). Its `references/` (spec.md, constraints.md, cookbook.md, example runes) are auto-synced from `lang/docs/` + `examples/todos/`. |
| **rune:data** | spine | the specs + the UI prototype → `spec/misc/data.json` (+ minimal, additive-idempotent spec nudges) | Persistence design: store selection (`fs_json` smallest / SQLite local-only / Firestore vs Deno KV per-operation / S3 blobs), immutable append-only restructuring, conscious retention/TTL per entity. Three specialists: surveyor → designer → reconciler. A **mandatory terminal review gate** fires on **every** run — a fresh design, a re-run over existing artifacts, or even a bare re-entry that spawns no data specialist at all and only regenerates the review (it's orchestrator-owned precisely so it fires on every entry into rune:data): `scripts/render_review.ts` renders `data.json` into a human-readable `spec/misc/data.review.html` — a per-store storage map ("where it lives"), one example stored record per entity, append-only-collection annotations ("old entries never change"), retention badges (∞ kept forever vs ⏱ expires/purges), and a per-entity notes textarea that saves `spec/misc/<module>.data.notes.json` — which the orchestrator `open`s for the user (a file on disk is not the same as having shown it), then folds the second-pass notes back through the designer if they change the design. The reconciler's spec nudges are **additive-idempotent** on the durable `.rune` source: a re-run on an unchanged design produces **no diff**, and a nudge only ever *adds* a `[TYP]` property or a child `[DTO]` to a storage-only construct the design newly requires — a `[NON]`-backed entity's persisted shape, or a `[DTO]` referenced only from a `db:` boundary step — and never to a `[DTO]` that appears in any `[REQ]`/`[ENT]` input or output; it never rewrites or reorders authored lines, so hand edits are safe and the source round-trips. Stays *below the waist*: a nudge never touches a `[REQ]`/`[ENT]` signature — the read DTOs or command surface stay exactly as authored — and never destructively mutates the durable spec. |
| **rune:build** | spine | a clean spec + data.json → an implemented, tested, `lint --strict`-clean module | The agentic factory: scaffold → analyst → test-author fleet → impl fleet → validators → linter — the numbered flow and its orchestration policy (artifacts on disk, worktree isolation, the landed-write gate, capped fleets, the two-watcher loop) are below the main table. |
| **rune:cake** | spine | the built module(s) → a proven, green end-to-end walk | Real data, no mocks: the interactive cake walk in the main session (pin Expectations into `spec/misc/cake.json`, record Scenarios into `spec/misc/scenarios/<name>.json` — both concepts and the `cake.json` shape are defined in [07-cake.md](../07-cake/00-overview.md)), the unattended drive-and-heal loop delegated to `rune-cake-e2e-driver` (`POST /docs/_run` via the in-process client). Owns the cause→owner routing for red steps — see the routing table below the main table. The orchestrator never applies a fix itself. |
| **rune:framework** | advisor | questions about the *running* runtime | A pure router over two read-mostly specialists, each owning one reference: runtime (`bootstrapServer`'s `{listen, stop, backend, handler, docs}`, the in-process backend client, `@Endpoint`/runner semantics, the headless runner, the `/docs/_map` system map, `@WsEndpoint`), deploy (serve/composition — the `Backend`/`Frontend` model, `withBasePath`, Deno Deploy). |
| **rune:docs** | advisor | doc/example complaints → the exact spec edit | The Swagger surface specialist (`rune-docs-advisor`, read-only): diagnoses `@ApiProperty`/`example=` issues, prescribes the `.rune` edit, routes the fix to rune:spec. |
| **rune:diamond** | conductor | everything above | The whole-flow conductor: the 13-rung ladder below plus a rung-0 git preflight (born from a field report where a build ran in a broken checkout), every rung gated on its on-disk artifact; modes **new** / **finish** (census the tree, resume at the frontier — scanning the gates in ladder order from rung 0 up, the first rung whose gate fails with all earlier rungs green) / **upgrade** (classify a change by altitude — product / contract / below-the-waist / presentation — and propagate through exactly the affected stages). Drives the two contract bridges itself; sequences the sprig and rune stage skills; never performs a stage's work. |

**The rune:build factory** runs six stages in order:

1. **Scaffold** — finalizes the spec in place (see the `.in-prog` lifecycle below), then runs `rune sync`, red by design: sync **reads** the spec from `spec/runes/<m>.rune` and **generates** the module under `<pkg>/src/<m>/`, leaving the durable spec exactly where it lives. Finalize is not unconditional: it **refuses on collision** — if a hand-authored `<m>.rune` already sits beside the `.in-prog` draft, finalize errors, exit 2, naming both paths, rather than overwrite it (see [02-language/07-comments-and-file-conventions.md](../02-language/07-comments-and-file-conventions.md) and [03-cli/02-rune-sync-semantics-that-matter.md](../03-cli/02-rune-sync-semantics-that-matter.md) step 5).
2. **Analyst** — maps intent and enumerates every test, including required **hardening rows**: cross-entity, crash/restart, representation, off-path lifecycle, wire seams.
3. **Test-author fleet** — one agent per file, writes real failing tests (TDD, RED first).
4. **Impl fleet** — fills bodies. One file per agent is the shape the skill pins: each impl agent is handed all of its file's pending methods, matching `rune-build-method-impl`'s contract (worktree-isolated — the fleet runs with `isolation: "worktree"` so parallel body edits to a shared `mod.ts` don't collide; each agent edits only its worktree copy and runs no git operations; on merge-back the skill pins only "merge after" the wave). The wave's worktrees are file-disjoint by construction, so merge-back is a clean per-file copy and conflicts cannot arise — the skill's no-repo fallback already uses this same one-agent-per-file shape to guarantee disjoint writes.
5. **Validators** — fresh per-batch (≤10 tests, one suite run per batch against the pinned baseline).
6. **Linter** — `lint --strict` plus heal-rules enrichment.

The orchestration policy this factory runs under: **artifacts on disk, paths in
prompts** — the scaffold writes `<pkg>/.rune-build/<m>/baseline.md` (the
pinned red/green baseline) and `facts.md` (the `resolved_paths` from the
build's one `deno info` — `spec`/`deno_json`/`assert_import`/`test_cmd`/
`port`/`bootstrap_entry`…); the analyst writes `module-map.md` (sectioned per
targetFile) + `test-inventory.json`. All four are **derived, transient build
scratch that lives OUTSIDE `spec/`** (a non-spec, gitignore-able build cache,
`<pkg>/.rune-build/<m>/`, never the old `spec/misc/build/<m>/`), so the
durable `spec/` artifact carries no build scaffolding; fleet prompts carry
each agent's own rows plus those absolute paths and **`RUNE_BIN`** (the rune
invocation, so no agent runs `which rune`), never the map/baseline inline. A
**landed-write gate** greps the claimed file for a real assertion before
accepting a return, so a lost write can't pass as a vacuous green. Fleets are
**capped at 4–6 concurrent in chunked waves**, halving the chunk on a
rate-limit storm rather than relaunching the full fan-out into the same
quota. The main session runs a **two-watcher loop** — `rune dev` (the live
app + `/docs/<m>` cake: check→sync→restart) and `deno test --watch` (the
green loop) — because `rune dev` does NOT run `deno test`. No filesystem
crawling.

**rune:cake's cause → owner routing** for red steps:

| Cause | Owner | How the fix lands |
| --- | --- | --- |
| Walk wiring — a wrong `order`/`dependsOn`/`bind` in the controller decorator | the driver | fixed in-loop; if the underlying cause is spec-level, it still routes to rune:spec |
| Stale entrypoint controller / unimplemented or wrong body / heal-rule enrichment | rune:build | rune:build fixes the generated code |
| Missing `[TYP:example=]` / an echo that should mint / a contract fix | rune:spec | rune:spec edits the `.rune` source |
| A vacuous walk over a module meant to be served (no `[ENT]`, so `/docs/<m>` 404s or 0 rows run) | rune:spec, then rune:build | rune:spec declares the `[ENT]`, then rune:build re-syncs — never hand-wired (a conscious pure-`[REQ]` library module is simply not walked) |
| The runner option surface / `bootstrapServer` | rune:framework | advisory, not a fixer: its specialists diagnose and prescribe the minimal fix (cause + cited rule + evidence), then rune:framework routes the real edit back out to its owner (a spec change → rune:spec, a generated-body/test fix → rune:build); only its `-deploy` specialist edits at all, and only serve/composition wiring |
| A per-endpoint Swagger example | rune:docs | rune:docs prescribes the `.rune` edit and routes it to rune:spec |

The orchestrator itself never applies a fix — every row above routes the edit
to its owner.

### The shared interaction mechanism (AskUserQuestion)

Where a row says a skill's decisions are "interactive in the main session,"
the shared mechanism is the **`AskUserQuestion`** tool: the main session — never
a subagent — owns the genuine product/design forks and surfaces each as a
question with the recommended option listed first. rune:scope batches its forks
into propose-and-correct rounds; rune:spec confirms genuine modeling forks
(endpoint-vs-step, where a `[SRV]` boundary sits, whether polymorphism is real);
rune:diamond classifies a change's altitude this way (and, on a
partial-ladder-plus-change-request, whether to finish-then-upgrade or fold the
change in now); and rune:data adds a dedicated **interactive gate** — the
local-only `fs_json`-vs-SQLite call, a genuine store tradeoff, an ambiguous
retention window, and whether an append-only trail surfaces upward (a product
decision that crosses the waist) are all resolved with the user before the
specialists design.

### The sprig hand-off

The frontend half of the pipeline (sprig:design, sprig:prototype,
sprig:breakdown, sprig:build, sprig:audit) lives in the sibling sprig repo;
rune:diamond sequences both sides. See
[12-history-and-roadmap.md](../12-history-and-roadmap/00-overview.md) for the diamond model
itself.

### The ladder rune:diamond walks

The ladder rune:diamond walks (a rung is done only when its gate holds on
disk — most rungs gate on validity: a checker's exit code, a test suite, a
drift count. A minority gate on presence alone — rungs 1, 2, 3, and 4, the
stages that hand off static artifacts with no mechanical validator behind
them — see their rows below for what a presence-only gate can't catch):

| # | Rung | Owner | Gate — done when |
| --- | --- | --- | --- |
| 0 | Preflight | conductor | `git rev-parse --is-inside-work-tree` true and `git status` runs without error (no repo → init + commit first; a repo whose `git status` errors is a hard stop — build fleets would run without worktree isolation) |
| 1 | Scope | rune:scope | `spec/product/spec.md` + `user-stories.md`, user signed off on both — sign-off is not recoverable from disk, so the census treats both files existing as signed off unless the user says otherwise |
| 2 | Design | sprig:design | `spec/ui/design-system/` — `theme.css` + derived files present (presence-only, like rungs 1/3/4 — no mechanical check that the tokens themselves are valid) |
| 3 | Prototype | sprig:prototype | clickable `spec/ui/<app>-prototype/` declaring the two seams: `objects/<type>.json` + `commands.json` |
| 4 | Bridge 1 | conductor | the prototype's two seam files (`objects/` + `commands.json`) are snapshotted **up** to the contract as its seam/binding input — the mirror holds by construction, since bridge 1 copies them verbatim from the prototype (or `contract snapshot` emits them — that CLI and its sibling `contract client`, which generates bridge 2's typed client at rung 9, both ship in the `@dev-tools/contract` package). This is **not** `spec/contract/draft/`: per [04-codegen/02](../04-codegen/02-the-contract-artifact-spec-contract.md), that path is reserved for rune's own `draft/openapi.json` — the down-side (Bridge 2) OpenAPI staging copy, stamped against the generated backend tree, not the up-side seam snapshot. The seam snapshot itself has no separate on-disk home — it feeds the contract's ratified `binding.md` as a dev's hand-authoring input (see below the ladder) — and the census probes for that snapshot's presence, not a byte or structural diff |
| 5 | Ratify | rune:spec | per-module `spec/runes/<m>.rune`: `rune check` exit 0, no `.in-prog` left, waist rule holds — the waist clause has no mechanical probe (`rune check` doesn't test it; the skill glosses it as "no PUT/PATCH-a-record"): it is enforced interactively by rune:spec at ratification, where any edit-a-record ask is redesigned as a command with the user, and the finish census's rung-5 probe checks only the `rune check` and no-`.in-prog` clauses |
| 6 | Data | rune:data | `spec/misc/data.json` validates (`validate_data.ts` exit 0) |
| 7 | Build ×N | rune:build | per module: tests green, `rune lint --strict` clean, run-all verdict green (or `skipped` for a pure `[REQ]` module) |
| 8 | Backend e2e | rune:cake | `/docs/<m>` run-all green headlessly via `POST /docs/_run` (a 2xx replay of every step, on real data), per `[ENT]`-bearing module — a conscious pure-`[REQ]` module has no `/docs/<m>` surface to walk and carries its rung-7 `skipped` verdict instead; `spec/misc/cake.json`'s pinned Expectations are browser-only, checked during the interactive cake walk that pins them, not evaluated by the headless replay, so they are not part of this automated gate |
| 9 | Bridge 2 | conductor | `spec/contract/openapi.json` + `spec/contract/client/`, no older than the newest `.rune` (stale counts as missing) |
| 10 | Breakdown | sprig:breakdown | `spec/ui/breakdown/` + `spec/contract/binding.md`, zero drift errors |
| 11 | App build | sprig:build | isolates green vs the breakdown; production-build smoke passes |
| 12 | Merge | sprig:build | merge smoke passes: a real request against the composed `Deno.serve(Backend(Frontend))` process returns rendered SSR output and a working island, both from the one process |
| 13 | Verify | sprig:audit | `fixes.md` with no open issues |

Bridge 1's seam snapshot (the prototype's `objects/` + `commands.json`, copied
up as the contract's seam input at rung 4) has no on-disk home of its own: it
feeds the contract's ratified binding — the working input a dev consults when
hand-authoring `binding.md` — rather than landing as a new sibling of
`draft/`. That keeps
[04-codegen/02](../04-codegen/02-the-contract-artifact-spec-contract.md)'s
four-member `spec/contract/` table (`binding.md`, `draft/`, `openapi.json`,
`client/`) at four members: `draft/` stays reserved for rune's own
`draft/openapi.json` staging copy (the down-side Bridge 2 OpenAPI, stamped
against the generated backend tree), never the up-side seam snapshot.

### The `.in-prog` lifecycle (rungs 5–7)

The `.in-prog` lifecycle spans rungs 5–7 by design: rune:spec deliberately
terminates at the clean, signed-off `spec/runes/<m>.in-prog.rune` draft, and
the rename that closes rung 5's "no `.in-prog` left" clause — dropping the
infix to `<m>.rune` **in place in `spec/runes/`** — is
`rune-build-scaffold`'s first act, before `rune sync`. That rename is not
unconditional: finalize **refuses on collision** — if a hand-authored
`<m>.rune` already exists beside the draft, it errors, exit 2, naming both
paths, rather than silently overwrite (see
[02-language/07-comments-and-file-conventions.md](../02-language/07-comments-and-file-conventions.md)
and [03-cli/02-rune-sync-semantics-that-matter.md](../03-cli/02-rune-sync-semantics-that-matter.md)
step 5). The spec has exactly one durable home once the rename succeeds:
`rune sync` reads it from `spec/runes/<m>.rune` and generates the code tree
under `<pkg>/src/<m>/`, but **never moves or renames the spec out of
`spec/`**. The census does not special-case the draft
state: its rung-5 probe looks for the spec only in that durable home —
`spec/runes/<m>{.in-prog,}.rune` — and applies the `rune check` and
no-`.in-prog` clauses there, so a clean spec still carrying `.in-prog`
reports red and the frontier is rung 5 — and the resume walks the ladder
forward from there in order, exactly as in `new` mode, never back into
re-authoring: rune:spec's re-invocation terminates immediately at its
handoff (the draft is already clean and signed off), rung 6's rune:data then
runs against the draft, and rune:build's scaffold at rung 7 performs the
in-place rename that finally closes the clause — provided no `<m>.rune`
already sits beside it. When both `<m>.in-prog.rune` and `<m>.rune` are
present, finalize refuses instead: the finish census's rung-5 probe stays
red, and the ladder pins at rung 5 pending manual resolution — the author
merges or removes one of the two files. There is no automated path through
the collision; the scaffold surfaces it rather than silently overwriting.
The infix never blocks rung 6: rune:data's `scan_spec.ts`
collects specs by the `.rune` suffix, which `<m>.in-prog.rune` still carries,
so the data survey runs against the draft as-is.

### Upgrade mode: altitude → rungs

Upgrade mode's altitude→rung mapping is pinned in the skill (never skip a
rung inside a propagation set):

| Altitude | Enter at (rung) | Propagate through | Re-verify |
| --- | --- | --- | --- |
| **Product** | 1 (a delta interview, not a re-scope) | every rung whose input changed — typically 3→4 (if rung 3 moved the seams) →5→6→7→8→9→10→11 for the touched surface | cake + audit |
| **Contract** (the waist moves) | 3 (the change made visible in the prototype seams), breaking for both sides | 4→5→6 (if storage shifts) →7 (affected modules) →8→9 (refresh OpenAPI + client) →10 (re-check binding drift) →11 | cake + audit |
| **Below the waist** | 6 | 6→7 (affected modules) →8, contract and frontend untouched | cake only |
| **Presentation** | 2 (tokens) or 10 (structure) | 10→11 (rung 12 unchanged), backend untouched | audit only |

Notes:

- **Product**: the pinned list is 3→4 (whenever rung 3's re-run moves the
  seams) →5→6→7→8→9→10→11 for the touched surface — rung 4 (Bridge 1) joins
  the propagation set on the same condition as the Contract row, which also
  lists it: the "every rung whose input changed" clause is the governing
  test, and rung 3 re-running and moving the seams' content is exactly that
  clause firing. This can't lean on the finish census as a safety net:
  rung 4's gate is presence-only (see its row above; the same kind of probe
  as rung 3's — see the Presentation note below), so a stale seam snapshot
  is never flagged after the fact — the upgrade path itself must re-run
  rung 4 explicitly whenever rung 3 moves the seams, or the staleness ships
  undetected and every later rung builds on it.
- **Presentation**: on a token entry the pinned set skips rung 3 with no
  stated exemption — the skill never re-runs the prototype on token changes.
  Rung 3's gate does not go red over it: the census probe checks only the
  seams' presence (`objects/*.json` + `commands.json`), which tokens don't
  move — so the prototype's visuals go quietly stale against the new design
  system and no later finish census reports it; the audit re-verify on the
  rebuilt app is the only check that sees the new tokens rendered.

