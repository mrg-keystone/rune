## Field feedback (`feedback/feedback.md`)

A report from rebuilding a real product ("arachne", a scatter/gather HTTP flow
orchestrator) through the full diamond on rune 4.2.0. **The headline finding:**
an adversarial 92-agent debug sweep reproduced 21 real bugs *past a green
`lint --strict` suite* — empirical proof that a green strict-lint run is not
sufficient on its own, and the justification for the hardening-category test
rows below. (rune:diamond's rung-0 git preflight has a separate origin — a
field report where a build ran in a broken checkout, not this sweep; see
[09-claude-skills.md § The eight skills, in pipeline
order](../09-claude-skills/01-the-eight-skills-in-pipeline-order.md).)

- **Validated.** The event-sourced fold, the in-process client, accurate boot
  diagnostics, colocated test conventions.
- **Drove and landed** (already shipped):
  - The hardening-category test rows required by rune-build-analyst, and
    rune:diamond's rung-0 git preflight — both owned by
    [09-claude-skills.md § The eight skills, in pipeline
    order](../09-claude-skills/01-the-eight-skills-in-pipeline-order.md).
  - The `onStart`/`onStop` lifecycle hooks — owned by
    [06-runtime.md § `bootstrapServer(appName, module,
    options?)`](../06-runtime/01-bootstrapserver-appname-module-options.md).
  - The `@Internal`/`@InProcessOnly` decorator — landed from this field
    report, and now documented in [06-runtime.md § `@Endpoint` /
    `@EndpointController`](../06-runtime/02-endpoint-endpointcontroller.md#internal--inprocessonly)
    as a standalone method decorator stacked alongside `@Endpoint` (the same
    pattern `@SwaggerDescription` uses alongside `@EndpointController`), not
    an `EndpointOptions` field.
  - The pinned composed-repo layout (`spec/misc/layout.md`) — owned by
    [01-architecture.md § The canonical generated-project
    shape](../01-architecture/05-the-canonical-generated-project-shape.md).
  - The `[TYP:json]` parseability modifier — owned by
    [02-language.md § Types, DTOs, and constraint
    modifiers](../02-language/04-types-dtos-and-constraint-modifiers.md).
    This was a **partial mitigation**, not the full fix: it validates that a
    JSON-blob string parses at the seam, but leaves the string-encoding
    itself in place — the still-open items below complete what it started.
  - The loud `INFRA_URL` 3.x→4.x upgrade note — since superseded by keep's
    auth removal; see [Current state,
    summarized](07-current-state-summarized.md).
- **Still open** (the completion of `[TYP:json]`'s partial mitigation,
  above): first-class typed array/object DTO fields (the "JSON-in-string"
  ergonomics problem — today list/object fields ride JSON-encoded strings),
  and carrying parse status on the dispatch wire instead of silent
  parse-with-fallback.

