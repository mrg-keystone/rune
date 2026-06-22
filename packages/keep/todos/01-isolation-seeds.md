# Task 01 — `rune sync` generates isolation seeds in the per-surface e2e test

Repo: **rune** (`/Users/raphaelcastro/Documents/programming/rune`). Read `00-context.md` first.

## Goal

A module whose spec declares external inputs (`[TYP:ext]`) currently generates an e2e test that
fails in isolation — nothing supplies the `$name` values. Make the generated test seed them
automatically with typed placeholders, so `rune sync` + filled bodies = instantly green in
isolation, with zero hand-written glue. Modules without external inputs must regenerate
**byte-identically** (golden tests depend on it).

## Files

- `src/rune/domain/business/rune-manifest/mod.ts` — the codegen (all changes here)
- `src/rune/domain/business/rune-manifest/test.ts` — tests

## Steps

1. **Thread the data.** `renderEntrypointE2e(module, surface, runePath)` (~line 841) today gets
   only three strings. Its caller `addEntrypointSurface` already holds
   `process: Map<EntNode, EntProcess>` and `ents: EntNode[]`. Extend both signatures so the e2e
   renderer also receives the surface's `ents`, the `process` map, and a `typMap: Map<string, string>`
   (TYP name → typeName). Build `typMap` once in `planManifest` from `ast.typs`
   (`new Map(ast.typs.map((t) => [t.name, t.typeName]))` — note a `typMap` already exists there
   for DTO generation; reuse it) and pass it through `addEntrypointSurface`.

2. **Collect the `$` inputs.** In `renderEntrypointE2e`, walk every ent's `process.get(ent)!.bind`
   values. Values are `string | string[]`; normalize to arrays. Every value starting with `$`
   contributes the name after the `$`. Dedupe, sort for deterministic output.

3. **Emit seeds.** Map each name to a placeholder by its `[TYP]` type from `typMap`:
   `string → "<name>-stub"`, `number`/`integer` → `7`, `boolean → true`, anything else/unknown →
   `"<name>-stub"`. Change the generated `exerciseEndpoints({ api })` call to
   `exerciseEndpoints({ api, overrides: { seeds: { <name>: <placeholder>, ... } } })` — but ONLY
   when at least one `$` input exists. With none, the emitted text must be byte-identical to
   today's template.

4. **Tests** in `rune-manifest/test.ts`, following the existing `planManifest — …` test style
   (inline spec string → `planManifest("specs/x.rune", rune, new Set())` → assert on
   `plan.toCreate` file contents):
   - A spec with `[TYP:ext] memberId: string` and an ENT consuming an unproduced `memberId`
     field → the generated `entrypoints/http/e2e.test.ts` content includes
     `overrides: { seeds: { memberId: "memberId-stub" } }` (assert with `assertStringIncludes`).
   - Add a number-typed ext input in the same or a second spec and assert its numeric placeholder.
   - A spec with no ext inputs → the e2e content does NOT include the string `overrides:`.

5. Run `deno test -A src/rune/domain/business/rune-manifest/` — all tests green (the file had
   ~17 tests before this task; none may break).

## Verification (the whole task)

In the **keep** repo:

1. `rm e2e/checkout/src/checkout/entrypoints/http/e2e.test.ts` (it is create-once; deleting
   forces regeneration).
2. From the rune repo:
   `deno run -A src/bootstrap/mod.ts manifest /Users/raphaelcastro/Documents/programming/keep/e2e/checkout/src/checkout/checkout.rune`
3. Confirm the regenerated file seeds `memberId` (read it).
4. From keep: `RUNE_E2E=1 deno task test:e2e:checkout` — the generated test (previously ignored
   without `RUNE_E2E`) now RUNS and passes, because the seed satisfies the `$memberId` input.
   The rest of the checkout suite must stay green.

## Definition of done

- [ ] `deno test -A src/rune/domain/business/rune-manifest/` green, including 3+ new cases
- [ ] Generated e2e for ext-input specs contains typed `overrides.seeds`
- [ ] Generated e2e for no-ext specs byte-identical to the previous template
- [ ] keep's regenerated checkout e2e passes under `RUNE_E2E=1 deno task test:e2e:checkout`
- [ ] No `deno fmt` run in the rune repo; no commits made
