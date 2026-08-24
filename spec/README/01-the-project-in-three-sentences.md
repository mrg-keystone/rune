## The project in three sentences

Rune exists to constrain what LLMs build so you get exactly what you need:
it builds a backend by **shaping** it instead of writing it — a tiny `.rune`
spec per module (endpoints, contracts, seams, faults) is the single source of
truth the `rune` CLI generates a typed, validated, lint-clean TypeScript tree
from, regenerated from the spec and never hand-edited structurally, so the
generated code can never drift from what the spec says. That generated code
runs on **rune's runtime** — keep, a Deno backend framework built on
**bedrock** (which itself builds on `@danet/core`) — adding `bootstrapServer`, `@Endpoint`, auto Swagger/docs, the
assert runtime, and self-verification surfaces (the interactive **cake**, the
live system map, a headless runner) that prove the spec's contracts hold
instead of leaving verification for later (details:
[02-the-two-layers.md](../00-overview/02-the-two-layers.md),
[06-runtime.md](../06-runtime/00-overview.md),
[07-cake.md](../07-cake/00-overview.md)).
Around the two layers sit a machine-readable language definition
(`lang/keywords.json`) that everything else is derived from and drift-gated
against, a Rust LSP + editor toolchain, a visual language workbench (Rune
Studio), eight Claude Code skills that automate the whole lifecycle, and an
L0–L7 golden verification ladder.
