## The two layers

| Layer | What | Where |
| --- | --- | --- |
| **Shaping** | The `.rune` language, the `rune` CLI (`init`, `sync`, `check`, `lint`, `dev`, `manifest`, `validate`, self-update — each specified in [03-cli.md](../03-cli/00-overview.md); `check` validates a spec, `validate` a `keywords.json` artifact, `lint` runs the architecture linter), the Rust `rune-lsp` / `rune-syntax` helpers, and Rune Studio (the visual editor for the language itself) | `src/` (engine), `lang/` (grammar + `keywords.json`, the single source of truth), `rune-studio/` |
| **Runtime** | The Deno backend framework generated code targets: DI bootstrap, auto Swagger, the interactive **cake**, the live system map, tracing/logging, a headless runner; built on **bedrock** (keep's foundation framework), which itself builds on `@danet/core` | `keep/` — published to JSR as [`@mrg-keystone/rune`](https://jsr.io/@mrg-keystone/rune) (the package name is a stable identifier, not a separate product) |

Everything else is shared across both layers: `claude/` (the eight Claude Code
skills + agent fleet), `examples/` (spec→code demos and runnable backends),
`e2e/` (the spec→runtime acceptance suites), `fixtures/` (the verification
corpus and goldens), `scripts/` (generators and drift guards), `docs/`,
`todos/`.

The directories above (`src/`, `keep/`, `lang/`, `claude/`, `examples/`, ...)
are rune's *own* repository layout. A scaffolded app (`rune init myapp`, see
"The loop, end to end" in [04-the-loop-end-to-end.md](04-the-loop-end-to-end.md))
gets a different, generated layout — `ui/` + `server/` + `spec/` — that runs
*on* the keep runtime rather than *containing* it.

