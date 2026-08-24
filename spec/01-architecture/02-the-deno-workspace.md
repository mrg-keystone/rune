## The Deno workspace

The root `deno.json` is rune's own config; its `workspace` members are the
self-contained sub-projects: `keep` (the runtime library), `e2e/cake`,
`e2e/checkout`, and `examples/in-process-client`. Members resolve the runtime
from the **in-tree source** (`keep/`), so rune can be tested against an
unreleased runtime. Generated *user* projects (outside this repo) still pin
`jsr:@mrg-keystone/rune@^4` — intentional and unchanged. The in-repo
`examples/` spec→code demos (`todos`, `shop`, `cake`) are *not* members —
absent from the `workspace` list and under the root config's `exclude` — and
none of them resolves the runtime in-tree. `todos`, the only demo whose
generated tree is committed, resolves like the user projects it models:
`examples/todos/deno.json` (scaffolded by `rune init`, then merged on every
subsequent `rune sync`, same as any member project) pins
`jsr:@mrg-keystone/rune@^4` and `@^4/assert`. `shop` and `cake` commit no
generated output — just their `.rune` specs — so they carry no `deno.json`
and have nothing to type-resolve; running `rune init` on them would write
the same JSR-pinned config, which `rune sync` then merges on later runs
(cake's README shows how to repoint `@mrg-keystone/rune` at a local keep
checkout). `rune-studio/` is a standalone Fresh 2 + Vite app with its own
lockfile and its own `deno.json` (run via `deno task studio`); `fixtures/`
has its own `deno.json` too. The root config's `exclude` array lists every
nested directory that owns a `deno.json` but isn't a workspace member:
`todos`, `shop`, `cake`, `rune-studio`, and `fixtures`.

Key root import aliases: `@/` → `src/`, `@core/` → `src/core/`, `@rune/` →
`src/rune/`, `@keywords` → `lang/keywords.json`, `#assert` →
`keep/src/assert/mod.ts` (in-tree; generated projects get
`jsr:@mrg-keystone/rune@^4/assert`).

