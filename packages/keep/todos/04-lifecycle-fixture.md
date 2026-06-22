# Task 04 — Lifecycle acceptance fixture (committed CI proof)

Repo: **keep** (`/Users/raphaelcastro/Documents/programming/keep`). Read `00-context.md` first.
**Prerequisite: task 02 complete** (auto-wiring + synthetic ordering must exist locally).

## Goal

Commit the proof of the contract lifecycle into keep's e2e suite: the checkout module (which
declares the external input `$memberId` via its spec's `[TYP:ext]`) runs green in isolation with
seeds, and runs green **with no seeds at all** when composed with a members module that produces
`memberId` — the contract snaps together by field name. This protects tasks 02/03's behavior
against regressions forever.

## Files

- `e2e/checkout/src/members/` (new module — hand-written, mirroring rune codegen output style)
- `e2e/checkout/checkout.e2e.test.ts` (new stages)
- Optionally `e2e/checkout/server.ts` (compose both modules so the live demo server shows the
  snap too)

## Steps

1. **Members module.** Create `e2e/checkout/src/members/entrypoints/http/mod.ts` following the
   existing checkout entrypoint's conventions (header comment, imports, decorator style):
   - DTO classes (in `e2e/checkout/src/members/dto/`, class-validator style like checkout's):
     `JoinDto { alias: string }`, `MemberDto { memberId: string }`.
   - `@EndpointController("members")` with one handler:
     `@Endpoint({ path: "create", input: JoinDto, output: MemberDto, order: 1 })`
     `create(body)` → `{ memberId: "member-" + (body.alias || "anon") }` — deterministic.
   - `export const membersModule = endpointModule("Members", [MembersController]);`
   - IMPORTANT: handler/method names must not collide with checkout's (`create` is fine —
     checkout has no `create` — but verify with grep).
2. **Compose in server.ts**: `bootstrapServer("checkout", [membersModule, httpModule], { port: 8723 })`
   so the standing demo app shows both modules and the auto-wire affordance.
3. **New test stages** in `checkout.e2e.test.ts` (follow the existing stage style/port counter):
   - *Stage: composed snap (headless)* — `bootstrapServer("checkout", [membersModule, httpModule])`,
     `exerciseEndpoints({ api, flow: "card" })` with **no overrides**: assert `failed` empty,
     and `report.order.indexOf("create") < report.order.indexOf("start")` (synthetic edge
     ordered the producer first).
   - *Stage: isolation still works* — the existing seeded stages already cover this; just
     confirm they still pass unchanged.
   - *Stage: browser auto affordance* (gated `KEEP_BROWSER=1`, follow the existing browser
     stage) — composed app; open `/docs/checkout`: the Module-inputs row for `memberId` shows
     the `auto:` affordance text (task 02's rendering; assert on `#inputs` textContent
     containing `auto`); open `/docs/members`, run `create`; back on `/docs/checkout` assert
     `start`'s `.resolved` preview contains `member-` after the capture propagates, then run-all
     the card flow green without typing anything.
4. Keep the existing isolated stages untouched — both compositions must coexist in one test file
   (different `port++` values per stage, as the file already does).

## Verification (the whole task)

```
KEEP_BROWSER=1 deno task test:e2e     # cake + checkout, including the new stages, all green
deno task test                        # unit suite unaffected
```

## Definition of done

- [ ] Members module exists in fixture style; server.ts composes both modules
- [ ] Composed headless stage green with zero seeds; producer ordered before consumer
- [ ] Browser stage proves the `auto:` affordance and a no-typing green walk
- [ ] Pre-existing isolated/seeded stages unchanged and green
- [ ] `KEEP_BROWSER=1 deno task test:e2e` fully green; no commits
