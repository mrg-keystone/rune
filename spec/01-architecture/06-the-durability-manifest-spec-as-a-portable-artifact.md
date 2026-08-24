## The durability manifest — `spec/` as a portable artifact

A generated project's `spec/` is not a scratch area rune and sprig happen to
share — it is a **self-describing, versioned artifact** that either toolchain
(or a future third) can read and build against *without importing the other's
repo*. A durable, hand-editable **`spec/manifest.json`** at the artifact root
makes it self-describing: it declares a `formatVersion` and, per subtree, a
`{ class, owner, producer }` triple, where **class** is one of `durable`,
`merge`, or `derived` and governs write permission per the contract table
below. `owner` and `producer` are informational, not write-permission
fields — write permission is `class`'s job alone, never `owner`'s:

`manifest.json`'s top-level JSON container — pinned the same way the stamp
format is pinned, as the interop contract's container shape — is a single
top-level object, `{ "formatVersion": <int>, "subtrees": { "<pattern>": {
"class": ..., "owner": ..., "producer": ... } } }`. Each key in `subtrees`
is a path pattern relative to `spec/`'s own root, written in one of two
forms: a **literal path** with no wildcard characters, itself split by a
trailing slash into two shapes — a bare literal (`manifest.json`,
`contract/binding.md`) matches *exactly* that one path and nothing else;
a literal ending in `/` (`misc/scenarios/`, `contract/draft/`,
`contract/client/`) is a **directory-prefix literal**: it matches the
directory itself and every path beneath it, so a file inside a classified
directory (e.g. `contract/client/index.ts` under the `contract/client/`
entry) inherits that directory's class the same way a file under a `**`
glob would, rather than falling through to "no entry matches" — or a
**glob pattern**
using `*` (matches any run of characters except `/` — one path segment)
and `**` (matches any run of characters including `/` — zero or more
segments) — the two wildcard forms already used by the classification
table below (`runes/*.rune`, `ui/**`). `class` is required on every entry;
`owner` and `producer` are optional, and a reader treats an absent one as
unspecified (`null`) — consistent with them being informational rather
than write-permission fields. Precedence ("most specific path wins") is
resolved per candidate path in order: (1) a literal (no-wildcard) entry
beats any glob entry that also matches; (2) among remaining glob matches,
the entry with the greatest count of non-wildcard characters wins,
tie-broken by longest pattern string; (3) a reader that still finds two
entries tied on every rule above fails loud — the manifest is invalid —
rather than guessing which applies; (4) a candidate path under `spec/`
that matches **no** entry in `subtrees` — literal or glob — is
unclassified: the reader fails loud, refusing to build, rather than
defaulting the path to any class. An unclassified path is treated as
non-writable (the safe default), never assumed `derived` — a wrong
"derived" guess is what would let a build clobber a hand-authored file
the manifest simply forgot to list. Bringing an unclassified path under
the contract is a manifest-authoring problem (add a `subtrees` entry for
it), not a reader problem to paper over.

`owner` is one of `rune | sprig | shared` — which toolchain's concern the
subtree's *content* belongs to for discovery/tooling purposes (e.g.
`runes/*.rune` → `rune`, `ui/**` → `sprig`, `contract/**` → `shared`) —
purely descriptive, carrying no write authority. `producer` is a free-form
string naming the tool/command that last wrote the subtree (`hand` for
durable, hand-authored paths; a command name such as `rune-sync`,
`contract-build`, or `design-system-build` for `merge`/`derived` paths) —
useful for a reader that wants to know how to regenerate a stale path, not
for enforcement.

Both repos read the manifest to learn the layout + version and fail loud on
an out-of-range artifact:

`formatVersion` is a plain integer starting at `1`, incremented on any
manifest-format change (a new class, a new field, a changed
path-precedence rule). Each reader (rune, sprig) hardcodes the exact set
of `formatVersion` values it knows how to read; it fails loud — refuses to
build — if the artifact's `formatVersion` is not in that set, rather than
attempting a >= or best-effort read.

The three classes define exactly what a build may do to a path:

| Class | Contract — what a build may do to it |
| --- | --- |
| **durable** | Hand/agent-authored source. A build may **read** it and may **append additively + idempotently** (a re-run on unchanged input produces no diff), but must **never rewrite, rename, move, or delete** it as a build side effect. |
| **merge** | Machine-scaffolded, hand-enriched, **additive-only**. A build **adds** entries and **never clobbers** hand enrichments. |
| **derived** | Regenerable from `durable` + `merge`, or — per the provenance rule below — from a producing-toolchain source tree that lives outside `spec/` entirely (e.g. `contract/openapi.json` regenerates from rune's `src/<module>/**` — narrowed to the API-surface-determining subset, per [04-codegen.md § the contract artifact](../04-codegen/02-the-contract-artifact-spec-contract.md), which owns that narrowing's rationale — a source tree that is neither `durable`, `merge`, nor any classified `spec/` path); **never a source of truth**; safe to delete and rebuild within the toolchain that produces it (see the committed-exception clause below for paths a different toolchain must consume from checkout instead). Every `derived` artifact carries a **provenance hash** of its source — a universal, class-wide mechanism that makes staleness mechanically detectable, not a property of select paths. `.gitignore`-eligible **for a `derived` path rebuilt and consumed only within the toolchain that produces it**; a `derived` path a *different* toolchain builds against across the repo boundary (`contract/openapi.json`, `contract/client/` — see the classification table below) is the exception: it **must be committed**, never gitignored, because the cross-repo consumer reads it from checkout and has no way to regenerate it itself. The compare procedure is uniform across the class: a reader recomputes the hash over the path's current declared source set and compares it to the stamp stored alongside the artifact — the exact stamp field name and sibling-file format are pinned below; a mismatch (or a missing stamp) means stale, and the reader must rebuild or refuse to trust the artifact rather than use it as-is. |

The provenance hash algorithm is SHA-256, hex-encoded. The source set
follows the dependency already named for the two cross-repo-critical paths
in
[04-codegen.md § the contract artifact](../04-codegen/02-the-contract-artifact-spec-contract.md)
— `openapi.json` hashes the API-surface-determining subset of the
generated backend tree (`src/<module>/**`) it was composed from, narrowed
per that document's rationale (route/DTO/decorator declarations only, so
a dev-owned body edit that touches no API surface doesn't trip a false
staleness positive) — not the whole tree; `client/` hashes the
`openapi.json` bytes it was generated from. That second example shows a source set is **not** required
to terminate at a `durable`/`merge` root — a `derived` path may name
another `derived` path as its immediate source, chained. Chaining is
non-propagating: each path's stamp covers only its own immediate declared
source's *current* bytes, so it says nothing about whether *that* source's
own stamp is fresh. A reader that needs end-to-end freshness across a
chain (backend tree → `openapi.json` → `client/`) must walk every link and
check each stamp individually — a fresh leaf stamp alone does not prove
the chain is unstale. That walk is bounded by what the reader's own
checkout can access: rune, which has the backend tree, walks the full
chain. sprig has only the portable `spec/` artifact — it never checks out
`src/<module>/**`, which lives outside `spec/` in rune's repo — so it
cannot recompute the `openapi.json ← src/<module>/**` link. Per this
document's no-cross-repo-code-dependency thesis, that link is not sprig's
to verify: sprig trusts `openapi.json`'s stamp as rune's attestation that
the link is fresh, and recomputes only the link(s) whose declared source
set lives inside `spec/` itself — concretely, `client/ ← openapi.json`.
Each remaining `derived` path in the table below
(`contract/draft/`, the design-system twins, `misc/data.review.html`)
gets the same explicit treatment: its immediate source path(s) —
`durable`, `merge`, or `derived` — are named so this mechanism is
buildable for them. `contract/draft/` has no source named anywhere else
in this spec series, so it hashes the same API-surface-determining subset
of the generated backend tree `openapi.json` does (`src/<module>/**`,
narrowed per [04-codegen.md § the contract artifact](../04-codegen/02-the-contract-artifact-spec-contract.md),
which owns that narrowing's rationale), treated as that same document's
pre-ratification staging copy, produced ahead of `contract/binding.md`'s
hand review. The design-system twins (`ui/design-system/theme.cdn.css`,
`css-variables.json`, `manifest.json`) hash the durable canonical
`ui/design-system/theme.css` they're compiled from. `misc/data.review.html`
hashes the `merge`-class `misc/data.json` it renders (the `render_review.ts`
producer named for it). `misc/layout.md` is deliberately **not** in this
`derived` list: per
[05-the-canonical-generated-project-shape.md](05-the-canonical-generated-project-shape.md)
and [03-cli/01-command-surface.md § command surface](../03-cli/01-command-surface.md),
it is a one-time record `rune init` writes when it lays down the layout
decision — there is no regenerable file it derives from, so it fails the
`derived` contract's own "safe to delete and rebuild" test. It is
classified `durable` instead (see the classification table below): a
hand/agent-authored-equivalent record a build never rewrites, not a
projection of some other source.

The stamp field name and, for non-JSON or directory `derived` paths, the
`.hash` sibling format and location — pinned rather than left as examples,
as the interop contract itself for a doc whose thesis is "no cross-repo
code dependency" — are as follows. For a JSON `derived` artifact
(`openapi.json`, the design-system twins' `.json` members), the stamp is
a top-level `x-rune-provenance` object,
`{ "algorithm": "sha256", "hash": "<hex>" }`, matching the SHA-256
hex-encoding decided above. For a non-JSON file or a directory `derived`
path (`client/`, `misc/data.review.html`,
`ui/design-system/theme.cdn.css`), the stamp lives in a sibling file at
the same directory level named `<basename>.hash` for a file (e.g.
`data.review.html.hash` beside `data.review.html`) or `.hash` at the
directory's own root for a directory (e.g. `client/.hash` for `client/`);
its contents
are the same `{ "algorithm": "sha256", "hash": "<hex>" }` JSON object,
newline-terminated. A `<basename>.hash` (or directory `.hash`) sibling is
not itself a separately classified `subtrees` entry: it **inherits the
class of the artifact it stamps**, always — a stamp beside a `derived`
file is `derived`, regenerated in lockstep with the file it stamps,
regardless of what broader glob (`ui/**`, or an absent `misc/**`) would
otherwise match the stamp's own literal path. This is what keeps every
stamp sibling resolvable without a dedicated manifest entry of its own:
none is left unclassified for want of a `misc/**` glob, and none is
misclassified `durable` by falling through to a glob like `ui/**` that
covers its stamped artifact's neighborhood but not the artifact's own
(derived) class. A reader looks up the JSON field first and falls
back to the sibling file only for paths that are not themselves JSON.

The classification below is the **on-disk expression of the shared artifact
contract** — a bedrock rule, owned by neither toolchain:

| Class | Paths under `spec/` |
| --- | --- |
| **durable** | `manifest.json`; `product/spec.md`, `product/user-stories.md`; `runes/*.rune` (covers `runes/core.rune` — see [05-the-canonical-generated-project-shape.md](05-the-canonical-generated-project-shape.md), which places `core.rune` inside `spec/runes/` alongside the per-module specs, not at the `spec/` root); `ui/**` (design-system canonical `theme.css`, `<app>-prototype/` presentation + `objects/` + `commands.json`, `breakdown/`) **except the derived twins listed below**; `contract/binding.md`; `misc/cake.json`, `misc/scenarios/`; `misc/<m>.data.notes.json`; `misc/layout.md` (a one-time record `rune init` writes, not regenerable from any other `spec/` or source-tree path — see the provenance paragraph above) |
| **merge** | `misc/data.json`; `misc/heal-rules.json` — a directly declared `spec/manifest.json` subtree like every other path in this table |
| **derived** | `contract/draft/`, `contract/openapi.json` (hash-stamped), `contract/client/` (hash-stamped); design-system twins `ui/design-system/theme.cdn.css`, `ui/design-system/css-variables.json`, `ui/design-system/manifest.json`; `misc/data.review.html` — the "(hash-stamped)" tag on `openapi.json`/`client/` is emphasis, not a two-path special case: every path in this row carries the class's provenance hash per the `derived` contract above; those two are called out because their staleness crosses the repo boundary (they're what sprig builds against) — and, per the `derived` contract's committed-exception clause above, they are the two `derived` paths that must be committed rather than `.gitignore`d, since sprig reads them from checkout and cannot regenerate them |

Build scratch is **not** a `spec/` path — it is `derived`-class disposable
build output that used to live at `misc/build/**` and has been relocated
entirely outside the artifact, so it never appears in the table above:

Build scratch now lives at `<git-root>/.rune/build/**` — a git-root
sibling of `spec/` (alongside `.git/`), gitignored, so it is discoverable
by convention without polluting the durable artifact.

Precedence when paths overlap: the manifest carries one `class` per subtree,
and the **most specific path wins** — a named `derived` entry (e.g. the
design-system twins) overrides the broader `durable ui/**` glob that would
otherwise cover it. A builder resolving a path's class applies the
precedence rule pinned above: a literal entry beats any matching glob,
and among remaining glob matches the entry with the greatest count of
non-wildcard characters wins (tie-broken by longest pattern string) —
not pattern length alone.

The rule stated plainly: **a build never destructively mutates a `durable`
path.** Within the toolchain that produces a given `derived` path, you can
`git clean` that path and rebuild it to byte-identical output — except the
committed-exception paths (`contract/openapi.json`, `contract/client/`),
which a checkout of the *consuming* toolchain (sprig) cannot regenerate at
all, and so must never be deleted there; you can hand-edit any `durable`
path and a rebuild preserves it; `merge` paths only ever grow. This rule, plus `spec/manifest.json`, is what
makes `spec/` a **portable artifact**: it is the basis for a cohesive shared
spec with **no cross-repo code dependency** — the frontend and backend
toolchains meet only at the durable `spec/` artifact, each reading the
manifest to know what it may touch, and neither invoking (or knowing) the
other at build time.

This contract — the class table, the never-mutate rule, the manifest format —
is defined once in bedrock's artifact spec, outside both toolchains; each
conforms to it.

