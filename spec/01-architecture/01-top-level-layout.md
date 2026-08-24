## Top-level layout

```
refactor/                      # the rune monorepo (branch: refactor)
├── deno.json                  # rune's config + the Deno workspace root
├── src/                       # the CLI engine (shaping layer) — Deno TS
│   ├── bootstrap/             #   CLI front door + build-time config
│   ├── core/                  #   shared kernel (pipeline contracts, path classifier)
│   └── rune/                  #   the domain engine (parser, codegen, lint rules, entrypoints)
├── lang/                      # the language layer — grammar, keywords.json, Rust workspace
│   ├── keywords.json          #   THE single source of truth for the language — except its `codegen.templates`/`codegen.policies` fields, JSON keys within this file authored engine-side (`DEFAULT_TEMPLATES` in `src/rune/domain/business/rune-manifest`) and byte-mirrored in by `scripts/gen-codegen-templates.ts`
│   ├── grammar/               #   tree-sitter grammar (generated from keywords.json)
│   ├── parser/ lsp/ cli/      #   Rust crates: parser/ → rune-parser (library), lsp/ → binary rune-lsp, cli/ → crate rune-cli, binary rune-syntax
│   ├── queries/ palettes/     #   highlights.scm, Mesa Vapor palette
│   ├── supported-software/    #   per-editor + file-manager integration recipes
│   └── docs/                  #   spec.md, constraints.md, cookbook.md, example.rune
├── keep/                      # the runtime layer — publishable JSR package ONLY
│   └── src/                   #   bootstrap/, assert/, foundation/ (the framework)
├── rune-studio/               # visual editor for the language (standalone Fresh 2 + Vite app)
├── claude/                    # Claude Code assets: skills/ (rune:*) + agents/
├── examples/                  # spec→code demos (todos, shop, cake) + runnable backends
├── e2e/                       # spec→runtime acceptance suites (cake, checkout)
├── fixtures/                  # verification corpus, goldens, artifact fixtures, projects
├── scripts/                   # installers, generators, drift/lockstep guards, verify.ts
├── docs/                      # ADRs, canonical shape, assert runtime, runbooks, history
├── spec/                      # the project spec series — these docs
├── todos/  upgrades.md  maybe/  feedback/   # roadmap and history
└── .github/                   # release-rune.yml + publish-keep.yml
```

