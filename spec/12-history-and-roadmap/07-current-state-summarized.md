## Current state, summarized

| Subsystem | Status | Owning section |
| --- | --- | --- |
| Engine | working; verify ladder green, but the gate is **manual** (`deno task verify`, run by hand — CI runs zero tests); the ungated engine unit suite (`deno test -A src/`) has 3 known failures | [04-codegen](../04-codegen/00-overview.md), [06-runtime](../06-runtime/00-overview.md) |
| Runtime | working; same manual gate | [06-runtime](../06-runtime/00-overview.md) |
| Language tooling | working; same manual gate | [08-language-tooling](../08-language-tooling/00-overview.md) |
| Skills | working; same manual gate | [09-claude-skills](../09-claude-skills/00-overview.md) |
| Releases | working; same manual gate | [11-release-and-distribution](../11-release-and-distribution/00-overview.md) |
| Governance / migrations / lint-config | **wired but dormant** — built and tested behind the artifact contract, no CLI entrypoint | [05-linter — Governance](../05-linter/03-governance-built-not-yet-wired.md) |

Full gating detail (what "manual" covers, the 3 failing tests, and the
refresh commands): [10-testing-and-verification — Known
state](../10-testing-and-verification/06-known-state.md).

- **Auth: out of scope.** Keep is **auth-agnostic** — the former infra trust
  model was removed; an app brings its own auth
  ([06-runtime — Overview](../06-runtime/00-overview.md)). The full inventory
  of what was removed belongs in a history entry, not this dashboard.
- **Known drift:** Rune Studio's registry path and docs after the
  `ln/` → `rune-studio/` relocation ([08-language-tooling.md](../08-language-tooling/00-overview.md)).
- **Open follow-ups:** parser dispatch roles, the nested-`[PLY]` gap, and the
  rest of the rebuild's scoped follow-ups (`rune-sig` templating, Studio
  island previews, the profiles UI) — tracked in [12/02 — The
  rebuild](02-the-rebuild-docs-rebuild-progress-md.md).
- **Strategic direction:** keep executing the diamond — [12/04 — The
  diamond](04-the-diamond-upgrades-md-the-strategic-direction.md).

> **As of:** the rebuild's completion (`docs/REBUILD-PROGRESS.md`, all seven
> work orders gated green) plus the diamond's start (2026-06-30). Nothing on
> this page is independently tracked — every status above is sourced from its
> linked owning section; refresh this snapshot by re-reading them.
