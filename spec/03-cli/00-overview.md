# The `rune` CLI

> Part of the [project spec series](../README.md). Engine source: `src/` (Deno
> TypeScript, compiled to a single binary). Front door: `src/bootstrap/mod.ts`,
> which dispatches on `Deno.args[0]` — every command is either a `run*`
> entrypoint re-exported from `src/rune/mod-root.ts` or a passthrough to a Rust
> helper binary (`rune-lsp` / `rune-syntax`), with one exception: `rune lint`
> has no `runLint` entrypoint and no Rust passthrough — bootstrap dispatches
> it inline (see
> [01-architecture/03-layering-inside-the-engine-src.md](../01-architecture/03-layering-inside-the-engine-src.md)).

The CLI is the user-facing surface of the **shaping layer**: it validates
specs, generates and reconciles module trees, lints the result against the
architecture, and runs the live dev loop. Codegen and lint live in Deno;
speed-critical authoring paths (LSP, format, editor install) are delegated to
the Rust helpers built from `lang/`.

