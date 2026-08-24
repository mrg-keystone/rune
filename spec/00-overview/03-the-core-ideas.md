## The core ideas

1. **One source of truth per fact.** The language definition lives in
   `lang/keywords.json`; the grammar, editor highlights, and canonical-shape
   docs are all *derived* from it and drift-gated in CI. Codegen templates
   are the one flow that runs the other way — authored engine-side and
   mirrored into the artifact — and the artifact JSON schema
   (`lang/artifact.schema.json`) is derived from the engine's Zod schema, not
   from `keywords.json`, and is regenerable but not drift-gated
   ([08-language-tooling.md](../08-language-tooling/00-overview.md),
   [lang/keywords.json — the artifact](../08-language-tooling/01-lang-keywords-json-the-artifact.md),
   [10-testing-and-verification.md](../10-testing-and-verification/00-overview.md)).
2. **Spec-owned vs dev-owned.** `rune sync` regenerates contracts
   (`mod-root.ts`, module registry) on every run and creates method bodies,
   tests, and adapters exactly once — dev-owned files are never clobbered
   ([04-codegen.md](../04-codegen/00-overview.md)).
3. **Red by design.** Generated cores throw `not implemented`; every declared
   fault implies a test; the sync run ends with a run-all gate so a build
   session can't fail to notice the app doesn't run.
4. **Validated seams.** Generated coordinators assert input, adapter
   reads/writes, and output via the `#assert` runtime; a failed contract maps
   to HTTP 422 with dotted failure paths ([06-runtime.md](../06-runtime/00-overview.md)).
5. **The process is data.** Endpoint order, dependencies, and request autofill
   (`order`/`dependsOn`/`bind`) are derived from the spec's DTO field graph and
   ride into OpenAPI as the `x-keep-process` extension — which powers the cake,
   the system map, and the headless runner ([07-cake.md](../07-cake/00-overview.md)).
6. **Auth-agnostic runtime.** Keep does logging, docs, `#assert`, DI, and
   process metadata; it neither provides nor assumes authentication — you bring
   your own. Every surface is open by default, keep out of the way
   ([06-runtime.md](../06-runtime/00-overview.md)).
7. **The diamond.** Rune is the backend track of a two-track pipeline (the
   frontend track is **sprig**, a sibling project). Both descend from one
   product intent and converge on one contract at the waist — queries +
   commands, never an editable record — then merge into a single composed app
   via `Deno.serve(Backend(Frontend))`
   ([12-history-and-roadmap.md](../12-history-and-roadmap/00-overview.md)).

