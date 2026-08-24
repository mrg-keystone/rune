## Build from source

### Prerequisites

Building `rune` from source needs two toolchains, layered:

- **Deno** — runs `deno task build` itself, drives the build-time generators
  (below), and compiles the TS engine into the `rune` binary via
  `deno compile`.
- **A Rust toolchain and a C compiler** — the `cargo build --release` stage
  that follows compiles `rune-lsp` and `rune-syntax` from the
  `lang/{parser,lsp,cli}` workspace; see
  [→08-language-tooling § The Rust workspace](../08-language-tooling/03-the-rust-workspace-lang-parser-lsp-cli.md)
  for the crates themselves.

This is the mirror image of the prebuilt path
([→03 Install/uninstall](03-install-uninstall.md)), which needs "no Deno or
Rust toolchain" precisely because it installs binaries already built this
way — this page is where that requirement lives.

```sh
deno task build       # setup (config + gen-shape-docs + gen-version) → deno compile →
                      # cargo build --release → dist/{rune,rune-lsp,rune-syntax}
deno task install     # build from this checkout straight into ~/.deno/bin
```

### Build-time generators

| Generator | Runs in build (setup + CI)? | Output | How/when re-run |
| --- | --- | --- | --- |
| `src/bootstrap/config.ts` | yes | `src/core/dto/lsp-config.ts` | part of `deno task setup`; CI's build job runs the same step inline before compiling |
| `gen-shape-docs.ts` | yes | `docs/canonical-shape.md` | part of `deno task setup`; CI's build job runs the same step inline before compiling |
| `gen-version.ts` | yes | the version stamp (`keep/deno.json`'s semver as the version, `git rev-parse HEAD` as the commit, `unknown` when either is unavailable, with no `RUNE_VERSION_OVERRIDE` — the source-build default) | part of `deno task setup`; CI's build job runs the same step inline before compiling |
| `gen-artifact-schema.ts` | by hand, **not** gated by `deno task verify` | `lang/artifact.schema.json` | re-run by hand when its inputs change; `deno task verify` does **not** check it for drift, so a stale schema ships silently until someone re-runs it ([→08-language-tooling § 01](../08-language-tooling/01-lang-keywords-json-the-artifact.md)) |
| `gen-codegen-templates.ts` | by hand, **not** gated by `deno task verify` | the codegen-template mirror in `lang/keywords.json` | re-run by hand when its inputs change; `deno task verify` does **not** check it for drift, so a stale mirror ships silently until someone re-runs it ([→08-language-tooling § 01](../08-language-tooling/01-lang-keywords-json-the-artifact.md)) |
| `generate.mjs` | by hand, gated by `deno task verify` | grammar + highlights (`deno task gen`) | re-run by hand when its inputs change; `deno task verify` gates the output against drift |

`config.ts` `which`-resolves the configured LSP command — `deno lsp` by
default, so the binary it looks up is `deno`, never the yet-unbuilt
`rune-lsp` — failing the build (exit 1) when it isn't on PATH; the generated
file carries the bare command name, not the resolved path. Of the three
by-hand generators, only `generate.mjs`'s output is drift-gated by
`deno task verify` — the grammar and highlights it regenerates
(`lang/grammar/grammar.js` + `lang/queries/highlights.scm`). `gen-artifact-schema.ts`
and `gen-codegen-templates.ts` are both ungated: `deno task verify` never
byte-diffs `lang/artifact.schema.json` or the codegen-template mirror against
their sources, so either can ship stale silently until someone re-runs its
generator by hand. Alongside `gen-shape-docs.ts`'s `docs/canonical-shape.md`
(the third row above), that's three regenerable-but-ungated artifacts in
total — the drift gate covers only the grammar and highlights, nothing else
([10-testing-and-verification § 00](../10-testing-and-verification/00-overview.md),
[§ 01](../10-testing-and-verification/01-the-verify-ladder-deno-task-verify.md)).
`.infra/git.json` is **not** a build input or output: it is deploy metadata
(repo/commit/branch/buildTime) written and committed by the external `ship`
promote tool — the `stamp: git <sha> → main (deploy metadata)` commits.
Neither `gen-version.ts` nor `rune -v` reads it; `ship` itself is out of
scope for this spec.

### Golden path: building from a checkout

1. From a checkout, run `deno task build`.
2. `deno task setup` runs first — the three "yes" rows above, in order —
   then `deno compile` emits `dist/rune`, then `cargo build --release`
   emits `dist/rune-lsp` and `dist/rune-syntax` from the Rust workspace.
3. `dist/rune -v` prints the stamped version: `keep/deno.json`'s semver and
   the `git rev-parse HEAD` commit SHA (`unknown` in place of either when
   the semver or the git commit isn't available) — a concrete "the build
   worked" check, and the `gen-version.ts` stamp exercised end to end.
