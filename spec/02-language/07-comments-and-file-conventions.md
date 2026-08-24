## Comments and file conventions

`// ...` inline or whole-line comments are stripped before validation. A `//`
opens a comment only at the start of a line or after whitespace; glued to a
non-space character it stays intact, so the `://` in a URL never starts one —
`@docs https://…` links, URLs in prose, and `example=https://…` modifier
values all survive the stripper. One module per file. A spec is authored and KEPT at
`spec/runes/<module>.rune` — the durable canonical home. `rune sync` READS the
spec there and generates code into `<pkg>/src/<module>/`
(`<git>/server/src/<module>/` in the composed monorepo); it NEVER relocates the
spec into `src/` — for `core`, the durable home is exactly
`spec/runes/core.rune` at the git root, resolved through its own ordered
candidate list rather than plain `<module>` substitution (see
[01-architecture.md § The canonical generated-project shape](../01-architecture/05-the-canonical-generated-project-shape.md)).
Legacy layouts still resolve for reading — as read
sources, never move targets: flat `spec/<module>.rune` / `specs/<module>.rune`,
plural `specs/runes/<module>.rune`, and in-tree `src/<module>/spec.rune`.
In-progress specs use
the `<module>.in-prog.rune` infix and may sit beside a finalized
`<module>.rune` in `spec/runes/` without conflict: every auto-discovery scan
(dev watch, run-all, ghost stubs, lint) skips a `*.in-prog.rune` file
outright, never parsing it into a module name, so only the finalized
`<module>.rune` is ever discovered automatically — `rune sync` reads a draft
only when pointed at its exact `.in-prog.rune` path. The build pipeline
finalizes a draft in place — dropping the `.in-prog` infix so the file
becomes `<module>.rune` — once it's ready (see
[02-rune-sync-semantics-that-matter.md](../03-cli/02-rune-sync-semantics-that-matter.md)
and [09-claude-skills.md § The .in-prog lifecycle](../09-claude-skills/01-the-eight-skills-in-pipeline-order.md)).

If the target `<module>.rune` already exists — the coexistence rule above
makes this reachable, since a draft can be finalized while a hand-authored
`<module>.rune` sits beside it — finalize refuses and exits with an error
naming both paths, rather than renaming over the existing finalized spec.
Silently overwriting a hand-authored spec is destructive and unrecoverable,
while a refusal only costs the author a manual merge/rename.
