## The canonical generated-project shape

What rune generates *into user projects* is specified by
`docs/canonical-shape.md` — a doc that lives in **this repo**
(rune's own top-level `docs/`, alongside the ADRs — see
[01-top-level-layout.md](01-top-level-layout.md)), auto-generated from
`keywords.json → canonicalPaths`
([08-language-tooling.md](../08-language-tooling/00-overview.md)); it is
never emitted into a generated project. The composed monorepo it describes
(pinned by `rune init`, recorded per-project in `spec/misc/layout.md`):

```
<git-root>/
  deno.json     # Deno workspace ["./ui", "./server"] — written unconditionally at init: by sprig's scaffold when sprig is present, by rune itself (the same fixed workspace) when sprig is absent — see [03-cli.md § Command surface](../03-cli/01-command-surface.md)
  serve.ts      # Deno.serve(Backend(Frontend)) — Backend from ./server/bootstrap/mod.ts; Frontend's import path is sprig's own ui/ export contract, out of scope for this spec — written unconditionally at init: by sprig's scaffold when sprig is present, by rune itself (the same composition root) when sprig is absent — see [03-cli.md § Command surface](../03-cli/01-command-surface.md)
  ui/           # the sprig UI package — scaffolded immediately by sprig when present at init; when sprig is absent, this slot stays unpopulated until the user runs `sprig init ui/` per rune's `ui/README.md` marker — see below (the ./ui workspace entry above is written either way)
  server/       # THE CODEGEN ROOT — a Deno workspace member, so it carries its own deno.json (below)
    deno.json   #   the workspace member's own config — written by `rune init` (overlaying the keep backend, either way sprig is present or absent) and merged on every `rune sync` (step 4): the import map that resolves the mandated `@` cross-directory alias (`@/` → `./`, the project root) and the `#` external-package aliases (`#assert`, `#std/assert`, `#std/path`, `#api-doc` among them) — the authoritative pin set and decorator compiler options are enumerated in, and owned by, [03-cli.md § `rune sync` semantics, step 4](../03-cli/02-rune-sync-semantics-that-matter.md), not restated here; `ui/`'s own config is sprig's export contract, out of scope for this spec
    bootstrap/  #   mod.ts + config.ts (create-once), modules.ts (regenerated), stubs.ts (ghost)
    src/
      core/     #   shared kernel generated from core.rune (see spec/runes/ below — never relocated here): business/<noun>/, data/<service>/, dto/ — core's data/ is keyed by shared service name ([SRV] is core.rune-only)
      <module>/ #   mod-root.ts + domain/business/<noun>/ + domain/coordinators/<noun>-<verb>/ + domain/data/<noun>/ + entrypoints/<surface>/ + dto/ — business/, coordinators/, data/, and entrypoints/ are containers of one leaf folder per noun/process/surface; a module's data/<noun>/ is keyed by the boundary step's noun, not a service name; a `[PLY]` noun's `business/<noun>/` is not itself a leaf — it expands into `base/` + `implementations/<case>/` (each carrying its own `mod.ts` + test file) plus a `poly-mod.ts` barrel — see the test-naming paragraph below for the full shape
  spec/         # shared authoring at the git root — the durable artifact
    manifest.json # self-describing artifact manifest — formatVersion + per-subtree {class, owner, producer} (see 06-the-durability-manifest-spec-as-a-portable-artifact.md)
    runes/      #   DURABLE home of the .rune specs — one per module, + core.rune (seeded by rune init); sync reads here, never relocates
    misc/       #   data.json, cake.json, scenarios/, layout.md, heal-rules.json (merge-class, ratified at `spec/misc/heal-rules.json` — see 06-the-durability-manifest-spec-as-a-portable-artifact.md)
    ui/         #   sprig prototype + design system
    product/    #   spec.md + user-stories.md (rune:scope output)
    contract/   #   the ratified contract: durable hand-authored binding.md + machine faces (OpenAPI + typed client)
```

When sprig is absent, rune's init marker is a `ui/README.md` stub, created
alongside the otherwise-unpopulated `ui/` directory. Its sole content is the
`sprig init ui/` command and the install-sprig fallback already given in
[03-cli.md § Command surface](../03-cli/01-command-surface.md).

`spec/runes/` is the **durable home** of the `.rune` specs — they are
authored and *kept* there. `rune sync` **reads** them in place and generates
code into `<pkg>/src/`; it **never relocates a spec out of `spec/`**. The
generated `src/<module>/` tree is a *projection* of the spec — regenerable,
spec-owned — while `spec/runes/` is the durable source of record. This
supersedes any earlier "staging dir" framing in which sync moved
`spec/runes/<m>.rune` into `src/`: the spec now stays put, and after a build
`spec/runes/` is never emptied.

`core.rune`'s durable home is `spec/runes/core.rune` at the git root — where
`rune init` seeds it and where it stays (like every other spec, it is never
relocated into `src/`). Core-spec resolution (`spec-root.ts`) is one ordered
candidate list, first existing file wins. The numbered list below is
authoritative. The durable home (#1) is probed at the git root only — it is
never nested under the codegen root — and the last-resort bare file (#10) is
probed at the codegen root only. The four legacy layouts in between (#2-#9)
each get a git-root probe immediately followed by a codegen-root probe
before the next layout is tried:

1. `spec/runes/core.rune` at the git root (the durable home)
2. `specs/runes/core.rune` at the git root
3. `specs/runes/core.rune` under the codegen root (the legacy nesting old fixtures use)
4. `spec/core.rune` at the git root
5. `spec/core.rune` under the codegen root
6. `specs/core.rune` at the git root
7. `specs/core.rune` under the codegen root
8. `src/core/core.rune` at the git root
9. `src/core/core.rune` under the codegen root
10. bare `core.rune` at the codegen root (last resort)

So the durable git-root copy beats every legacy copy, and within any one
legacy layout the git-root copy beats the copy nested under the codegen root
— and a legacy layout earlier in the list beats every probe (git-root or
codegen-root) of a later layout. The whole chain is then re-probed in the
same order for `.in-prog.rune` drafts — a finalized core always beats a
draft.

Structural rules enforced by the linter (the `structure` rule, driven by
`keywords.json → canonicalPaths`'s `$`-keyed ban lists —
[05-linter.md § Rule families](../05-linter/01-rule-families.md) is the
complete, authoritative list; it is not duplicated here): forbidden directory
names anywhere (`lib`, `modules`, `internal`, plus `core` anywhere but
`src/core`); flagged loose-file names — the complete
`$looseFileNames` set, matched as whole-word tokens (`utilization` passes):
`utils`, `helpers`, `common`, `shared`, `util`, `helper`; `mod-root.ts` is a
module's only external import surface — the surface bootstrap uses to reach
it (`module-isolation`: "bootstrap reaches modules only via `mod-root.ts`");
`core` carries no `mod-root.ts` of its own and is exempt from this
constraint: the `module-isolation` rule caps a module's *own* imports at
itself plus `core` — modules never import each other's `mod-root.ts` or
anything else of one another — and a module reaches `core` by importing
directly from its `business/`, `data/<service>/`, or `dto/` files, not
through a barrel
([05-linter.md § Rule families](../05-linter/01-rule-families.md)); `./`
imports for same-directory, `@` aliases cross-directory, `#` aliases for
external packages. Test naming: exact filenames, one co-located
test file per generated *code* folder — a "code folder" is a leaf folder that
directly holds a noun/process/surface's generated `mod.ts`: a business noun
folder (`test.ts` beside its `mod.ts`), a coordinator process folder
(`int.test.ts`), a data-adapter noun folder — including `core`'s own
`data/<service>/` — (`smk.test.ts`), an entrypoint surface folder
(`e2e.test.ts`), and a `[PLY]` noun's `base/` folder plus each of its
`implementations/<case>/` folders (`test.ts` each, scaffolded by
`rune-poly-cases`) — literal names, not `<stem>.int.test.ts`-style suffix
patterns. Every other folder in the tree carries no co-located test file:
`dto/` (a generated folder with no `mod.ts` slot of its own) and
`bootstrap/` (its `mod.ts` is not a noun/process/surface's generated
`mod.ts`, so it doesn't meet the code-folder definition above), `mod-root.ts` (the module's regenerated barrel, emitted with no test —
see the codegen pipeline's `module` row), and the pure container directories
that hold no `mod.ts` directly — `<module>/` itself, `domain/`, `core/`,
`src/`, `server/`, `business/`, `coordinators/`, `data/`, `entrypoints/`,
`implementations/` (the container of a `[PLY]` noun's per-`[CSE]` folders),
and a `[PLY]` noun's own `<noun>/` (unlike a plain business noun's `<noun>/`,
which is itself a code folder, a `[PLY]` noun's `<noun>/` holds only `base/`,
`implementations/`, and the `poly-mod.ts` barrel — never a `mod.ts` of its
own)
([04-codegen.md](../04-codegen/00-overview.md), [05-linter.md](../05-linter/00-overview.md)).

Note: this repo's own `spec/` directory (where this document lives) is
documentation about the rune project — the `spec/` convention above describes
*generated user projects*.

