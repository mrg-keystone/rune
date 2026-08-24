## Heal rules

`heal-rules.json` is a declarative, **merge-owned** map from API error slugs
(`"not-found"`, `"already-exists"`) to the one-click fixes the cake's heal
panel executes ([07-cake.md § the heal panel](../07-cake/02-the-cake-docs-module.md)).
Sync scaffolds it from the spec's declared fault slugs, adds any new slug a
later sync discovers, and never clobbers a hand-enriched entry — the general
durable/merge/derived write-discipline this file's `merge` class sits inside
is [01-architecture.md § the durability manifest](../01-architecture/06-the-durability-manifest-spec-as-a-portable-artifact.md)'s
to define.

### Shape

One entry per slug:

```json
{
  "<slug>": {
    "todo": <bool>,
    "fixes": [ <fix>, ... ]
  }
}
```

- `todo` sits on the **entry**, not per-fix: it is `true` on every slug sync
  scaffolds fresh (sync knows only that the slug exists, never what the fix
  should be, so `fixes` starts empty) and flips to `false` only by hand, once
  real fixes are authored — sync itself never writes `false`.
- `fixes` is an **ordered list**: a slug may carry more than one suggestion,
  rendered in array order. Each `fix` carries a `kind` (below), that kind's
  payload fields, and an optional `why` string rendered beside its label.

**Golden path.** Sync's fresh scaffold for a `not-found` fault:

```json
{
  "not-found": {
    "todo": true,
    "fixes": []
  }
}
```

The same entry, hand-enriched:

```json
{
  "not-found": {
    "todo": false,
    "fixes": [
      {
        "kind": "run-step",
        "target": "create-widget",
        "why": "The referenced widget doesn't exist yet — create it first."
      },
      {
        "kind": "note",
        "label": "Check the id you're passing matches a widget that exists.",
        "why": "not-found means the id resolved to nothing in the store."
      }
    ]
  }
}
```

### Fix kinds

`kind` is a closed vocabulary — the panel's full execution semantics
(reference resolution, capture aggregation, and the rest) belong to
[07-cake.md § the heal panel](../07-cake/02-the-cake-docs-module.md); here is
every kind a `fix` object may hold and what the panel does with it:

| `kind` | Payload | What the panel does |
| --- | --- | --- |
| `run-step` | `target` (exact step id) or `match` (`"/regex/flags"` or bare substring, over ids) | Runs the matched not-yet-green step |
| `set-input` | `target` (variable name), `value` | Writes `value` into the named shared variable |
| `pick` | `fromPlural` (array field name), `target` (variable name) | Offers that field's elements (aggregated across captures) as a dropdown; Apply writes the picked element into the shared variable named `target` (no body field is touched) |
| `retry` | — | Re-sends the failing step; retry-kind slugs also feed `/docs/_run`'s transient retries |
| `note` | `label`, `why`, `retryAfter?` | Renders as guidance text with no Apply button; `retryAfter: true` appends a Retry offer |
| `remove-key` | `target` (top-level body key) | Deletes that body key and re-sends the step |
| `set-body-field` | `target` (top-level body key), `value` | Sets that body key to `value` and re-sends the step |

Any other `kind` is ignored (forward compat) — an entry the panel doesn't
recognize renders nothing, never errors.

### Location

Sync scaffolds the file where the heal panel actually reads it: keep's
cake-config resolution ([07-cake.md § module setup & spec/misc/cake.json](../07-cake/02-the-cake-docs-module.md))
resolves the one fixtures directory holding `cake.json`, `heal-rules.json`,
and `scenarios/` to the nearest git root's `spec/misc` when that root has a
`spec/` — which it does in the canonical composed layout, since `rune init`
lays the shared `spec/` down at the git root. So the file lands at
`<git>/spec/misc/heal-rules.json`, and the panel fetches it from there via
`GET /docs/_heal-rules`. This is the settled location: `spec/misc/heal-rules.json`,
a directly declared `spec/manifest.json` subtree like every other path in
[01-architecture.md § the durability manifest](../01-architecture/06-the-durability-manifest-spec-as-a-portable-artifact.md)'s
classification table, and the same path [03-cli.md § rune sync semantics
that matter](../03-cli/02-rune-sync-semantics-that-matter.md) step 8 derives
for the same file.

### Entry lifecycle

An entry moves along two independent axes: whether it has been hand-enriched,
and whether its slug is still declared in the spec.

| State | Slug still in spec? | `todo` | How sync reports it | Blocks `lint --strict`? |
| --- | --- | --- | --- | --- |
| Fresh | live | `true` | scaffolded (or left as-is, with a standing enrichment nudge on every later sync) | Yes |
| Enriched | live | `false` | left as-is — nothing to report | No |
| Enriched, stale | gone | `false` | "kept — prune by hand" | No |
| Stale orphan | gone | `true` | "kept — prune by hand" | Yes — until enriched or hand-pruned |

**Enriched** means a human has edited the entry — real `fixes` plus `todo`
flipped to `false`; sync performs neither half of that on its own.
`rune lint --strict` ([05-linter.md § --strict](../05-linter/02-strict.md),
rule `rune-heal-todo`) tests exactly one predicate — **`todo: true`, and
nothing else**. An entry with `todo: false` and an empty or dubious `fixes`
list still passes: fix-content quality is a hand-review concern, not
something the gate adjudicates.

`rune-heal-todo` reads `heal-rules.json` from its resolved location — the
same `spec/misc/heal-rules.json` the [Location](#location) section above
derives — via project-root resolution, not by walking `server/`: the same
mechanism the rune-derived rule family uses to find `spec/runes/`
([05-linter.md § rule families](../05-linter/01-rule-families.md)). Since
`spec/` sits at the git root in the canonical composed layout, this
resolution reaches `heal-rules.json` regardless of where the lint walk's
root is rooted, so a `todo: true` entry does block `--strict` as the table
above states.

Slugs whose fault leaves the spec are kept, never auto-deleted, and every
sync reports them as stale. This is deliberate: a hand-enriched entry is
irreplaceable work — the fix a person worked out for that fault — and a
fault gone from today's spec can return tomorrow, so pruning it is a call
only a human gets to make. It's also why a stale orphan blocks `--strict`
rather than resolving itself: an entry nobody ever enriched, orphaned by a
fault that has since left the spec, is exactly the dead weight the gate
exists to surface, not paper over.

