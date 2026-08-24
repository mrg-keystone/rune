## The agent fleet (`claude/agents/`)

Fifteen specialists with pinned models and minimal tool grants — every agent
file pins `model:` and `tools:` in its frontmatter: **opus** for the three
judgment cores (analyst / data-designer / spec-author), **sonnet** for the
other twelve. The grants below are each agent's `tools:` line, exhaustive —
an unlisted tool is unavailable to that agent; "+ seq-think" marks the five
that also carry the sequential-thinking MCP tool
(`mcp__sequential-thinking__sequentialthinking`):

| Agent | Owner skill | Model | Tools | Job |
|---|---|---|---|---|
| `rune-build-scaffold` | `rune:build` | sonnet | Bash, Read, Edit, Write | Finalize `.in-prog` → `.rune` + sync, pin the red/green baseline. |
| `rune-build-analyst` | `rune:build` | **opus** | Read, Grep, Glob, Write | Module map + test inventory (build-cache mechanics: see 01-the-eight-skills-in-pipeline-order.md). |
| `rune-build-test-author` | `rune:build` | sonnet | Read, Write, Edit, Bash | One test *file* per agent, prove RED. |
| `rune-build-method-impl` | `rune:build` | sonnet | Read, Write, Edit, Bash | One method per agent (worktree isolation: see 01-the-eight-skills-in-pipeline-order.md). |
| `rune-build-validator` | `rune:build` | sonnet | Read, Bash | Fresh judge per ≤10-test batch — it rules, never edits. |
| `rune-build-linter` | `rune:build` | sonnet | Read, Write, Edit, Bash | Lint-clean + heal enrichment + `--strict` gate. |
| `rune-data-surveyor` | `rune:data` | sonnet | Bash, Read, Glob, Grep | Read-only inventory. |
| `rune-data-designer` | `rune:data` | **opus** | Read, Write, Bash **+ seq-think** | Writes `data.json`. |
| `rune-data-reconciler` | `rune:data` | sonnet | Read, Edit, Bash | Smallest spec diff. |
| `rune-framework-runtime` | `rune:framework` | sonnet | Read, Grep, Glob, Bash **+ seq-think** | Diagnoses runtime behavior. |
| `rune-framework-deploy` | `rune:framework` | sonnet | Read, Grep, Glob, Bash, Edit **+ seq-think** | Wires serve/composition files — it alone. |
| `rune-cake-e2e-driver` | `rune:cake` | sonnet | Bash, Read, Grep, Edit | Drives end-to-end cake runs. |
| `rune-docs-advisor` | `rune:docs` | sonnet | Read, Grep, Glob **+ seq-think** | Documentation advisory (no Write/Edit/Bash grant — read-only by construction). |
| `rune-scope-story-deriver` | `rune:scope` | sonnet | Read, Write, Grep, Glob | Derives scope stories. |
| `rune-spec-author` | `rune:spec` | **opus** | Read, Write, Edit, Bash, Grep, Glob **+ seq-think** | Authors and edits spec documents. |

Fifteen rows, three `model: opus` (the judgment cores), five `+ seq-think`
grants — each is a straight column count, not a claim to re-verify against
prose.

The two grants answer different questions and don't have to line up.
`model:` pays for accuracy on a fixed transformation — opus goes to the
agents whose output must be right on a large, messy input (module mapping,
data-schema authorship, spec prose), regardless of how open-ended the task
is. `+ seq-think` pays for open-ended judgment — it goes to agents that
diagnose, design, or advise from ambiguous signals (`data-designer`,
`framework-runtime`, `framework-deploy`, `docs-advisor`, `spec-author`), not
to agents that mechanically transform a known input into a known output
shape, however much accuracy that transformation demands. That's why
`rune-build-analyst` is opus with no seq-think — extracting a module map is
a fixed transformation, not a decision — while `rune-framework-runtime` is
sonnet with seq-think — diagnosing a runtime failure from symptoms is a
decision, not a transformation. Model tier and seq-think grant are
orthogonal axes; a row can land on either, both, or neither.

Every agent file carries a shared **"Never crawl the filesystem"** guardrail
block, injected between markers by `scripts/sync-agent-guardrail.ts`
(idempotent). The guardrail — pointing agents at installed skill references
and `deno info` instead of `find /` — was born from a measured
machine-pinning incident (unbounded filesystem scans, load 30+). CI wiring
for the sync script's `--check` mode is 04-drift-guards' concern, not this
document's.

`rune-build-validator`'s agent file shows the shape every entry above
follows — frontmatter pins `model:`/`tools:` exactly as tabled, and the
guardrail block sits between its injection markers, untouched by hand edits:

```yaml
---
name: rune-build-validator
description: Fresh judge for a completed build batch (≤10 tests); rules, never edits.
model: sonnet
tools: Read, Bash
---
```

<!-- BEGIN GUARDRAIL -->
## Never crawl the filesystem

Use installed skill references and `deno info` — never `find /` or an
unbounded directory walk.
<!-- END GUARDRAIL -->

The sync script's injection points are the HTML-comment pair shown above
(`<!-- BEGIN GUARDRAIL -->` / `<!-- END GUARDRAIL -->`) — invisible in a
rendered agent prompt and trivially greppable by
`scripts/sync-agent-guardrail.ts`.

