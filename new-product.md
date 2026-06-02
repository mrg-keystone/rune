# The Product

> Rune is three things: a language for describing a module, a code generator that drafts the skeleton from that description, and a linter that verifies code stays inside the description. CLI only. No UI. No LLM integration.

---

## 1. What the product is

Three things, nothing more:

1. **A language.** `.rune` files describe a module's requirements, DTOs, types, faults, polymorphic cases, and system boundaries. Plain text, structured, source-controlled.
2. **A code generator.** `shape-checker manifest <rune>` reads a rune file and writes the project skeleton — directories, file stubs, test cases — into the layout defined by `canonical-paths.json`. Idempotent. Never overwrites.
3. **A linter.** `shape-checker .` verifies the project matches the rune (and the architectural rules). Returns JSON. Stable exit codes.

That's the whole product. One binary, one spec format. The human writes the rune, runs the binary, fills the bodies. **How** the bodies get filled — by hand, with Claude, with Cursor, with Copilot, with ChatGPT — is outside the product. Rune doesn't know or care.

---

## 2. The four-step flow

```
   1. WRITE RUNE          Human writes specs/recording.rune.
                          (Any editor; humans may use LLM assistants
                          alongside, but rune doesn't know about that.)
                              │
                              ▼
   2. MANIFEST             $ shape-checker manifest specs/recording.rune
                          The binary drafts the skeleton — files, stubs,
                          test cases. Idempotent. Never overwrites.
                              │
                              ▼
   3. FILL BODIES          Human fills the TODOs in the manifested files.
                          By hand, or with whatever LLM/IDE they use.
                          Outside the product's scope.
                              │
                              ▼
   4. SHAPECHECK           $ shape-checker .
                          Returns JSON. If violations, human fixes them,
                          re-runs. Loop until exit 0.
                              │
                              ▼
                          ┌─── exit 0? ────┐
                          │                │
                         no              yes
                          │                │
                          └──► back to 3   └──► done
```

When the spec evolves: human edits the rune, runs `manifest`, new stubs appear in the right places, fills them, runs `shapecheck`. Existing code never touched.

---

## 3. Subcommand surface

```sh
shape-checker manifest <rune>           # materialize one rune file into the project (idempotent)
shape-checker .                         # lint the whole project (default)
shape-checker check                     # fast subset — rune-derived rules only, whole project
shape-checker prune <rune> [--dry-run]  # delete orphans (dry-run default)
shape-checker explain <rule>            # fetch rule rationale
```

Five subcommands. Each accepts `--json` for structured output. All are non-interactive. None make network calls.

**Scope is always the whole project.** Lint reads every `.rune` file in the project (typically `specs/*.rune` or `src/*/spec.rune`), parses them all, runs all 22 rules across the entire source tree. There's no `--module` flag, no incremental mode, no partial scan. 500-foot view by design — keeps the tool simple, keeps the rules independent of each other, keeps the result consistent.

| Subcommand | Reads | Writes | Exit codes |
|---|---|---|---|
| `manifest` | one rune file, canonical-paths, templates, project | new files only (skips existing) | 0 ok / 2 parse error |
| `lint` (`shape-checker .`) | whole project, all rune files | nothing | 0 clean / 1 violations / 2 tool error |
| `check` | whole project, all rune files | nothing | 0 clean / 1 violations / 2 tool error |
| `prune` | one rune file, project | deletes orphans (only with `--force`) | 0 ok / 1 would-delete / 2 tool error |
| `explain` | nothing | nothing | 0 always |

`manifest` and `prune` operate on a single named rune at a time (you say what you want generated or pruned). `lint` and `check` operate on the whole project (the tool reads everything and tells you everything that's wrong).

---

## 4. The four operations, end to end

### Step 1 — Write the rune

Human writes `specs/recording.rune` in their editor of choice:

```
[MOD] recording

[REQ] recording.set(GetRecordingDto): IdDto
    id::create(providerName, externalId): id
    [PLY] provider.getRecording(externalId): data
        [CSE] genie
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
        [CSE] fiveNine
        ex:provider.search(externalId): SearchDto
          not-found timed-out invalid-id
        ex:provider.download(url): data
          not-found timed-out
    [CTR] metadata
    db:metadata.set(IdDto, MetadataDto): void
      timed-out network-error
    os:storage.save(IdDto, data): void
      timed-out network-error
    id.toDto(): IdDto


[DTO] GetRecordingDto: providerName, externalId
    input for retrieving a recording
[DTO] IdDto: providerName, externalId
    unique identifier
[DTO] MetadataDto: metadata?
    wrapper for recording metadata

[TYP] providerName: "genie" | "fiveNine"
[TYP] externalId: string
[TYP] data: Uint8Array
```

The rune is a structured spec the human writes and owns. It's a complete, machine-checkable contract: every requirement, every fault, every boundary, every type.

### Step 2 — Manifest (the draft)

The human runs:

```sh
$ shape-checker manifest specs/recording.rune --json
{
  "module": "recording",
  "rune": "specs/recording.rune",
  "created": [
    "src/recording/mod-root.ts",
    "src/recording/dto/get-recording.ts",
    "src/recording/dto/id.ts",
    "src/recording/dto/metadata.ts",
    "src/recording/domain/coordinators/recording-set/mod.ts",
    "src/recording/domain/coordinators/recording-set/int.test.ts",
    "src/recording/domain/business/id/mod.ts",
    "src/recording/domain/business/id/test.ts",
    "src/recording/domain/business/provider/base/mod.ts",
    "src/recording/domain/business/provider/base/test.ts",
    "src/recording/domain/business/provider/implementations/genie/mod.ts",
    "src/recording/domain/business/provider/implementations/genie/test.ts",
    "src/recording/domain/business/provider/implementations/five-nine/mod.ts",
    "src/recording/domain/business/provider/implementations/five-nine/test.ts",
    "src/recording/domain/business/provider/poly-mod.ts",
    "src/recording/domain/data/provider/mod.ts",
    "src/recording/domain/data/provider/smk.test.ts",
    "src/recording/domain/data/metadata/mod.ts",
    "src/recording/domain/data/metadata/smk.test.ts",
    "src/recording/domain/data/storage/mod.ts",
    "src/recording/domain/data/storage/smk.test.ts"
  ],
  "appended": [],
  "skipped": [],
  "duration_ms": 420
}
```

Every stub file pre-populated with:
- The exact function signature from the rune.
- Imports for every DTO/TYP referenced.
- TODO-bodied tests, one per fault, named after the fault.
- A header comment pointing back to the rune line that produced this file.

`manifest` is **idempotent**:
- Run on empty project → `created` everything (this run).
- Run again → `skipped` everything (no-op).
- Run after rune adds a `[CSE]` → `created` only the new implementation folder; everything else `skipped`.
- Run after rune adds a fault → `appended` a new test case to the existing test file; everything else `skipped`.

`manifest` never overwrites existing files. Code from step 3 is safe forever — re-running `manifest` after the rune evolves only adds the new pieces.

### Step 3 — Fill bodies

The human opens the manifested files and writes the implementations. They may do this by hand, or with help from any LLM/IDE assistant they use (Claude, Cursor, Copilot, etc.) — that's their choice and outside the product. Whoever writes the bodies operates under the constraints already baked into the stubs:

- **Locked signatures.** `recording.set(input: GetRecordingDto): Promise<IdDto>` — cannot drift.
- **Enumerated faults.** Each test stub names a fault. Implementation must produce that fault path.
- **Locked layout.** No path to put a `helpers/` folder; canonical-paths.json doesn't allow it. The lint rule catches it.
- **Boundary specification.** The rune says `db:metadata.set` calls the metadata adapter, so the coordinator imports from `domain/data/metadata/` and nowhere else.

### Step 4 — Shapecheck

The human runs:

```sh
$ shape-checker . --json
{
  "violations": [],
  "passed": [
    "structure", "barrel-discipline", "layer-restrictions",
    "module-isolation", "rune-coordinator-presence",
    "rune-business-presence", "rune-adapter-presence",
    "rune-dto-shape", "rune-fault-coverage", "rune-poly-cases",
    "rune-signature-parity", "..."
  ],
  "rune_contract": {
    "modules": 1, "reqs": 1, "dtos": 3, "faults": 6, "poly_cases": 2
  },
  "exit_code": 0
}
```

Or with violations:

```json
{
  "violations": [
    {
      "rule": "rune-signature-parity",
      "path": "src/recording/domain/coordinators/recording-set/mod.ts",
      "line": 14,
      "expected": "recording.set(input: GetRecordingDto): Promise<IdDto>",
      "actual":   "recording.set(input: GetRecordingDto, opts?: object): Promise<IdDto>",
      "rune_ref": "specs/recording.rune:3",
      "fix": "remove `opts?: object`, or update specs/recording.rune"
    }
  ],
  "passed": ["structure", "barrel-discipline", "..."],
  "exit_code": 1
}
```

If violations: human edits the cited files (by hand or with their assistant of choice) and re-runs `shape-checker .`. Loop until `exit_code: 0`.

---

## 5. Spec evolution

Human edits `specs/recording.rune` to add a fault:

```diff
        ex:provider.search(externalId): SearchDto
-         not-found timed-out invalid-id
+         not-found timed-out invalid-id rate-limited
```

Human runs `manifest`:

```sh
$ shape-checker manifest specs/recording.rune --json
{
  "module": "recording",
  "created": [],
  "appended": [
    "src/recording/domain/coordinators/recording-set/int.test.ts",
    "src/recording/domain/business/provider/implementations/genie/test.ts"
  ],
  "skipped": ["..."]
}
```

Two test files got new `Deno.test('rate-limited', …)` stubs appended. Every other file unchanged. The human fills the new test bodies and adds the `rate-limited` handler in the existing implementation, then runs `shape-checker .`. Done.

---

## 6. Removal: orphan flag, opt-in delete

Human edits the rune to remove the `[CSE] fiveNine` block. Runs lint:

```sh
$ shape-checker . --json
{
  "violations": [
    {
      "rule": "rune-extra-files",
      "path": "src/recording/domain/business/provider/implementations/five-nine/",
      "reason": "no [CSE] in specs/recording.rune",
      "fix": "delete with: shape-checker prune specs/recording.rune --dry-run"
    }
  ],
  "exit_code": 1
}
```

Human previews the deletion:

```sh
$ shape-checker prune specs/recording.rune --dry-run --json
{
  "would_delete": [
    "src/recording/domain/business/provider/implementations/five-nine/mod.ts",
    "src/recording/domain/business/provider/implementations/five-nine/test.ts",
    "src/recording/domain/business/provider/implementations/five-nine/"
  ]
}
```

Then commits the deletion:

```sh
$ shape-checker prune specs/recording.rune --force --json
{ "deleted": [...] }
```

`prune` only deletes whole folders/files. Never edits existing files to remove sub-slot content. Sub-slot drift (an orphan test case inside a multi-test file) stays as a lint violation; the human cleans it up directly in the file.

The asymmetry: **`manifest` adds, `prune` removes.** Adding is safe and idempotent. Removing is explicit — the human runs `prune`, reviews the dry-run output, then commits with `--force`.

---

## 7. The rules

22 rules. Each is a folder under `src/shape-checker/domain/business/rules/implementations/<rule>/` with `mod.ts` + `test.ts`. The pipeline iterates; rules don't know about each other.

**12 architectural (today):**
`barrel-discipline`, `data-class-returns`, `dto-validation`, `external-imports`, `fixture-promotion`, `import-aliases`, `layer-restrictions`, `module-fragmentation`, `module-isolation`, `poly-detection`, `poly-isolation`, `poly-stray`, `structure`.

**10 rune-derived (new, fire only when `.rune` files are present):**
- `rune-coordinator-presence` — every `[REQ]` has a coordinator folder.
- `rune-business-presence` — every untagged step's noun has a business feature folder.
- `rune-adapter-presence` — every boundary call has an adapter folder.
- `rune-dto-shape` — every `[DTO]` has a Zod schema with matching keys.
- `rune-typ-shape` — every `[TYP]` has a corresponding type definition.
- `rune-fault-coverage` — every fault has a matching `Deno.test` case in the right file.
- `rune-entrypoint-presence` — every `[ENT]` has an entrypoints folder.
- `rune-poly-cases` — every `[CSE]` has an implementations folder.
- `rune-signature-parity` — code signatures match rune signatures.
- `rune-extra-files` — folders/files with no rune counterpart are flagged.

---

## 8. Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    shape-checker (one binary)                   │
├─────────────────────────────────────────────────────────────────┤
│   Subcommands:  manifest  lint  check  prune  explain           │
│                                                                 │
│   ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐    │
│   │ rune-parse/  │  │rune-bindings/│  │ scaffold-templates/│    │
│   │ (TS parser)  │  │ (placeholder │  │ (file stub tree    │    │
│   │              │  │  ↔ element)  │  │  mirroring layout) │    │
│   └──────┬───────┘  └──────┬───────┘  └─────────┬──────────┘    │
│          └──────────┬──────┴────────────────────┘               │
│                     ▼                                           │
│        ┌────────────────────────────┐                           │
│        │  canonical-paths.json      │  ← unchanged, no $ rune   │
│        │  (read by both lint and    │     annotations           │
│        │   manifest; pure layout)   │                           │
│        └────────────┬───────────────┘                           │
│                     ▼                                           │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  Rule pipeline — 22 siloed rules, each one folder       │   │
│   └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

Three concerns, three locations, no leakage:

| File | Owns |
|---|---|
| `assets/canonical-paths.json` | Layout (what slots exist) |
| `src/.../rune-bindings/mod.ts` | Semantics (which rune element fills each placeholder) |
| `assets/scaffold-templates/<tree>/` | Content (what to write at each slot) |

The template directory mirrors the target tree exactly:
```
assets/scaffold-templates/src/<module-name>/domain/coordinators/<process>/mod.ts.tpl
                          → src/recording/domain/coordinators/recording-set/mod.ts
```
Path is the binding. No metadata files, no frontmatter, no `$` annotations.

---

## 9. The rune-to-slot mapping

| Rune element | Slot | Name source |
|---|---|---|
| `[MOD] recording` | `src/<module-name>/` | `recording` |
| `[REQ] recording.set(...)` | `src/<module>/domain/coordinators/<process>/` | `recording-set` (noun-verb) |
| Untagged step `id::create(...)` | `src/<module>/domain/business/<feature>/` | `id` |
| `[PLY] provider.x(...)` | `src/<module>/domain/business/<feature>/` (poly variant) | `provider` |
| `[CSE] genie` | `.../implementations/<variant-name>/` | `genie` |
| `[CTR] storage` | scope-only; class export inside `business/storage/mod.ts` | — |
| `db:metadata.set(...)` | `src/<module>/domain/data/<service>/` | `metadata` |
| `[DTO] FooDto` (default) | `src/<module>/dto/<name>` | `foo` (kebab, strip `Dto`) |
| `[DTO:core] FooDto` | `src/core/dto/<name>` | `foo` |
| `[TYP] url` | `src/<module>/dto/<name>` (or `core/dto/` with `:core`) | `url` |
| `[ENT] http.post(...)` | `src/<module>/entrypoints/<name>/` | `http` |
| Fault under untagged step | injected as `Deno.test('<fault>')` in sibling `test.ts` | — |
| Fault under boundary step | injected in adapter's `smk.test.ts` | — |
| Fault on a step inside `[REQ]` | also injected in coordinator's `int.test.ts` | — |

`[REQ:core]` is invalid — coordinators are module-level by definition.

---

## 10. Required rune extensions

Three additions to today's grammar:

1. **`[MOD] name`** — top-of-file directive. Sets `<module-name>/`. Defaults to filename.
2. **`:core` modifier** — `[DTO:core]`, `[TYP:core]`. Routes to `src/core/...`.
3. **`[ENT] surface.action(InputDto): OutputDto`** — inbound entrypoint. Maps to `<module>/entrypoints/<surface>/`.

Auto-derived (no syntax):
- `mod-root.ts` — public REQs exported automatically.
- `bootstrap/` — emitted once per project.

Everything else (`[REQ]`, `[PLY]`, `[CSE]`, `[CTR]`, `[RET]`, `[DTO]`, `[TYP]`, `[NON]`, boundary tags, faults, scope rules) stays exactly as in `rune/docs/spec.md`.

---

## 11. Tool invariants

Guarantees the binary makes — so the human can re-run any command without fear:

- **`manifest` is deterministic.** Same rune + same templates → identical bytes.
- **`manifest` is idempotent.** Running twice in a row writes nothing the second time.
- **`manifest` never overwrites.** Existing files are always skipped.
- **`lint` is read-only.** Never modifies the project.
- **`prune --dry-run` is read-only.** Always safe to call.
- **No interactive prompts.** `prune` only writes with `--force`.
- **No network calls.** All five subcommands run offline.
- **Stable JSON schema.** Versioned; breaking changes bump major.
- **Stable exit codes.** `0` clean, `1` actionable findings, `2` tool error.

The product is the binary and the language. Nothing is auto-spawned, nothing phones home, nothing requires an account.

---

## 12. The constraint surface

What the rune locks down:

| Dimension | Constraint |
|---|---|
| File layout | Fixed by canonical-paths + rune element names. No invented folders. |
| Function signatures | Fixed by rune step declarations. `signature-parity` enforces. |
| Public API | Fixed by `mod-root.ts` re-exports derived from `[REQ]` lines. |
| Boundaries | Fixed by `db:`/`os:`/`ex:`/`fs:`/`mq:`/`lg:` tags. |
| Faults | Enumerated. Tests must exist for each. Code must handle each. |
| Polymorphism | Variants pinned by `[CSE]`. No silent additions. |
| DTOs | Shape fixed by `[DTO]` properties. Zod schemas must match. |
| Imports | Constrained by `layer-restrictions`, `module-isolation`, `import-aliases`. |

What's left to whoever fills the bodies (human, with or without an LLM assistant):

- Function bodies.
- Test bodies.
- Internal data structures within a single `mod.ts`.
- Edits that satisfy the rune and pass the linter.

Everything else is structurally locked. Whoever fills the bodies can't drift into the wrong folder, the wrong signature, or the wrong public surface — the linter catches it on the next `shape-checker .`.

---

## 13. A typical session

```
human                                                    tool
─────                                                    ────

1. writes specs/recording.rune in editor

2. $ shape-checker manifest specs/recording.rune
                                                         creates 21 stub files
   reviews the manifest output

3. opens the new files, fills in the TODO bodies
   (by hand, or with whatever editor/LLM assistant
    they use — outside the product)

4. $ shape-checker .
                                                         returns exit 1 with 2 violations
   reads the JSON, edits the cited files
   $ shape-checker .
                                                         returns exit 0
   commits

5. (later) edits the rune to add a fault
   $ shape-checker manifest specs/recording.rune
                                                         appends a Deno.test stub
   fills the new test + adds handler
   $ shape-checker .                                     returns exit 0
   commits
```

The human runs every CLI command. The CLI is the source of truth at every step. How the bodies get filled (hand-typed, dictated, generated, completed by an LLM in the editor) is the human's choice and doesn't change anything about the product.

---

## 14. Failure modes

| Condition | Exit | JSON |
|---|---|---|
| Rune syntax error | 2 | `{ "error": "parse_error", "rune": "...", "line": N, "message": "..." }` |
| Lint clean | 0 | `{ "violations": [], "passed": [...], "rune_contract": {...} }` |
| Lint violations | 1 | `{ "violations": [...], "passed": [...] }` |
| Prune dry-run with orphans | 1 | `{ "would_delete": [...] }` |
| Prune executed | 0 | `{ "deleted": [...] }` |
| File system error | 2 | `{ "error": "io", "path": "...", "message": "..." }` |
| Manifest with parse error | 2 | nothing written |
| Manifest happy path | 0 | `{ "created": [...], "appended": [...], "skipped": [...] }` |

`2` always means "tool couldn't run" — fix the input, don't retry. `1` always means "ran fine, found things to fix" — the human iterates.

---

## 15. Out of scope

- **LLM integration of any kind.** The product is a language, a code generator, and a linter. It doesn't call LLMs, embed LLMs, prompt LLMs, or know LLMs exist. Humans may use any LLM/IDE assistant they prefer to fill bodies; that's outside the product.
- **Editor integration / LSP from this product.** The Rust LSP from the rune project remains separately available; not part of this binary. Humans read/write `.rune` files as plain text in their normal editor.
- **Watch mode / daemon.** The human runs commands when they want them.
- **Code formatting.** `deno fmt` exists.
- **Spinners, banners, colored prose.** Plain text + JSON only.
- **Interactive wizards / `init`.** The human creates files directly.
- **Network calls in core subcommands.** All five subcommands run offline.
- **CI templates, git hooks, pre-commit.** Whatever wraps the project decides where.
- **Module resolution / per-module scoping.** Lint always runs on the whole project; all rune files are read together. No `--module` flag, no smart partial scans. The 500-foot view is the only view.
- **UI scaffolding (`template.html`, `styles.css`).** Out of scope.

---

## 16. v1 deliverables

1. TS rune parser (~400 lines, port of `rune/parser/src/lib.rs`).
2. `rune-bindings/` module (placeholder ↔ rune element map).
3. `assets/scaffold-templates/` directory mirroring canonical-paths layout.
4. Five subcommands: `manifest`, `lint` (default), `check`, `prune`, `explain`.
5. `--json` flag on every subcommand.
6. 10 new rune-derived rules in `rules/implementations/`.
7. Self-host: `specs/shape-checker.rune` reproduces this project's `src/` on `manifest`; `lint` passes.

---

## 17. TL;DR

Rune is a language for describing modules, a code generator that drafts the skeleton from that description, and a linter that verifies the code matches. One binary, five subcommands, stable JSON, stable exit codes. No LLM integration, no UI, no daemon, no network. Write the rune, manifest the skeleton, fill the bodies, shapecheck the result. Loop until clean.
