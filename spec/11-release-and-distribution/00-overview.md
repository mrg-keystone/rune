# Release & Distribution

> Part of the [project spec series](../README.md). Sources: `.github/workflows/`
> (`release-rune.yml`, `publish-keep.yml`), `scripts/{install,uninstall}.sh`,
> the build-time generators, and the root `deno.json` tasks.

Two publish trains, routed by path filter, but not a clean two-way split —
some pushes trigger neither, and "trigger" itself splits into two things: the
workflow *running* (and building) versus it *cutting a release*. **Train 1**
ships the compiled toolchain — the `rune`, `rune-lsp`, `rune-syntax` binaries
plus the Claude skills and agent fleet — as GitHub releases via
`release-rune.yml`; the workflow runs and builds on any push whose changed
paths aren't confined to its `paths-ignore` list (`keep/`, `e2e/`,
`examples/`, `docs/`, `todos/`), but it only cuts a release on a push to
`main` or `develop`, or a `v*` tag push — a build-triggering push on any other
branch/ref runs the build and stamps a binary but cuts no release or pin (see
[Train 1](01-train-1-the-rune-toolchain-github-releases.md)'s trigger table).
A push touching only the ignored paths skips the workflow entirely — no Train
1 build, no release. **Train 2** publishes the `keep` runtime to JSR via
`publish-keep.yml`, and fires only on pushes to `keep/**` on `main`; a
`keep/**` push on any other branch routes to neither train. So a push
confined to `docs/`, `todos/`, `e2e/`, or `examples/`; a `keep/**` push on a
non-main branch; or a push to a non-main/non-develop branch (no `v*` tag)
that touches binary inputs and merely builds — releases nothing.

The trains are decoupled by that path filter but kept compatible by two
mechanisms:

- **The lockstep guard**: `deno task check:lockstep`
  (`scripts/check-keep-lockstep.ts`) fails when the decorator-stack ranges rune
  writes into generated projects drift from keep's own `keep/deno.json` ranges —
  the single-copy invariant ([01-architecture.md](../01-architecture/00-overview.md)). Neither
  workflow runs it; it is the first guard in `deno task verify`, run from the
  checkout ([10-testing-and-verification.md](../10-testing-and-verification/00-overview.md)).
- **Deploy order**: keep first, then rune — generated projects pin keep's
  published JSR package, so any keep feature rune's generated code depends on
  must be live on JSR before a rune release that depends on it ships.
  Mechanics — the auto-bump commit, its loop-termination guarantee, and why it
  can never trigger a Train 1 rebuild — are
  [Train 2](02-train-2-the-runtime-jsr.md)'s.

The section's content lives in its sibling files:

- [Train 1 — the rune toolchain (GitHub releases)](01-train-1-the-rune-toolchain-github-releases.md) —
  the `release-rune.yml` pipeline that builds and releases the toolchain.
- [Train 2 — the runtime (JSR)](02-train-2-the-runtime-jsr.md) —
  the `publish-keep.yml` pipeline that publishes the runtime to JSR.
- [Install / uninstall](03-install-uninstall.md) —
  the installer, `rune update`, and the `uninstall.sh` / `deno task uninstall`
  mechanics.
- [Build from source](04-build-from-source.md) —
  `deno task build`/`install` and the build-time generators.

