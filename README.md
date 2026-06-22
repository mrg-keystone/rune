# Rune

Design a module as a tiny `.rune` spec, generate a typed scaffold from it, fill in
the bodies, and keep the whole thing honest with the architecture linter. The spec
is the source of truth — you regenerate from it, you don't hand-edit the structure.

Rune is one product with several facets, all in this repo:

- **CLI + engine** (`src/`) — the `rune` binary: parse, `sync`, `manifest`, lint,
  `validate`, self-update. Ships as prebuilt binaries via the rolling `latest`
  GitHub release.
- **Language: spec + parser** (`lang/`, `keywords.json`) — the `.rune` grammar and
  the Rust `rune-lsp` / `rune-syntax` helpers, all derived from `keywords.json`.
- **Rune Studio** (`rune-studio/`) — the visual editor for `keywords.json` (the
  language's single source of truth).
- **Claude skills** (`skills/`) — the skill library: `skills/rune` (the rune
  toolchain skill, shipped inside every rune release tarball) and `skills/keep`
  (keep's skill, shipped in the `keep-latest` release).
- **keep** (`keep/`) — the Deno backend framework that rune-generated projects run
  on, published to JSR as
  [`@mrg-keystone/keep`](https://jsr.io/@mrg-keystone/keep). `keep/` holds **only**
  the publishable package (`src/`, manifest, README, assets); keep's skill, docs,
  examples, and e2e live in the shared facets below. See [`keep/README.md`](keep/README.md).

Each cross-cutting **facet lives in exactly one place**, spanning both products:
`skills/` (rune + keep skills), `examples/` (rune spec demos + runnable keep apps),
`e2e/` (the rune→keep integration acceptance suite), `docs/` (rune docs +
`docs/keep/`), `todos/`. Only each program's own *source* stays put — rune's engine
at `src/`, keep's library at `keep/src/`.

The repo is a Deno workspace: the root `deno.json` is rune's config. Its members
are the self-contained sub-projects — `keep` (the library), the two integration
acceptances (`e2e/cake`, `e2e/checkout`), and the `examples/in-process-client`
demo — so they resolve keep from the **in-tree source** (`keep/`) and you can test
rune against unreleased keep. Generated *user* projects still pin
`jsr:@mrg-keystone/keep@^1` (they live outside this repo) — that is intentional and
unchanged. (`rune-studio/` and `examples/fresh-project/` are standalone Vite/Fresh
apps with their own lockfiles, run via their own `deno task dev`.)

## Install

```sh
curl -fsSL https://github.com/mrg-keystone/rune/releases/download/latest/install.sh | sh
rune --help
```

The installer is **idempotent**: it first removes any existing `rune` (from every
known location — `~/.deno/bin`, `~/.cargo/bin`, `~/.local/bin`, …) and then drops
in one fresh copy, so you never end up with stale or duplicate binaries on your
`PATH`. Pulls the latest prebuilt release (`rune` + the `rune-lsp` / `rune-syntax`
helpers) into `~/.deno/bin` — no Deno or Rust toolchain required. It also installs
the **rune Claude Code skill** into `~/.claude/skills/rune/` (skipped when
`~/.claude` doesn't exist), so Claude always matches the installed toolchain.

Already installed? `rune update` (alias: `rune upgrade`) re-runs this installer —
binaries *and* skill. Options:

- `RUNE_INSTALL=/usr/local/bin` — install somewhere else (must be on your `PATH`).
- `RUNE_VERSION=v0.1.0` — pin a specific snapshot instead of the rolling latest.
- `RUNE_VERSION=develop` — install the rolling **develop** build (latest
  integration work, ahead of stable):

  ```sh
  curl -fsSL https://github.com/mrg-keystone/rune/releases/download/develop/install.sh | RUNE_VERSION=develop sh
  ```

Supported targets: Apple-silicon macOS, Intel macOS, Linux x86-64. On macOS the
script de-quarantines the binaries so Gatekeeper doesn't block them.

### Uninstall

```sh
curl -fsSL https://github.com/mrg-keystone/rune/releases/download/latest/uninstall.sh | sh
# or, from a checkout: deno task uninstall
```

Removes `rune` + `rune-lsp` + `rune-syntax` from every known install location,
plus the managed skill file (`~/.claude/skills/rune/SKILL.md`) — anything else
you keep in that folder (evals, notes) is left alone.

### Claude Code skill

Installed for you: the skill ships inside every release tarball, and every
install path (`scripts/install.sh`, `deno task install`, `rune update`) drops it
into `~/.claude/skills/rune/` so Claude knows the syntax, lifecycle, and pitfalls
of the version you actually have — a pinned `RUNE_VERSION` install gets the skill
matching those binaries. Working on the skill itself? `deno task install`
copies it straight from your checkout.

## Build from source (contributors)

```sh
deno task build          # compiles dist/rune (+ rune-lsp, rune-syntax helpers)
./dist/rune --help       # see all commands
deno task install        # or: build from this checkout straight into ~/.deno/bin
```

Or run from source without compiling: `deno run -A src/bootstrap/mod.ts <args>`.

### The loop

```sh
# 1. write a spec (one per module) at src/<module>/<module>.rune
#    (copy examples/todos/src/tasks/tasks.rune as a starting point)

# 2. generate the module from it (also writes the project's deno.json import map)
rune sync src/<module>/<module>.rune --artifact keywords.json

# 3. fill in the bodies (the dev-owned mod.ts files); the sig.ts contracts are
#    generated for you. then verify, from the project dir:
deno check src/**/*.ts

# 4. lint the result against the architecture
rune .                   # "All clear — no violations found." = exit 0
```

Edit the spec and re-run `rune sync` anytime — `deno check` shows you exactly what
to reconcile (a new abstract method to implement, or a stray one to delete).
`rune sync --force` prunes files a spec no longer declares.

## First-class validation

- **Constraints in the spec**: `[TYP:uuid] id: string`,
  `[TYP:min=0,max=100] qty: number` — comma-separated `[TYP]` modifiers
  (`uuid`, `email`, `url`, `nonempty`, `int`, `min=N`, `max=N`, `positive`;
  they compose with `ext`/`core`) become class-validator decorators on the
  generated DTO fields.
- **Asserts at every seam**: generated coordinators validate input, adapter
  reads/writes, and the result via `assert` from `#assert` (keep's runtime).
  A failed contract throws `RuneAssertError`, which keep maps to HTTP 422
  with `{ target, context, failures }` and dotted paths (`lines.1.qty`).
- `RUNE_ASSERT=off` turns every assert into a passthrough (trusted prod);
  the `no-dto-cast` lint keeps hand-written coordinator code from bypassing
  the seams with blind `as XxxDto` casts.

## Language

The language itself — tags, codegen templates, lint rules, folder layout — lives in
**`keywords.json`** (the single source of truth), edited visually in **Rune Studio**:

```sh
deno task studio
```

- Syntax reference: `lang/docs/spec.md`
- Enforced rules: `lang/docs/constraints.md`
- Worked examples: `examples/todos/`

## Commands

| Command | Does |
|---|---|
| `rune [dir]` | lint a project against the architecture |
| `rune sync <file.rune>` | generate/update a module from its spec (+ keep bootstrap in `bootstrap/`) |
| `rune manifest <file.rune>` | one-shot generate (no prune) |
| `rune validate <keywords.json>` | validate the artifact |
| `rune lsp` / `rune fmt <file>` | language server / format (Rust helpers) |
| `rune update [tag]` | self-update binaries + Claude skill (alias: `upgrade`) |

## keep — the generated runtime

[`keep/`](keep/) is the Deno backend framework rune-generated projects run on
(DI bootstrap, token/Firebase auth, auto Swagger docs, in-process API client,
Fresh embedding; built on `@danet/core`). Published to JSR as
[`@mrg-keystone/keep`](https://jsr.io/@mrg-keystone/keep). Its assert runtime is
what rune's generated seams import via `#assert` (resolved in-tree to
`keep/src/assert/mod.ts` here, and to `jsr:@mrg-keystone/keep@^1/assert` in
generated user projects). The lockstep guard
(`deno task check:lockstep`) machine-checks that the class-validator /
class-transformer / reflect-metadata ranges rune emits match the ranges keep
declares in `keep/deno.json` — a single decorator stack across both.

```sh
deno task test:keep       # keep's test suite
deno task check:keep-jsr  # keep's JSR publish preflight (dry-run)
```

## Tests & verify

```sh
deno task verify                  # lockstep guard + the full L0–L7 verify ladder
deno test -A src/                 # the engine
deno task test:keep               # keep's unit suite
deno task test:e2e                # the rune→keep integration acceptance (e2e/)
(cd rune-studio && deno test -A tests/)
(cd lang && cargo test --workspace)   # parser + LSP
```

## Releases

CI is path-filtered by facet ownership:

- `release-rune` rebuilds rune's rolling `latest` release (the three binaries +
  the `skills/rune` tarball) on any push **except** ones touching only keep-owned
  or non-binary facets (`keep/`, `skills/keep/`, `e2e/`, `examples/`, `docs/`,
  `todos/`).
- `publish-keep` publishes `@mrg-keystone/keep` to JSR and refreshes the
  `keep-latest` release (the `skills/keep` tarball + installer) on pushes to
  `keep/**` or `skills/keep/**`.
