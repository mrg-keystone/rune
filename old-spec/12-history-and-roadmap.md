# History, Decisions, and Roadmap

> Part of the [project spec series](README.md). Sources: `docs/adr/`,
> `docs/REBUILD-PROGRESS.md`, `todos/`, `upgrades.md`, `maybe/`, `feedback/`,
> and the historical `docs/phase2-*.md` planning docs.

## Architecture Decision Records (`docs/adr/`)

Eight made decisions (not open questions) from the Rune Studio rebuild's P0:

| ADR | Decision |
| --- | --- |
| 0001 | **One engine** — the TypeScript engine is the sole artifact-driven engine; Rust is retired from generation, LSP-only |
| 0002 | **Audience** — spec-author mode is the default surface; language-design is a separate expert/admin mode |
| 0003 | **Parser of record** — the engine parses with a TS parser driven by the artifact's tag table; tree-sitter is editor-only |
| 0004 | **Lint model** — declarative rule DSL for reducible rules + a typed code escape hatch; one registration interface |
| 0005 | **Layout source** — codegen path templates are canonical; `canonical-paths.json` is generated from them |
| 0006 | **Versioning** — the artifact carries `schemaVersion` (semver); ship migrations; stamp generated output |
| 0007 | **Governance** — locked org baseline + project overlay; provenance on every change |
| 0008 | **Axes** — target-independent `language` separate from N selectable per-target `codegen` profiles |

## The rebuild (`docs/REBUILD-PROGRESS.md`)

Seven work orders took the engine from hand-wired to artifact-driven, each
gated by the verify ladder ([10-testing-and-verification.md](10-testing-and-verification.md)):
WO-1 single-source registry (Drift), WO-2 verification foundation (corpus +
goldens), WO-3 artifact contract + meta-validator (L1), WO-4a–d
artifact-driven bindings / codegen templates / parse recognition / lint policy
(L2, L3, L4, L6), WO-5 shared interpreter with the Studio (L5), WO-6 tree-sitter
WASM build (grammar), WO-7 governance + migrations (L6 e2e, L7, governance). All
gates green.

**Scoped follow-ups (open):** parser structural dispatch (per-construct
dispatch still in code; needs a tag *role* field in the artifact), `rune-sig`
templating (sig/business/data templates not yet artifact-expressed), Studio
island previews (`lib/parse.ts`/`lint.ts` not yet wrappers over the engine),
the profiles UI (schema + L1 check exist; no pick/clone UI), and closing the
nested-`[PLY]` lenient-parse gap. Plus the post-relocation studio drift
recorded in [08-language-tooling.md](08-language-tooling.md) (broken
`keywords.json` path, stale README/aliases).

## The DX roadmap (`todos/`) — complete

A seven-task, agent-dispatchable work plan (shared `00-context.md` + one task
file per worker; note its repo paths and `@^1` pins describe an older layout —
historical). All seven landed: (01) generated isolation seeds in per-surface
e2e tests, (02) contract auto-wiring + `stub` metadata, (03) ghost-stub
generation + evaporation, (04) the lifecycle acceptance fixture, (05)
`rune dev`, (06) the system map at `/docs/_map`, (07) the docs/skill/release
sweep. Its release-order rule persists: **keep first, then rune**. The
`docs/phase2-*.md` files are the earlier planning docs for generating real
keep controllers from `[ENT]`s and the cake acceptance — both realized (the
e2e suites are their living descendants).

## The diamond (`upgrades.md`) — the strategic direction

The plan (started 2026-06-30) that merges the sprig (frontend) and rune
(backend) pipelines. The insight: the two tracks aren't parallel lines
hand-wired together at the end — they're a **diamond**: one product intent at
the top, two tracks down the sides, **one contract at the waist**, one running
composed app at the bottom (`Deno.serve(Backend(Frontend))`).

- **The waist rule:** the contract is **queries** (current-state read DTOs)
  and **commands** (intent verbs) — never an "edit-this-record" endpoint.
  This is load-bearing: rune:data reshapes storage to be immutable/append-only
  *below* the waist, and because the contract is queries + commands, that
  reshaping never breaks the frontend.
- **Bridge 1 (up):** the sprig prototype is born with the contract
  pre-extracted as two seams — `objects/<type>.json` (reads) and
  `commands.json` (intent verbs with a `kind` vocabulary:
  create/set/append/adjust/remove that seeds the immutability strategy).
  rune:spec consumes them as its seed inventory and **ratifies** them.
- **Bridge 2 (down):** everyone derives from the ratified contract —
  sprig:breakdown binds components to real endpoints + DTOs (drift is a
  checkable error), sprig:build generates a typed client from rune's OpenAPI.
- On-disk home: `spec/contract/` (generated OpenAPI + typed client + the
  prototype-seeded draft + the binding).

Status: the two-seam prototype format, the shared `spec/`, and the runtime
merge were already done when the doc was written; the waist rule, both
bridges, and the conductor now live in the skills
([09-claude-skills.md](09-claude-skills.md) — rune:spec, rune:data,
rune:diamond).

## Parked proposals (`maybe/`)

`single-owner-runtime-and-hmr.md` (draft, 2026-07-02): after two prod-only
sprig incidents (a dual-runtime bundle killing island hydration), proposes
making the sprig CLI the single owner of the runtime and the emitted bundle
the single source of truth for dev and prod, plus HMR without dev/prod skew.
Parked in this repo because its conclusion for rune is **"rune changes
nothing"** — keep is re-`bootstrapServer`'d in-process behind a mutable
handler and needs no HMR.

## Field feedback (`feedback/feedback.md`)

A report from rebuilding a real product ("arachne", a scatter/gather HTTP flow
orchestrator) through the full diamond on rune 4.2.0 — including an
adversarial 92-agent debug sweep that reproduced 21 real bugs *past a green
`lint --strict` suite*. What worked: the event-sourced fold, the in-process
client, accurate boot diagnostics, colocated test conventions. What it drove
(already landed): the hardening-category test rows required by
rune-build-analyst, rune:diamond's rung-0 git preflight, the
`@Internal`/`@InProcessOnly` decorator, `onStart`/`onStop` lifecycle hooks,
the pinned composed-repo layout (`spec/misc/layout.md`), the `[TYP:json]`
parseability modifier, and the loud `INFRA_URL` 3.x→4.x upgrade note (since
removed along with the rest of keep's auth — keep is now auth-agnostic; an app
brings its own). Still
open from it: first-class typed array/object DTO fields (the "JSON-in-string"
ergonomics problem — today list/object fields ride JSON-encoded strings), and
carrying parse status on the dispatch wire instead of silent
parse-with-fallback.

## Current state, summarized

- Engine, runtime, language tooling, skills, releases: **working and gated**
  (verify ladder green; e2e suites pin the spec→runtime contract).
- **Auth: out of scope.** keep is now **auth-agnostic** — the former
  deny-by-default infra-only trust model (`INFRA_URL`/JWKS/bearer,
  `@Public`/`@Grant`/`@LoggedIn`, sessions, `getIdentity`,
  break-glass/revocation, the docs control-plane gate) has been **removed**; an
  app brings its own auth.
- **Wired but dormant:** governance / migrations / artifact lint-config exist
  behind the artifact contract with tests but no CLI entrypoint
  ([05-linter.md](05-linter.md)).
- **Known drift:** Rune Studio's registry path and docs after the
  `ln/` → `rune-studio/` relocation ([08-language-tooling.md](08-language-tooling.md)).
- **Direction:** deepen the artifact-driven cutovers (parser dispatch roles,
  sig templating, Studio island previews), close the nested-`[PLY]` gap, and
  keep executing the diamond.
