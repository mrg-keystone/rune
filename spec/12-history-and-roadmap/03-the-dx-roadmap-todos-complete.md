## The DX roadmap (`todos/`) — complete

A seven-task, agent-dispatchable work plan (shared `00-context.md` + one task
file per worker; note its repo paths and `@^1` pins describe an older layout —
historical). All seven landed:

| Task | What it produced | Where it lives now |
| --- | --- | --- |
| (01) Generated isolation seeds in per-surface e2e tests | proof that an unseeded external input fails, isolating each surface's e2e run from the others | [Acceptance suites (`e2e/`)](../10-testing-and-verification/03-acceptance-suites-e2e.md) |
| (02) Contract auto-wiring + `stub` metadata | cross-module `$input` auto-wiring and the `stub` flag surfaced on generated endpoints | [The cake docs module](../07-cake/02-the-cake-docs-module.md) (auto-wiring, also shown in the [system map](../07-cake/03-the-system-map-docs-map.md)) and [Ghost stubs — the `[TYP:ext]` lifecycle](../04-codegen/03-ghost-stubs-the-typ-ext-lifecycle.md) (`stub` flag) |
| (03) Ghost-stub generation + evaporation | `bootstrap/stubs.ts`'s `mint-<name>` stub lifecycle (Unfulfilled → Stubbed → Producer-present → Evaporated) | [Ghost stubs — the `[TYP:ext]` lifecycle](../04-codegen/03-ghost-stubs-the-typ-ext-lifecycle.md) |
| (04) The lifecycle acceptance fixture | the composed-app fixture proving a real producer auto-satisfies an external input with zero seeds | [Acceptance suites (`e2e/`)](../10-testing-and-verification/03-acceptance-suites-e2e.md) |
| (05) `rune dev` | the unattended spec→cake live loop | [`rune dev` — the live loop](../03-cli/03-rune-dev-the-live-loop.md) |
| (06) The system map at `/docs/_map` | the live, whole-composed-app process graph | [The system map (`/docs/_map`)](../07-cake/03-the-system-map-docs-map.md) |
| (07) The docs/skill/release sweep | doc, skill, and release-tooling housekeeping | no single downstream section — cross-cutting; see [Claude Skills](../09-claude-skills/00-overview.md) and [Release & Distribution](../11-release-and-distribution/00-overview.md) |

Its release-order rule persists — see [Release &
Distribution](../11-release-and-distribution/00-overview.md) for the live
rule (**keep first, then rune**) and why. The `docs/phase2-*.md` files are
the earlier planning docs for generating real keep controllers from
`[ENT]`s and the [cake
acceptance](../07-cake/04-the-headless-runner-exerciseendpoints-opts.md) —
both realized (the [e2e
suites](../10-testing-and-verification/03-acceptance-suites-e2e.md) are
their living descendants).

