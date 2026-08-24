## Rune Studio (`rune-studio/`)

A standalone **Fresh 2** (Deno + Preact + Vite) single-page workbench for
*designing the language itself* — edit the language definition and watch every
downstream effect live. Run with `deno task studio` from the repo root.

Layout: a two-pane workbench. Left — a live `.rune` editor (CodeMirror,
registry-driven tokenizer) with a diagnostics strip. Right — switchable
lenses, grouped **output** / **language** / **tools**:

The shared engine — `lib/engine.ts`, importing `parse`/`planManifest` from
`src/rune/domain/business/` — backs codegen, so the *Code* lens is pinned
identical to what the CLI emits (the L5 verify gate enforces this). Lint and
the rest of the UI, though, run through the Studio's own second parser,
`lib/parse.ts`, and can in principle diverge from the engine (the residual
G2/G9 risk from the rebuild's gap analysis). So when a Studio reading
disagrees with a CLI run: the *Code* lens is guaranteed identical, everything
else — Diagnostics, Lint, Architecture, Check — is not.

**Read-only views**

| Group | Lens | Reads | Notable gap |
|---|---|---|---|
| output | Code | The generated hexagonal file tree, click-to-view | none |
| output | Diagnostics | Spec lint + generated-code lint findings | none |
| tools | Check | Point at a real directory on disk and run the generated-code ruleset over the actual files | none |

**Edit surfaces**

| Group | Lens | Edits | Backing `keywords.json` field (→ [08/01](./01-lang-keywords-json-the-artifact.md)) | Notable gap |
|---|---|---|---|---|
| language | Constructs | Each tag's literal, color, summary, follows shape, indent, rules; add/delete | `tags[]` | none |
| language | Lint | Declarative rule instances, with a live "firing now" strip | `lint[]` | none |
| language | Architecture | The import-graph layer rules + the path→layer classifier | `architecture` | `architecture.reexportAllowed` (a sub-field of `architecture`) has no edit UI — hand-edit only |

### Editing propagation, end to end

Example: recoloring `[REQ]` in the Constructs lens.

1. **Editor repaint.** The edit updates the tag's `color` in the in-memory
   registry; the left-pane editor's registry-driven tokenizer re-paints every
   `[REQ]` occurrence immediately.
2. **Code lens re-render.** Because the Code lens is backed by the shared
   engine reading that same registry, it re-runs `parse`/`planManifest`
   against the updated artifact and re-renders the file-tree preview.
3. **Diagnostics re-run.** Spec lint and generated-code lint re-run against
   the updated artifact; a color-only edit surfaces no new findings, but the
   pass always re-fires on any registry change.
4. **Export/Save.** Nothing is written to disk until the user explicitly
   exports or saves — see below.

Plus a 16-step guided tour (`?tutorial=true`).

### Export and Save

One TS engine drives parse, codegen, lint, and the grammar (the Rust
generation path was retired per ADR 0001), which is why Export can run the
`keywords.json` → `grammar.js`/`highlights.scm` step of that pipeline itself
— but the two actions write different amounts to disk:

- **Export** — a modal that writes the source `keywords.json` plus
  regenerates `grammar.js` and `lang/queries/highlights.scm`, the same two
  text artifacts `scripts/generate.mjs` produces
  ([08/02](./02-the-grammar-lang-grammar.md) owns how those two are built and
  what "derived" means for them). Export stops there: it does not run
  `scripts/build-grammar.ts`, so it builds no WASM and touches nothing under
  `rune-studio/static/`, and it never touches the VS Code extension's
  hand-copied `tree-sitter-rune.wasm`/`highlights.scm` bundle
  ([08/02](./02-the-grammar-lang-grammar.md)) — that copy is refreshed only by
  the separate hand-copy step, never by Studio. Reach for Export when the two
  text artifacts need to be current — e.g. before running the drift gate —
  not to refresh the VS Code extension or any other WASM consumer.
- **Save** — persists only the edited language back to `keywords.json`, in
  place; no grammar/highlighter rebuild. Reach for Save while iterating
  inside the Studio, where the registry itself is the only thing that needs
  to be current.

The write target for both Save and Export is `lang/keywords.json`
([08/01](./01-lang-keywords-json-the-artifact.md)) — the same file the rest of
the toolchain reads as source of truth, so Save/Export round-trip through it
rather than a Studio-private copy. The broken `../keywords.json` resolution
Save and Export currently go through is the bug tracked under Known drift
below, not an open question about where writes should land.

### Known drift (as of this writing)

The `ln/` → `rune-studio/` relocation is not fully propagated:

- The registry path is **broken**: the studio (routes, API, test) reads
  `../keywords.json` → `<repo>/keywords.json`, which doesn't exist — the file
  lives at `lang/keywords.json`.
- The studio README describes files that no longer exist
  (`data/keywords.json`, `lib/render.ts`).
- Stale Vite aliases point at a retired deeper layout (`src/shape-checker`).
- The studio still carries its own second parser (`lib/parse.ts`) for
  lint/UI modeling, with the residual divergence risk from the engine noted
  above.
- Tests: 14 Deno unit tests over parse/engine/lint; no committed
  browser/e2e suite.

See `docs/REBUILD-PROGRESS.md` and
[12-history-and-roadmap.md](../12-history-and-roadmap/00-overview.md) for the rebuild
work-orders that produced this state and the scoped follow-ups.
