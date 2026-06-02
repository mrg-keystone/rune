# Design Notes

> Implementation rationale for the merged rune + shape-checker product. `new-product.md` describes *what* we're building; this doc describes *why these decisions* and *what alternatives were rejected*.

---

## 1. Integration approach: TS-port the rune parser

**Decision:** port `rune/parser/src/lib.rs` to TypeScript inside shape-checker. Drop the Rust parser from the runtime path. Keep the Rust LSP available for editor squiggles only — not part of this product.

**Alternatives considered:**

- **A. Subprocess.** Keep rune as a Rust binary; shape-checker shells out to `rune --json`. *Rejected:* two release artifacts, two languages, requires `rune` on PATH.
- **B. TS port.** Re-implement the line parser in TS. *Chosen.* Parser is ~400 lines of tagged enums; rewriting is faster than maintaining two-language interop.
- **C. Two-binary monorepo.** Rust LSP for editors + TS parser for enforcement. *Rejected:* parser duplicated, drift risk forever.
- **D. Pre-compile JSON.** `rune compile spec.rune > canonical-paths.json`. *Rejected:* only powers the `structure` rule; loses fault/signature/DTO info.
- **E. Full TS integration.** What we picked, expanded form of B.

**Why TS-port wins:** Single Deno project, single `deno compile`, zero runtime deps, no PATH dance. The Rust ecosystem (tower-lsp, tree-sitter) gives us nothing the Deno binary doesn't already have for CLI use. Editor squiggles are a separate concern served by the existing Rust LSP, which can stay parked.

---

## 2. `canonical-paths.json`: zero structural changes, no annotations

**Decision:** `canonical-paths.json` stays exactly as it is. No `$rune` placeholder bindings inside it, no `$rune-template` annotations on file entries.

**Alternatives considered:**

- **A. Embedded `$rune` annotations.** Add `"$rune": { "from": "REQ.noun", "case": "kebab" }` on every placeholder slot. *Rejected:* mixes layout schema with codegen semantics; clutters the JSON; user pushed back on `$` sigil.
- **B. Sibling `rune-bindings.json`.** Same data, separate file. *Rejected:* splits truth across two JSONs that have to stay in sync.
- **C. Convention by placeholder name.** Hardcoded map in TS: `<feature>` ← step noun, `<process>` ← REQ, etc. *Chosen.* Placeholders already have semantically meaningful names; the binding is small (~7 entries) and stable.
- **D. Frontmatter on templates.** Each `.tpl` file declares its slot. *Rejected:* extra mini-DSL, extra parser dependency.

**The chosen split — three files, three concerns:**

| File | Owns | Format |
|---|---|---|
| `assets/canonical-paths.json` | Layout (what slots exist) | JSON, unchanged |
| `src/.../rune-bindings/mod.ts` | Semantics (placeholder ↔ rune element) | TS, type-checked |
| `assets/scaffold-templates/<tree>/` | Content (file stubs) | Folder tree mirroring layout |

The template folder structure encodes the binding visually:
```
assets/scaffold-templates/src/<module-name>/domain/coordinators/<process>/mod.ts.tpl
                          → src/recording/domain/coordinators/recording-set/mod.ts
```
Path is the binding. No metadata, no frontmatter, no `$` annotations.

---

## 3. CLI surface: `scaffold` + `sync` collapsed to `manifest`

**Decision:** one command — `manifest` — for both first-time generation and ongoing spec evolution. Always idempotent. Always skips existing files.

**Alternatives considered:**

- **Two commands:** `scaffold` (errors on collision) and `sync` (skips on collision). *Rejected:* one idempotent command is simpler. Re-running on a partially-built project should produce the same outcome whether it's the first run or the tenth. The collision-as-error mode adds a defensive prompt for no real safety gain — `manifest` already never overwrites.
- **One command:** `manifest`, always idempotent. *Chosen.* Same outcome whether the project is empty, partially built, or fully written.

**`manifest` semantics:**
- Creates new files for new rune slots.
- Appends new test cases to existing test files when faults are added (only in known append slots).
- Skips every other existing file unconditionally.
- Never overwrites.
- Never edits non-test files.

**Five total subcommands:** `manifest`, `lint` (default), `check`, `prune`, `explain`. Down from the originally-proposed eight.

---

## 4. Removal: asymmetric on purpose

**Decision:** `manifest` adds; `prune` removes; never the same command. `prune` defaults to `--dry-run`; only writes with `--force`.

**Reasoning:**

- **Code has bodies.** A stub becomes hours of work. A typo in the rune (accidental delete of a `[REQ]`) shouldn't nuke that work.
- **Sub-slot edits are dangerous.** Removing one fault means surgically deleting a `Deno.test` block from a multi-test file — easy to corrupt adjacent code.
- **The linter already catches drift.** `rune-extra-files` flags orphans. Removal stays a deliberate action, not an automatic consequence.

**`prune` constraints:**
- Only deletes whole folders/files — never edits existing files.
- Dry-run by default; `--force` to commit.
- Sub-slot drift (orphan test cases inside a file) stays a lint violation; the human edits the file directly.

The asymmetry mirrors the trust gradient: forward (rune → code) is automatic and safe; backward (code → orphan deletion) is explicit and reviewed.

---

## 5. Required rune extensions

**Decision:** add three things to today's rune grammar. Everything else stays as in `rune/docs/spec.md`.

| Addition | Why | Maps to |
|---|---|---|
| `[MOD] name` directive | Rune today has no module concept; canonical-paths needs `<module-name>` | `src/<module-name>/` |
| `:core` modifier on `[DTO]`/`[TYP]` | canonical-paths splits `core/` (kernel) from `<module>/` (isolated); rune was locationless | routes to `src/core/...` vs `src/<module>/...` |
| `[ENT] surface.action(...)` | Rune captures outgoing boundaries (`db:`, `os:`, `ex:`) but not incoming (HTTP/CLI/queue handlers) | `<module>/entrypoints/<surface>/` |

**Considered and rejected:**

- **`[CORE]` block scope.** A block-level `[CORE] ... [/CORE]` wrapping multiple elements. *Rejected:* per-element `:core` modifier is more local and avoids invisible scope.
- **`[CTR]` emits a class file.** Make `[CTR] storage` materialize a class file in some folder. *Rejected:* `[CTR]` is a scope-only marker. The class declaration follows from `[TYP] storage: Class` and emerges naturally because some step uses `storage.x` (which scaffolds the file). Keeps spec focused on flows.
- **UI vocabulary (`[VIEW]`, `[STYLE]`).** *Deferred.* Out of scope for v1.
- **Module nesting in one file.** *Rejected:* one rune per module is cleaner than nested modules in a single file. Convention: `specs/<module>.rune` or `src/<module>/spec.rune`.

Auto-derived (no syntax needed):
- `mod-root.ts` — every `[REQ]` whose noun matches the module name is exported.
- `bootstrap/` — emitted once per project.

---

## 6. The rune-to-slot mapping

**The critical correction from early drafts:** `[REQ]` does NOT map to `business/<feature>/`. It maps to `coordinators/<process>/`.

`canonical-paths.json` separates three layers:
- `business/<feature>/mod.ts` — pure logic, no I/O (one step).
- `data/<service>/mod.ts` — adapter (one boundary).
- `coordinators/<process>/mod.ts` — orchestrates business + data (the flow itself).

A `[REQ]` *is* a flow — it belongs in `coordinators/`. The untagged steps *inside* a `[REQ]` (`id::create`, `metadata.toDto`) are what map to `business/<feature>/`.

This means `[REQ:core]` is invalid. Coordinators are module-level by definition; `core/` has no `coordinators/` slot. The `:core` modifier is allowed only on `[DTO]`, `[TYP]`, and untagged business step nouns.

**Three test layers, three fault destinations:**

| Fault location in rune | Test file destination |
|---|---|
| Under untagged step | sibling `test.ts` (unit) |
| Under boundary step (`db:`, `os:`, `ex:`, etc.) | adapter's `smk.test.ts` (smoke) |
| Bubbling up through `[REQ]` | coordinator's `int.test.ts` (integration) |

Rune already names the granularity (untagged / boundary / whole REQ), and canonical-paths already names three matching test files. One-to-one.

---

## 7. Rule architecture: 22 siloed rules, no pipeline change

**Decision:** every new rune-derived rule looks exactly like the existing 12 — one folder under `rules/implementations/<rule>/` with `mod.ts` + `test.ts`. The pipeline iterates; rules don't know about each other.

**12 architectural (today, untouched):** `barrel-discipline`, `data-class-returns`, `dto-validation`, `external-imports`, `fixture-promotion`, `import-aliases`, `layer-restrictions`, `module-fragmentation`, `module-isolation`, `poly-detection`, `poly-isolation`, `poly-stray`, `structure`.

**10 rune-derived (new):**
1. `rune-coordinator-presence` — every `[REQ]` has a coordinator folder.
2. `rune-business-presence` — every untagged step's noun has a business feature folder.
3. `rune-adapter-presence` — every boundary call has an adapter folder.
4. `rune-dto-shape` — every `[DTO]` has a Zod schema with matching keys.
5. `rune-typ-shape` — every `[TYP]` has a corresponding type definition.
6. `rune-fault-coverage` — every fault has a matching `Deno.test` case.
7. `rune-entrypoint-presence` — every `[ENT]` has an entrypoints folder.
8. `rune-poly-cases` — every `[CSE]` has an implementations folder.
9. `rune-signature-parity` — code signatures match rune signatures.
10. `rune-extra-files` — folders/files without rune counterparts are flagged.

**Two new business modules** (not rules, but shared infrastructure used by rules):
- `rune-parse/mod.ts` — TS port of the line parser. Pure function: `string → RuneAst`.
- `rune-bindings/mod.ts` — placeholder ↔ rune element map. Tiny, type-checked.

The parser runs once per scan; results are cached in pipeline context so 10 rules reading the same AST cost one parse.

---

## 8. Speed tiers

**Decision:** rune-derived rules are parser-based and fast (no LSP needed). `signature-parity` uses the LSP and is slow. Default `lint` runs everything; `check` runs only the rune subset for tight edit loops.

This matters when the human is iterating tightly — running lint after every small edit. `check` exists so the rune-derived rules can run quickly between edits, with the full `lint` reserved for end-of-task verification. Both still scan the whole project; the speed difference comes from skipping LSP-backed rules, not from narrowing scope.

---

## 9. Migration order

Each step ships independently. No big-bang.

1. Add `rune-parse/` + `rune-bindings/` business modules. No rules use them yet. Tests pass.
2. Add `rune-coordinator-presence` rule. Wires into pipeline. Lint without `.rune` files = no-op; lint with `.rune` files starts checking.
3. Add the other 9 rune rules one at a time.
4. Add `manifest` subcommand + templates. Manually manifest `example.rune`, run lint, fix any mismatches.
5. Add `prune` subcommand.
6. Self-host: write `specs/shape-checker.rune`. Run `manifest` against an empty dir; verify it reproduces our `src/`. `lint` passes against the result.

---

## 10. What was rejected outright

- **LLM integration of any kind.** Rune is a language, a code generator, and a linter. It doesn't call, embed, prompt, or know about LLMs. How humans fill stub bodies — by hand, with Claude, with Cursor, with Copilot — is their choice and outside the product.
- **Editor integration / LSP from this product.** Stays the Rust LSP's job, separately. Humans read/write `.rune` as plain text in their normal editor.
- **Watch mode / daemon.** The human invokes commands when they want them.
- **`init` command / interactive wizards.** The human creates files directly.
- **Spinners, banners, colored prose without `--json`.** Plain text + JSON only.
- **Network calls in core subcommands.** All subcommands run offline.
- **CI templates, git hooks, pre-commit configs.** Whatever wraps the project decides.
- **Module resolution / per-module scoping.** Lint runs on the whole project. All rune files are read together; the tool doesn't try to map "which rune affects which TS file." 500-foot view is the only view. No `--module` flag, no incremental mode, no smart partial scans.
- **UI scaffolding (`template.html`, `styles.css`).** Out of scope.
- **`canonical-paths.json` becoming a build artifact.** It remains hand-authored; rune doesn't generate it.
- **Two-direction sync.** `manifest` only adds; `prune` only removes.

---

## 11. Open questions

1. **Rune file location convention.** `specs/<module>.rune` (centralized) vs. `src/<module>/spec.rune` (co-located)? Lean co-located — keeps each module's spec next to its code. Either works mechanically.
2. **Multiple REQs in one feature folder.** `recording.set` and `recording.get` would both target `coordinators/recording-set/` and `coordinators/recording-get/` — separate folders by `<process>` = `<noun>-<verb>`. Confirmed: process granularity is per-REQ, not per-noun.
3. **`[NON]` (non-DTO type).** Currently in rune for class types like `storage`, `metadata`. Maps where? Probably emerges naturally from `[CTR]` usage; may not need its own slot.
4. **Generic types in DTOs.** Rune supports `Array<T>`, `Record<K,V>`. The `rune-dto-shape` rule needs to translate these to `z.array(...)`, `z.record(...)`. Bounded but non-trivial — defer details to v1 implementation.
5. **Variant case-naming.** `[CSE] fiveNine` — folder name `five-nine/` (kebab) or `fiveNine/` (camel)? Lean kebab to match the rest of the file system.
6. **Self-host target.** `specs/shape-checker.rune` should reproduce this project's `src/` exactly. Will reveal gaps in the rune grammar when we try.

---

## 12. References

- `new-product.md` — what we're building.
- `rune/docs/spec.md` — current rune grammar.
- `rune/docs/example.rune` — reference rune file used as parser test fixture.
- `rune/docs/constraints.md` — current LSP-enforced rules.
- `assets/canonical-paths.json` — layout schema; unchanged.
- `src/shape-checker/domain/business/rules/implementations/` — existing rule architecture; new rules slot in alongside.
