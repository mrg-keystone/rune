# Neovim highlight fix — `[TYP:modifier]` lines render as all-`@rune.verb`

Status: **root cause confirmed, fix proven in isolation, blocked on two issues
(see §6).** Investigated 2026-06-19.

## 1. TL;DR

In Neovim, a `[TYP]` definition **with a modifier** (`[TYP:uuid]`,
`[TYP:nonempty]`, `[TYP:ext,uuid]`, `[TYP:int,min=0]`) renders as one flat
`@rune.verb` span — the `[TYP]` tag, the type name, and the primitive all turn
lavender. A **bare** `[TYP]` renders correctly (`@rune.tag` + `@rune.param` +
`@rune.type`). The cause is a **stale installed tree-sitter parser + query**,
not the grammar or query in the repo. `rune update` does not fix it because the
update path never refreshes the editor's parser/query.

## 2. Symptom

Open any spec with a `[TYP]` block and compare the two forms:

```
[TYP:uuid] id: string        ← whole line lavender (@rune.verb)   ✗
[TYP] createdAt: string       ← tag + name + type, correctly      ✓
```

Tree-sitter captures, dumped per character via
`vim.treesitter.get_captures_at_pos` against the **installed** parser:

```
line: [TYP:uuid] id: string          line: [TYP] createdAt: string
  "[TYP" -> [rune.verb]   ✗            "[TYP]"     -> [rune.tag]    ✓
  "uuid" -> [rune.verb]                "createdAt" -> [rune.param]
  "id"   -> [rune.verb]                "string"    -> [rune.type]   ✓
  "string" -> [rune.verb] ✗
```

## 3. Root cause (evidence)

The grammar tokenises the modifier **inside** the `typ_tag` token:

```js
// lang/grammar/grammar.js
typ_tag: ($) => token(seq("[TYP", optional(seq(":", /[^\]\s]+/)), "]")),
typ_line: ($) => seq($.typ_tag, $.typ_name, ":", $.typ_type),
```

So `[TYP:uuid]` is a single `typ_tag`. The repo grammar parses it correctly —
verified with `tree-sitter parse`:

```
(typ_line (typ_tag [0,0]-[0,10]) (typ_name) (typ_type (type_name)))
```

The bug is in the **installed artifacts**, which predate that grammar:

| Artifact | mtime | State |
| --- | --- | --- |
| `~/.local/share/nvim/site/parser/rune.so` | **Jun 7** | stale — old grammar, no modifier `typ_tag` |
| `~/.local/share/nvim/site/queries/rune/highlights.scm` | **Jun 7** | stale — uses old node name `boundary_prefix` |
| `grammar.js` modifier `typ_tag` | **Jun 17** | current |
| `~/.deno/bin/rune-syntax` binary | **Jun 17** | current |

The stale parser does **not** recognise `[TYP:uuid]` as a `typ_tag`; it
misparses the line and the words fall through to `@rune.verb`. The parser and
query are stale **as a matched pair** (both Jun 7), so the editor doesn't crash
— it just highlights the old way.

## 4. Why `rune update` doesn't deliver the fix

`scripts/install.sh` (the path `rune update` runs) installs the
`rune` / `rune-lsp` / `rune-syntax` **binaries** but **never re-runs the
editor-asset install**. The Neovim `parser.so` + `highlights.scm` are written
only by `rune-syntax install` (`lang/cli/src/commands/install.rs` →
`build_parser` + `setup_neovim`), which `scripts/install.sh` does not call.

Result: a past `rune update` refreshed the **binary** (Jun 17) but left the
**parser** (Jun 7) in place. That is exactly the observed split.

**Caveat — do not just call `rune-syntax install` from the update path.**
`setup_neovim` unconditionally **overwrites** `~/.config/nvim/after/ftplugin/rune.lua`
with the old 8-colour palette (`@rune.tag = #89babf`, no `@rune.role` /
`@rune.type` / `@rune.param` / `@rune.chrome`). Users who customised that file
(e.g. the richer "Mesa Vapor" palette + the `@lsp.type.boundaryNoun` override)
would have it clobbered. The refresh must touch **only the generated assets**
(`parser/rune.so`, `queries/rune/highlights.scm`), never the ftplugin / ftdetect
/ shell completions / icons.

## 5. The fix (and proof it works)

Refresh `parser.so` **and** `highlights.scm` **together** from the current
grammar. Built the parser from a regenerated `parser.c` (`tree-sitter generate`
→ `cc -dynamiclib -fPIC -O2 parser.c scanner.c -I .`, the same flags as
`build_parser`) + the current `lang/queries/highlights.scm`, and verified in a
clean sandbox (`nvim --clean`, no plugins/LSP):

```
query_loads=true
L56: [TYP:uuid]=rune.tag  id=rune.param  string=rune.type   ✓
```

i.e. the modifier form now matches the bare form. Three parts to land:

1. **Regenerate and commit `lang/grammar/src/parser.c`** so it matches
   `grammar.js` and the query (the committed `parser.c` is stale — see §6.1).
2. **Make `scripts/install.sh` refresh editor assets after installing binaries**,
   **non-destructively**: rebuild `parser.so` + copy `highlights.scm` for
   already-integrated editors only; never write `ftplugin`/`ftdetect`/shell/
   icons. This likely needs a narrow `rune-syntax` entry point
   (e.g. `rune-syntax install --refresh` / a `sync` subcommand) since the
   current `install` also rebuilds the LSP (needs the repo) and runs the full
   interactive editor/shell/icon setup.
3. The query change `(typ_name) @rune.param` is **already present** in
   `lang/queries/highlights.scm` (line ~47) and in the installed query — it is
   not the missing piece. The missing piece is the **parser**.

## 6. Blockers (must clear before shipping)

### 6.1 The repo is mid-refactor; committed generated artifacts are stale
`git status` shows uncommitted modifications to `grammar.js`,
`lang/queries/highlights.scm`, `lang/parser/src/lib.rs`, `lang/lsp/src/main.rs`,
the generators (`generate-core.mjs`, `rune-studio/lib/generate-core.ts`), and
`keywords.json`. Meanwhile committed `lang/grammar/src/parser.c` is stale:
`tree-sitter generate` rewrites it by **~3,289 lines**, and the **committed**
parser fails to load the current query:

```
query_loads=false
Query error at 49:2. Invalid node type "boundary_prefix":  (boundary_prefix) @rune.boundary
```

A `boundary_prefix` → `service_prefix` rename is in flight. A release cut from
this state would ship an inconsistent parser/query. **Finish + commit the
refactor, then regenerate + commit `parser.c`.**

### 6.2 A rebuilt parser hangs the full Neovim config
The regenerated parser works in `nvim --clean` but **SIGKILLs the real nvim
(exit 137, ~20s hang) when opening a `.rune` file**. Isolation results:

- OLD parser + OLD query, open `.rune` → exit 0 (fine)
- NEW parser + NEW query, open **non-rune** file → exit 0 (fine)
- NEW parser + NEW query, open `.rune` → **hang → SIGKILL**
- Hang persists even with **both** `vim.lsp.start` and `vim.treesitter.start`
  stubbed → not the rune ftplugin's LSP or highlighter

So it is a plugin interaction (suspect: `nvim-treesitter` applying extra
queries — injections/folds/indents — to the new parser; note the repo also has
a separate `runescript` parser under `nvim-treesitter/queries/runescript/`).
**This must be root-caused before any release** — otherwise `rune update` would
hang every user's editor.

## 7. Verification performed / environment left clean

- Diagnosed via tmux-driven nvim + `tmux capture-pane -e` (ANSI colour decode)
  and `vim.treesitter.get_captures_at_pos` (grammar-level), two independent
  methods agreeing.
- **Restored** the user's original `parser.so` + `highlights.scm`; confirmed
  `nvim specs/funnels.rune` opens cleanly (`exit 0`).
- Reverted the `tree-sitter generate` artifacts I created
  (`parser.c`, `grammar.json`, `node-types.json`); the repo's pre-existing WIP
  is untouched.

## 8. Checklist to close this out

- [ ] Finish + commit the `boundary_prefix`→`service_prefix` grammar refactor.
- [ ] `tree-sitter generate`; commit `parser.c` / `grammar.json` /
      `node-types.json` so they match `grammar.js` + the query.
- [ ] Root-cause and fix the full-config nvim hang (§6.2).
- [ ] Add a non-destructive editor-asset refresh to `rune-syntax`
      (parser + query only; never the ftplugin), and call it from
      `scripts/install.sh` after binary install (best-effort, guarded on an
      existing integration).
- [ ] Release from `main`; `rune update`; verify `[TYP:uuid]` renders
      `tag · param · type` and the editor does not hang.
