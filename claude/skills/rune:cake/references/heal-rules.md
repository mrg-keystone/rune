# Self-healing — the heal panel, `POST /docs/_heal`, and the heal-rules schema

When a cake step fails, a **⚠ heal** panel opens under it. It works in **two tiers**,
by design: deterministic **rules** first (instant, offline, free), then **Claude**
for the long tail the rules can't name. This file owns the heal-rules **schema**
(every kind + its fields, the `todo: true` marker rune writes). Authoring/enriching
the rules for a project is dev work owned by **`rune:build`** — this file is the
reference both it and the cake share.

## Tier 1 — the rules engine (client-side)

Every *structured* failure shape becomes one-click fixes with **Apply** buttons:

| Failure shape | Offered fixes |
| --- | --- |
| unresolved `{{ref}}` / `{{$input}}` | run the step that outputs the field; set the input from an existing capture (any module's session); a plural capture (`tableNames`) feeds an element picker for the singular input (`tableName`); otherwise jump to the Module-inputs box |
| 422 assert failure (body names path + constraint) | remove an optional body key; "did you mean X?" for keys the DTO doesn't have; a required-but-unsatisfiable field reuses the missing-ref fixes |
| error slug with a **project rule** (below) | whatever the rule declares: run a prerequisite step, set/pick an input, edit the body, retry, or guidance |
| `timeout` / `unauthorized` / `rate-limited` (no project rule) | retry-with-reason |
| anything else | run the declared dependencies that aren't green |

## Project rules — `spec/misc/heal-rules.json`

Slug diagnosis is **project vocabulary, not framework knowledge** (which endpoint
un-blocks `not-enabled` is *this app's* business), so keep ships no domain slugs.
The project declares them in a committed file keep loads through the
control-plane-gated `GET /docs/_heal-rules` (in-process or a `dev`-grant bearer):

```json
{
  "v": 1,
  "slugs": {
    "not-enabled": [
      { "kind": "run-step", "match": "/enable/i", "why": "the table must be tracked first" },
      { "kind": "pick", "target": "tableName", "fromPlural": "tableNames", "why": "pick a table that exists" }
    ],
    "not-armed": [
      { "kind": "note", "label": "Set WRITES_ARMED=1 and restart", "retryAfter": true }
    ]
  }
}
```

### Schema

- Top level: `{ "v": 1, "slugs": { "<slug>": [ <rule>, … ], … } }`. A `<slug>` is
  the error vocabulary the app emits (matched against the failure's
  `body.message`). Each slug maps to an **ordered list of rules**, each tried in
  turn; the first applicable one fronts the panel.
- **When a slug has project rules, they own it** — the generic Tier-1 table above
  is only the fallback for slugs with no project rule.

### Rule kinds and their fields

| `kind` | Required fields | Optional | What it does |
| --- | --- | --- | --- |
| `run-step` | `target` (exact endpoint id) **or** `match` (`/regex/flags` over endpoint ids) | `why` | offer to run a prerequisite step before retrying |
| `set-input` | `target`, `value` | `why` | set a module input to a literal value |
| `pick` | `target`, `fromPlural` (an exactly-named array field present in any capture) | `why` | pick a singular value from a plural collection (`tableName` ← `tableNames[…]`) |
| `remove-key` | `target` | `why` | drop an offending body key |
| `set-body-field` | `target`, `value` | `why` | set a request body field to a literal value |
| `retry` | — | `why` | offer a plain retry |
| `note` | `label` | `retryAfter: true`, `why` | render guidance text; `retryAfter` adds a retry button |

- **Every rule may carry `why`** (the human reason shown in the panel).
- **Unknown kinds and extra fields are ignored** — forward-compatible. In
  particular rune's **`todo: true`** scaffold marker (below) is ignored by the
  panel.

### The `todo: true` marker — what rune writes at sync

**`rune sync` generates a starter `spec/misc/heal-rules.json`** from the spec's
declared **fault slugs** — one entry per slug, stamped with **`todo: true`** so it's
visible as un-enriched scaffolding. The merge is **don't-clobber**: hand edits and
appended rules survive re-syncs; sync only adds entries for newly-declared slugs.
Enriching those entries (a concrete suggestion + a real `why`, then dropping the
`todo` flag) is dev work owned by **`rune:build`** — `rune lint --strict` fails while
`todo: true` entries remain. The marker is inert at runtime (an ignored extra
field), so a half-enriched file still heals correctly.

## Tier 2 — Ask Claude (`POST /docs/_heal`)

The panel's **Ask Claude** button POSTs the failure bundle — endpoint metadata,
resolved request, response, missing refs, module inputs, step statuses, captures
(pruned/truncated), and the rule fixes already offered — to **`POST /docs/_heal`**.
The server forwards bundle + the **whole composed process graph** (every module) to
`PRIVATE_CLAUDE_URL/v1/prompt` (the private-claude service; `PRIVATE_CLAUDE_TOKEN`
adds a bearer header) with a JSON schema, so the verdict comes back structured:

```json
{
  "diagnosis": "plain-language root cause, <120 words",
  "suggestions": [
    { "kind": "set-input", "target": "qbId", "value": "12", "why": "…" }
  ]
}
```

`kind` is one of:

- **machine-applicable** (rendered with **Apply** buttons): `set-input` /
  `run-step-first` / `edit-body`.
- **advice** (shown as guidance, not applied): `switch-flow` / `set-env` /
  `explain`.

Claude is prompted to find root causes the rules can't — **cross-module causality**
(a teardown step wiped state a later module reads), **real implementation bugs** —
and **never** to propose destructive steps as runnable.

**Trust posture** mirrors the rest of the `/docs/_*` control plane: **in-process
OR an infra bearer whose app-grants include `dev` (or `*`)** — no localhost trust
(403 otherwise), `503` until `PRIVATE_CLAUDE_URL` is configured on the server,
`502` wraps upstream errors. The upstream call can take minutes (180 s timeout)
and spends the operator's Claude plan — another reason rules run first.

## How `/docs/_run` reuses the rules for retry

`POST /docs/_run` derives its `retry` slugs from the project's heal rules (`retry`
actions / `note` + `retryAfter`) plus the built-in transients (`timeout`,
`rate-limited`): a failed response whose `body.message` matches a listed slug is
re-attempted after a delay instead of failing the walk. So enriching heal-rules with
a `retry`/`note(retryAfter)` for a known-transient slug also makes the headless
walk resilient to it. (The runner's full `retry` option is documented in
`rune:framework`.)
