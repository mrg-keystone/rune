## Naming conventions

- Modules are kebab-case directories (`[MOD] my-feature` → `src/my-feature/`).
- Coordinators: `<noun>-<verb>/` (from `[REQ] noun.verb`), nested under its
  owning module's `domain/coordinators/` — the full path is
  `src/<module>/domain/coordinators/<noun>-<verb>/`, where `<module>` is the
  module whose `.rune` spec declares the `[REQ]` (see
  [05-the-canonical-generated-project-shape.md](05-the-canonical-generated-project-shape.md)
  and [04-codegen.md](../04-codegen/00-overview.md)).
- DTO files strip the `Dto` suffix and kebab-case; a `[TYP]` colliding with a
  DTO stem takes a `-type` suffix.
- Generated file banners mark ownership: DO-NOT-EDIT (spec-owned, regenerated)
  vs "Edit the body" (dev-owned, create-once). One further lifecycle exists —
  **ghost** (`bootstrap/stubs.ts` only): it is one file for the whole
  composed app (one `mint-<name>` per unique external-input name across the
  app, not per module), carries the DO-NOT-EDIT banner, and regenerates like
  a spec-owned file, but sync also deletes it once no `[TYP:ext]` input
  *anywhere in the composed app* remains Stubbed or Producer-present —
  whether because every stub-eligible input evaporated, or because every
  remaining input across the app is permanently unfulfilled (`Class`, DTO,
  generic, or union types, which never mint a stub) — see
  [04-codegen/03-ghost-stubs-the-typ-ext-lifecycle.md](../04-codegen/03-ghost-stubs-the-typ-ext-lifecycle.md)
  for the full lifecycle. The banner doubles as the delete-guard: a
  hand-written `stubs.ts` without it is neither overwritten nor deleted — it
  disables ghost stubs instead.
