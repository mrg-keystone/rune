# rune + keep monorepo

Two sides of one coin, now in one repo:

- **[`packages/rune`](packages/rune/)** — the spec→code generator (Deno engine +
  Rust `lang/` for `rune-lsp`/`rune-syntax` + `rune-studio`). Ships as binaries via
  the rolling `latest` GitHub release. See [`packages/rune/README.md`](packages/rune/README.md).
- **[`packages/keep`](packages/keep/)** — the Deno backend framework that
  rune-generated projects run on. Published to JSR as
  [`@mrg-keystone/keep`](https://jsr.io/@mrg-keystone/keep). See
  [`packages/keep/README.md`](packages/keep/README.md).

## Workspace

The root `deno.json` declares a Deno workspace over both packages, so rune's
examples/dev resolve keep from the **in-tree source** (`packages/keep`) and you can
test rune against unreleased keep. Generated *user* projects still pin
`jsr:@mrg-keystone/keep@^1` (they live outside this repo) — that is intentional and
unchanged.

```sh
deno task verify          # rune's full L0–L7 verify ladder
deno task build:rune      # compile rune + rune-lsp + rune-syntax
deno task test:keep       # keep's test suite
deno task check:keep-jsr  # keep's JSR publish preflight (dry-run)
```

## Releases

- Pushing `packages/rune/**` → rebuilds rune's rolling `latest` release (binaries).
- Pushing `packages/keep/**` → publishes `@mrg-keystone/keep` to JSR and refreshes
  the `keep-latest` release (skill tarball + installer).
