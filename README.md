# Shape Checker

## Quick Start

```sh
deno task compile
./dist/shape-checker .
```

If there are violations, fix them. Run again until you get `All clear — no violations found.`

To check a specific directory:

```sh
./dist/shape-checker --dir path/to/dir
```

## What This Does

The binary scans a project directory and checks it against 7 architectural rules defined in the source. The rules enforce a hexagonal/modular structure specified by `src/shape-checker/domain/business/structure/canonical-paths.json`.

The tool eats its own dogfood — this repo must pass with 0 violations.

## Build Options

```sh
deno task compile                              # default: uses deno lsp
deno task compile 'deno lsp'                   # explicit
deno task compile 'typescript-language-server --stdio'  # different LSP
```

The LSP binary path gets baked in at compile time. At runtime, the tool spawns it for type-level analysis (tracing re-exports, comparing signatures, detecting polymorphism). If the LSP isn't available or doesn't support a feature, rules fall back to regex.

## Running Tests

```sh
deno test --allow-read --allow-net --allow-env --allow-run src/
```

## Done When

1. `deno check src/bootstrap/mod.ts` passes
2. All tests pass
3. `./dist/shape-checker .` exits 0 with no violations
