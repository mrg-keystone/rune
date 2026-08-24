# The Architecture Linter (`rune lint`)

> Part of the [project spec series](../README.md). Runs via `runPipeline`
> (`src/rune/domain/coordinators/pipeline/mod.ts`) over 27 rule definitions
> (`src/rune/mod-root.ts`). Each rule is one flag-free
> `check(path, target, ctx) → string[] | null` — `target` is `"folder"` for a
> directory entry, else the file's extension (`"ts"`, `"json"`, `"rune"`, …).
> No lint flag reaches a rule body; strict-gated rules read strictness from
> the `RUNE_LINT_STRICT` env var instead — or its `RUNE_STRICT` alias, either
> one enables strict mode (see `--strict`).

`rune lint` enforces the canonical architecture — the layer boundaries,
module isolation, poly conventions, and spec↔tree parity cataloged in
[01-rule-families.md](01-rule-families.md) — over every file in a project,
generated and hand-written alike. Codegen can't guarantee this on its own:
`rune sync` only shapes the output of its own run, and never re-audits the
whole tree once hand-edits, partial runs, or drift between spec and disk
enter the picture. The linter is that audit, run standalone.

This document covers the mechanics every rule shares — invocation, output,
and suggestions. The rule catalog itself lives in
[01-rule-families.md](01-rule-families.md); the CI/ship strict profile lives
in [02-strict.md](02-strict.md); governance surface that's built but not yet
wired into any of this lives in
[03-governance-built-not-yet-wired.md](03-governance-built-not-yet-wired.md).

## Flags

| Flag | Effect | Affects |
| --- | --- | --- |
| `[dir]` (positional, default `.`) | Start point for walk-root resolution, not the walk root itself — see Walk and scope below | walk |
| `--module <name>` | Scopes the **report**, not the walk: every rule still runs over the whole lint root; only findings whose path starts with the literal prefix `src/<name>/` (trailing slash included) are printed, get suggestions, and count toward the exit code. That strict prefix also drops any finding anchored on the `src/<name>` folder entry itself, so a `--module` run never reports `module-fragmentation`. Because the walk is unscoped, **a `--module` run exits 0 even when violations exist elsewhere in the tree** | report, output, suggestions, exit — not walk |
| `--json` | Prints the flat `{rule, path, line, message}` array instead of the grouped text block; skips the LLM suggestion call (suggestions never appear in JSON regardless of this flag) | output, suggestions |
| `--no-suggest` | Suppresses only the LLM suggestion call; the deterministic per-rule suggestions still print inline | suggestions |
| `--strict` | Sets `RUNE_LINT_STRICT=1` (`RUNE_STRICT` alias honored), which strict-gated rules read — currently just `rune-heal-todo`. See [02-strict.md](02-strict.md) for the gated rule and its CI/ship semantics | report (adds strict-gated findings), exit |

## Walk and scope

`[dir]` (default `.`) is the start point, not the walk root: lint walks up
from it to the nearest directory holding a `deno.json(c)` — falling back to
`[dir]` itself when none is found — then descends into `server/` when that
root has no `src/` of its own but does hold `server/bootstrap/mod.ts` (the
composed-monorepo backend), so run at the git root it lints `server/`, never
`ui/`. From that lint root it classifies every file into {module, layer}
with the shared `classify` kernel, and runs every rule over every walked
entry — every directory plus every file. The walk hard-skips `.git`,
`node_modules`, and any dot-prefixed entry at every depth, and additionally
skips everything git ignores (the set from
`git ls-files --others --ignored --exclude-standard --directory`, run from
the lint root — empty outside a git repo), so tool caches, coverage output,
and other gitignored trees never reach the rules. A rule that judges an
aggregate anchors itself to one entry and returns `null` for all others, so
it reports once ([`module-fragmentation`](01-rule-families.md) fires on the
`src/<module>` folder entry, `rune-fault-coverage` on the module's `.rune`
spec entry); exit 1 on any violation, 0 clean — see the flags table above
for how `--module` narrows what counts toward that exit code without
narrowing the walk.

## Output

Text output groups findings by rule — a `[rule] — N violation(s)` header,
then each finding's path with its violation bullets and any `→ suggestion`
inline — closing with the total violation count ("All clear — no violations
found." when clean). `--json` instead prints a flat array of
`{rule, path, line, message}` objects, one per violation message (`path` is
relative to the lint root, exactly as the walk produced it; `line` is
parsed from a "line N"/"L<n>" hint in the message, else 0), sorted by
rule → path → line → message; suggestions never appear in JSON. One
carve-out: the three spec-anchored rune-derived findings —
`rune-fault-coverage`, `rune-service-presence`, `rune-service-core-only` —
report a project-root-relative spec path (e.g. `spec/runes/tasks.rune`) in
the canonical composed layout, since the durable spec lives outside the
`src/` lint root and a lint-root-relative path would have to climb out via
`../` (see [01-rule-families.md](01-rule-families.md)).

### Example

A lint root containing just these two files:

```
src/payments/domain/business/charge/mod.ts
  line 3: import "npm:stripe";
  line 4: import { core } from "../../../core/mod.ts";

src/payments/domain/data/ledger/mod.ts
  line 2: import "npm:pg";
```

produces three violations across two rules: two `external-imports` (one
message carries an `L<n>` hint, one carries none) and one `import-aliases`
(a `line N` hint). Text output:

```
[external-imports] — 2 violation(s)
src/payments/domain/business/charge/mod.ts
  - External specifier 'npm:stripe' not allowed (L3)
    → use a `#` alias
src/payments/domain/data/ledger/mod.ts
  - External specifier 'npm:pg' not allowed
    → use a `#` alias

[import-aliases] — 1 violation(s)
src/payments/domain/business/charge/mod.ts
  - Parent-climbing import '../../../core/mod.ts' not allowed (line 4)
    → ../../../core/mod.ts

3 violation(s) total.
```

The same run under `--json` — sorted rule → path → line → message, the
`L3`/`line 4` hints parsed into integers, the hint-less second message
falling through to `line: 0`, and no `suggestion` field anywhere:

```json
[
  {
    "rule": "external-imports",
    "path": "src/payments/domain/business/charge/mod.ts",
    "line": 3,
    "message": "External specifier 'npm:stripe' not allowed (L3)"
  },
  {
    "rule": "external-imports",
    "path": "src/payments/domain/data/ledger/mod.ts",
    "line": 0,
    "message": "External specifier 'npm:pg' not allowed"
  },
  {
    "rule": "import-aliases",
    "path": "src/payments/domain/business/charge/mod.ts",
    "line": 4,
    "message": "Parent-climbing import '../../../core/mod.ts' not allowed (line 4)"
  }
]
```

## Suggestions

Deterministic per-rule suggestions always print inline in text output —
`--no-suggest` does not suppress them. Each comes from one of three sources,
and exactly two rules instead draw a suggestion from an LLM call:

| Rule | Suggestion | Source | Suppressed by |
| --- | --- | --- | --- |
| `external-imports` | "use a `#` alias" | hard-coded string | never |
| `barrel-discipline` | "move re-exports to `mod-root.ts`/`poly-mod.ts`" | hard-coded string | never |
| `dto-validation` | "add a Zod schema" | hard-coded string | never |
| `fixture-promotion` | "move to `assets/`" | hard-coded string | never |
| `import-aliases` | names the offending specifier | message-derived | never |
| `structure` ("Wrong extension" / "Missing required file" findings) | names the expected extension/filename | message-derived | never |
| `layer-restrictions` | the finding's first violation message, echoed | echoed | never |
| `module-isolation` | the finding's first violation message, echoed | echoed | never |
| `structure` ("not allowed" placement findings) | LLM-generated (OpenAI `gpt-4.1-mini`, keyed by `OPENAI_API_KEY`) | LLM | `--no-suggest`, `--json` — both skip the LLM call |
| `module-fragmentation` | LLM-generated (OpenAI `gpt-4.1-mini`, keyed by `OPENAI_API_KEY`) | LLM | `--no-suggest`, `--json` — both skip the LLM call |

No other rule gets a suggestion of any kind, deterministic or LLM.

The LLM path is best-effort by design: a missing `OPENAI_API_KEY` or a
failed call prints a `[suggest]` note to stderr, the finding prints without
a suggestion, and the exit code is unaffected. That note stays on stderr,
same as the `[profile]` block below — see Determinism and goldens.

## Determinism and goldens

Lint output is byte-identical for identical inputs — the L0 gate that
golden capture (L0/L4, `scripts/verify.ts`) depends on. Four things hold
that guarantee:

- **Non-absolute paths.** `--json`'s `path` field is never absolute — an
  absolute path would bake the checkout location into the bytes. It's
  relative to the lint root, except for the three spec-anchored findings
  (`rune-fault-coverage`, `rune-service-presence`,
  `rune-service-core-only`), which are project-root-relative in the
  canonical composed layout — see the carve-out in Output above.
- **Deterministic sort.** `--json` findings are sorted rule → path → line →
  message (see Output above), so identical inputs always serialize in the
  same order.
- **LSP neutralized.** Several rules sharpen their findings through an LSP
  session — the shipped Rust `rune-lsp`
  ([08-language-tooling.md](../08-language-tooling/00-overview.md)), spawned
  over stdio per `src/core/dto/lsp-config.ts`, every query gated on the
  server's advertised capabilities (`src/rune/domain/data/lsp/mod.ts` is the
  client). It's an enhancement, never a requirement: when `SHAPE_NO_LSP=1`
  is set — or the binary is missing or fails to initialize — `ctx.lsp` is
  `null` and every rule degrades to its static check (an LSP-only rule like
  `poly-detection` goes silent; `layer-restrictions` stops tracing
  re-exports, so violations hidden behind barrels go undetected). Golden
  capture sets `SHAPE_NO_LSP=1` process-wide, and in the env of the CLI
  runs L0 spawns, so output is independent of whether `rune-lsp` happens to
  be installed on the machine running the test.
- **JSON skips the LLM.** `--json` never calls the LLM suggestion path, so a
  live `OPENAI_API_KEY` can't leak a nondeterministic response into a
  golden: L0 lints via the real CLI with `--json` (skips the LLM call,
  omits suggestions), and L4 calls `runPipeline` in-process and serializes
  results straight to the same sorted array, bypassing the suggestion layer
  entirely.

One more stream stays out of the picture entirely: every lint run also
writes a `[profile]` timing block to stderr — unconditional, not env-gated,
and emitted even under `--json`, since results go to stdout and the two
streams never mix. `runPipeline` prints `[profile] buildContext: Nms
(N files, N dirs)`, `[profile] LSP init: Nms`, `[profile] LSP shutdown: Nms`,
a per-rule `[profile] Rules (N entries):` breakdown sorted slowest-first,
and a closing `[profile] Total: Nms`. Like the `[suggest]` note above, it
lives on stderr and never reaches an L0/L4 golden — both capture the
results, not stderr.

