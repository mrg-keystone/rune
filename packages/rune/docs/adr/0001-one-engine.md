# ADR 0001 — One engine (D1)

Status: **Accepted** · Closes the decision behind G7

## Context

Generation/lint logic is implemented multiple times with no shared code: a Rust
binary (`rune/cli/src/commands/generate.rs` + `cli/src/configs/.../*.rs`), the
shape-checker TS engine (`src/shape-checker/**`), and the Studio's in-browser
`lib/*` previews. The three codegen paths emit **different layouts** and cannot
agree. The Rust codegen is Rust source — it can never be "edited in a UI," so
every artifact change would have to be mirrored into Rust by hand. `design.md`
already directs: "Drop the Rust parser from the runtime path. Keep the Rust LSP
available for editor squiggles only — not part of this product."

## Decision

**shape-checker (TS) is the sole artifact-driven engine.** All
generation/lint/parse logic lives there and is driven by the artifact. The Rust
binary is **retired from the generation path** and kept LSP/editor-only. The
`lib/runegen.ts` "compare against the real CLI" affordance is removed (it diffs
an incompatible layout). There is exactly **one** copy of each concern.

## Consequences

- WO-4 makes shape-checker a pure interpreter; WO-5 deletes the Studio's
  `lib/*` reimplementations in favour of thin wrappers over it.
- The Rust generation path is deleted once its replacement's gate (L3) is green.
- tree-sitter stays editor-only (see ADR 0003); its build is out-of-band (WO-6).
- No second "authoritative" engine may be reintroduced; the Drift and L5 gates
  guard against divergence.
</content>
