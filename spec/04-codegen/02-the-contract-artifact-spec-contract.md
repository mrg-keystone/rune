## The contract artifact — `spec/contract/`

`spec/contract/` is the committed, versioned face of the backend's API — what
lets downstream consumers, the typed client and the sprig frontend, build
**with no rune backend present**. It has four members. Class semantics
(`durable`/`derived`, the provenance-hash mechanism, the exact stamp format,
and the committed-not-gitignored exception) are owned by
[06-the-durability-manifest-spec-as-a-portable-artifact.md](../01-architecture/06-the-durability-manifest-spec-as-a-portable-artifact.md)
and only summarized here:

| Member | Class | Produced by | Stamped against | Consumed by / committed? |
| --- | --- | --- | --- | --- |
| `binding.md` | durable | hand-authored; a dev reviews `draft/` and hand-edits this file to match — see the promotion rule below | — (durable, no stamp) | the contract of record both toolchains read; committed |
| `draft/` | derived | rune's build, from the same composed backend `openapi.json` is | the generated backend tree (`src/<module>/**`) | pre-ratification staging copy (`draft/openapi.json`) that informs `binding.md`'s hand update; not committed the way `openapi.json`/`client/` are, and not itself a cross-repo consumer target (06) |
| `openapi.json` | derived | rune's build, composing the app's OpenAPI document | the generated backend tree (`src/<module>/**`) | the `contract client` tool and, transitively, sprig; committed — a cross-repo committed-exception (06) |
| `client/` | derived | the `contract client` tool, from `openapi.json` | the `openapi.json` bytes it was generated from | the sprig frontend; committed — a cross-repo committed-exception (06) |

`openapi.json` is committed rather than regenerated on demand so consumers
read it offline instead of booting the app to scrape `/docs/<m>/json` — see
below for where in the pipeline rune itself produces it.

**Promotion.** `binding.md` is promoted to reflect a reviewed `draft/` by
hand: promotion is a hand action — a dev reviews `draft/openapi.json`
against the actual API surface and, informed by that review, hand-edits
`binding.md`'s prose narrative to match, as part of the same commit that
ships the spec change. This is a **review gate, not a format conversion**:
`binding.md` stays a hand-authored narrative document in its own right — the
same way it is durable and hand-authored everywhere else in this doc — never
derived from `draft/`'s OpenAPI JSON. The machine faces do **not** gate on
it: `openapi.json`/`client/` regenerate from the generated backend tree on
every contract-emitting build regardless of `binding.md`'s state, so a
lagging review never blocks the typed client or sprig, only the
hand-authored narrative contract.

The stamps make a stale contract **fail loud** rather than drift silently —
but "regenerate" and "fail loud" are two different builds' jobs, and which
one applies to the `openapi.json ← src/<module>/**` link depends on whether
the build in question is **emitting** the contract or **verifying** it:

- **rune's contract-emitting build** (the golden path below) is the **EMIT**
  context: it recomposes `openapi.json` from the `src/<module>/**` it just
  generated and re-stamps it against those same bytes, writes
  `contract/draft/openapi.json` as a staging copy of that same composed
  document stamped against the same `src/<module>/**` bytes (the
  pre-ratification copy a dev reviews before hand-updating `binding.md`'s
  narrative to match — see the promotion rule above), then regenerates
  `client/` from `openapi.json`
  and re-stamps it in turn. All the stamps it writes describe output it just
  produced, so this build can never observe any of the three links as stale
  — it always leaves them fresh by construction. This is the context the
  promotion rule above describes ("regenerate ... on every
  contract-emitting build").
- A **VERIFY** context recomputes a stamp against what is already committed
  **without** regenerating, and fails the build on a mismatch instead of
  fixing it. **sprig**'s build is the one VERIFY context this doc can name:
  it has only the checked-out `spec/` artifact, never `src/<module>/**`, so
  it cannot recompute `openapi.json`'s backend-tree stamp and doesn't try —
  it trusts that stamp as rune's attestation that `openapi.json` matches the
  backend it shipped with — and instead recomputes the one link whose
  declared source lives inside `spec/` itself: `client/ ← openapi.json`. A
  sprig build that only touches `spec/contract/` therefore still fails loud
  on a stale `client/`. That is what lets the frontend build from the
  committed `spec/contract/` files alone — the hash chain, not a live
  backend, guarantees they are in sync, for the one link sprig can check.

That split leaves a gap: nothing above verifies the
`openapi.json ← src/<module>/**` link without also regenerating it — rune is
the only party with the backend tree, and rune's only defined context for
touching that link is the EMIT build, which overwrites rather than checks.
"The fail-loud edge" below needs a VERIFY-only rune context to fire in — one
that recomputes the stamp against the tree on disk and fails the build
without regenerating, catching a hand-edit that landed between two
contract-emitting builds instead of letting the next one silently re-stamp
over it.

**The VERIFY-only link check.** rune exposes this VERIFY-only check for the
`openapi.json ← src/<module>/**` link as `rune check --contract`: a distinct,
opt-in mode of `rune check` — CI's job, not the per-cycle dev loop's — rather
than behavior folded into the plain, default `rune check` that `rune dev`
runs every cycle. [03-cli/01-command-surface.md § command
surface](../03-cli/01-command-surface.md) owns the command surface and
already ratifies this split: the plain check stays parse-and-validate-only,
untouched by contract work, while `--contract` is the opt-in
provenance-recompute mode; this document only names what `--contract`
verifies and where that verification is defined. Recomputing a stamp and
comparing it is a read, not a write, so `--contract` still fits the
command's zero-writes, errors-only contract — it just does so as a separate
mode rather than work the default check always pays for.
`rune check --contract` recomputes `openapi.json`'s stamp against the
*whole* composed backend tree on disk (every module's `src/<module>/**`,
independent of any single `<file.rune>` argument) and exits 2 on a mismatch
— the same way the plain check exits 2 on a spec validation error — without
writing anything, giving a dev or CI a way to catch drift before the next
contract-emitting `rune sync` quietly re-stamps over it. Because rune,
unlike sprig, has both the backend tree and `spec/contract/` in the same
checkout, `--contract` walks the **full** chain, not just the backend link:
it also recomputes `client/`'s stamp against `openapi.json`'s bytes on disk
and exits 2 on that mismatch too — the same `client/ ← openapi.json` link
sprig's VERIFY context checks, so a hand-edit to `openapi.json` that stales
`client/` is caught by `rune check --contract` as soon as it's run, not only
later by a sprig build. Before any contract-emission pass has run,
`spec/contract/` doesn't exist yet, and `--contract` is a no-op — exit 0,
nothing to verify — rather than a failure.

**When it runs.** `openapi.json`'s stamp covers the *whole* composed backend
tree (`src/<module>/**` across every module), not one module's slice of it,
so contract emission needs every module's generated output on disk and
stable — it runs after every module's `rune sync` (and that sync's own step
10, the [run-all
gate](../03-cli/02-rune-sync-semantics-that-matter.md)) has completed. It
does **not**, however, depend on that gate's verdict: the run-all gate is
soft on every failure mode and `--no-run` skips it outright ([03-cli § rune
sync semantics](../03-cli/02-rune-sync-semantics-that-matter.md)), so by the
time emission runs, the composed backend may never have been confirmed to
boot, or may have been confirmed *not* to boot, while `rune sync` still
exited 0. Contract emission instead performs its **own** boot of the
composed backend — the same boot it needs anyway to scrape
`/docs/<m>/json` per module (described below) — and that boot's
success is a hard precondition of emission itself: if the app fails to boot,
or a module's `/docs/<m>/json` route doesn't come up, emission fails the
build, independent of whatever the (advisory) run-all gate reported earlier
in the same session.

**Contract emission is a separate pass**, not a numbered step appended to
`rune sync`'s existing ten. This turns on how a single `rune sync`
invocation is scoped: 03-cli/02's ten-step list is framed per-module (step
5: "`spec/runes/<module>.rune` is ... sync reads it *there* and generates
code into the root's `src/<module>/`") and ends at step 10 with no
contract-emission step and no stated way to detect "every module has now
been generated" — a single invocation processes one module under
`spec/runes/`, not every module in one run. A dev (or a wrapping script)
runs the emission pass once after every module's own `rune sync` has
completed, regardless of that sync's own (advisory) run-all verdict —
emission's own boot check, described below, is what actually gates it. This
keeps 03-cli/02's step list accurate for what one invocation does, since a
single per-module sync has no way to know whether *other* modules' specs
still need generating. 03-cli/02, as the canonical owner of sync's step
sequence, should name this pass explicitly (e.g. as an eleventh, whole-spec
step that only runs once all per-module syncs are done); this document only
defines what contract emission does, not when a `rune sync` invocation's own
steps end.

**How rune obtains `openapi.json`'s contents.** rune boots the composed
backend and scrapes its live `/docs/<m>/json` per module — with a boot
**dedicated to emission**, not a reuse of the run-all gate's subprocess: the
gate's boot is advisory (soft on every failure mode, skippable via
`--no-run` —
[03-cli § rune sync semantics](../03-cli/02-rune-sync-semantics-that-matter.md))
and may not have happened, or may have happened and failed, while `rune
sync` still exited 0, so emission cannot assume that boot is available or
trustworthy. Instead, contract emission boots the full composed backend
itself (`bootstrap/mod.ts`, every synced module's surfaces registered) in
its own subprocess immediately before scraping, and **fails the emission
build** if that boot doesn't come up or a module's `/docs/<m>/json` route
doesn't respond — rather than falling back to a static compose path that
could drift from the live document, and rather than trusting the earlier
gate's advisory verdict.

**Golden path (the EMIT context).** A dev edits `spec/runes/task.rune`,
adding a field to `TaskDto`, and runs `rune sync`. Sync regenerates
`src/task/**`; once every module is synced the backend tree is stable and
contract emission runs: `openapi.json` is recomposed and re-stamped with a
hash of that tree, say `H1`; `contract/draft/openapi.json` is written as a
staging copy of that same composed document, stamped with the same `H1`, for
the dev to review before hand-updating `binding.md`'s narrative to match;
`contract client` regenerates `client/` from the new `openapi.json` and re-stamps it with a
hash of *those* bytes, say `H2`. The dev commits `spec/contract/openapi.json`
(stamp `H1`) and `spec/contract/client/` (stamp `H2`) alongside the spec
edit. A sprig build — the VERIFY context — checks out `spec/contract/`
alone, recomputes the hash
of `openapi.json`'s bytes on disk, compares it to `client/`'s stamp `H2`,
finds a match, and builds the frontend against `client/` — never touching
`src/task/**`, which its checkout doesn't even have.

**The fail-loud edge (the VERIFY context).** A dev edits
`spec/runes/task.rune`, adding a new route to the module, and runs `rune
sync` — regenerating `src/task/**` with the new endpoint's declaration — but
forgets to run the separate contract-emission pass afterward (the pass
described above). A `rune check --contract` run (the VERIFY-only context
named above) recomputes the whole composed backend tree's hash and
gets `H1'` (the new route changed the API-surface-determining part of the
tree), which no longer matches the `H1` stamped into the committed
`openapi.json`, and fails — catching a contract that has genuinely drifted
from the backend it now describes, before a sprig build (or any other
consumer) trusts a stale `openapi.json`.

**The hash source set is narrowed** to only the API-surface-determining
subset of `src/<module>/**` (route/DTO/decorator declarations — the parts
that actually shape the OpenAPI document), not the whole generated backend
tree. Hashing the whole tree would trip the check above on *any* dev-owned
body edit, even one that touches no API surface: filling in the body of a
create-once, dev-owned file under `src/task/domain/data/` — the normal "Edit
the body" implementation step ([00-overview](00-overview.md);
[03-cli § rune sync semantics](../03-cli/02-rune-sync-semantics-that-matter.md)),
not a deviation from the spec — changes the tree's hash even though the
adapter's request/response shape, and so the actual API surface, never
changed. Narrowing the source set means the fail-loud edge above fires only
when a change could actually move the contract (like the route-adding
example above), not on every dev-owned implementation edit.

