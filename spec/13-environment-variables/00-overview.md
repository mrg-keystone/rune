# Environment Variables — the complete reference

> Part of the [project spec series](../README.md). The single authoritative list of
> every environment variable the backend framework (keep) and the rune toolchain
> read.

A variable is "truthy" when set to a non-empty value unless a specific form is
noted (e.g. `=1`, `=off`).

## Legend

The **Default** and **Read at** columns in 02-keep-runtime-serving-behavior.md,
03-rune-cli-engine.md, and 04-install-release-versioning.md use this fixed
vocabulary; 05-test-only.md's Read-at column follows the same grep-target
meaning too, though its Default column does not (see below):

| Term | Meaning |
| --- | --- |
| `—` | No default — the var is unset until something explicitly sets it, and the feature it gates is inactive. Distinct from `off`: `off` is an active default the code branches on; `—` means the check is never triggered because there's nothing to compare. |
| `off` / `on` | The active default the code falls back to when the var is unset. |
| `resolved` | The default isn't a literal — it's computed by a rule, spelled out inline in the **Purpose** cell. |
| **Read at** | The file(s) where the var is actually read — a grep target, not a claim about when in the program's lifecycle the read happens. |

01-substrate-variables-moved-to-bedrock.md is a redirect index with no Default
or Read-at column at all. 05-test-only.md has no Default column — its "Unset
(default)" column is prose, not this legend's Default terms — but its own
Read-at column uses this same vocabulary.

## The five categories

| Category | What lives here | Who reads it |
| --- | --- | --- |
| [Substrate — moved to bedrock](01-substrate-variables-moved-to-bedrock.md) | Layer-neutral vars — observability, `PORT`, the removed auth vars (keep is **auth-agnostic**, [06-runtime.md](../06-runtime/00-overview.md)) — that belong to bedrock's own reference, not this one. | Operator deploying keep, via bedrock's reference. |
| [keep runtime — serving & behavior](02-keep-runtime-serving-behavior.md) | Docs/cake exposure, the dev-loop channel, the fixtures dir, the `#assert` runtime, prod ghost-stub exclusion, the heal service. | Operator deploying keep. |
| [rune CLI & engine](03-rune-cli-engine.md) | Lint strictness, e2e gating, rune's state dir, helper-binary resolution, LSP/LLM toggles. | Toolchain user (developer running `rune`). |
| [Install, release & versioning](04-install-release-versioning.md) | Install prefix/ref/version pins for `install.sh` and `rune update`, build-time version stamping, the Rust CLI's install paths. | Installer / release CI. |
| [Test-only](05-test-only.md) | Suite gating (browser, Playwright, CI-only skips) — not product configuration. | Contributor running the test suites. |

---

## Verifying completeness

This document is complete when every env-var read in the source has a matching
row in one of the five tables. Reproduce that check with:

```sh
# keep, rune's TS/JS layer, and top-level scripts
grep -rn 'Deno\.env' keep/src src scripts
# rune's Rust CLI/engine
grep -rn 'std::env' lang/cli
# remaining test-suite dirs, not under keep/src, src, scripts, or lang/cli — a 0-hit on
# keep/emulator-ui is expected: those browser units run unconditionally and read no env
# var at all (05-test-only.md), not that they read something test-only
grep -rn 'Deno\.env' keep/emulator-ui e2e exercise-harness/smk.test.ts llm/smk.test.ts lsp/smk.test.ts
# install/release vars read by the shell installer — grep the RUNE_ prefix, not just the
# three named vars below, so a newly-added installer var still surfaces; RUNE_INSTALL is
# also read by a TS source (update/mod.ts), which the Deno.env grep above already catches
grep -n 'RUNE_[A-Z_]*' install.sh uninstall.sh
```

Every variable named at a hit must appear in one of the five tables linked
above (or, for the substrate vars, in bedrock's own reference — see the first
row of the map). A hit with no matching row is drift: either this document is
stale or the code (or a test file, or an install script) added a var it
hasn't caught up to yet.

---

## Keeping this current

This table is the kind of derived fact that should be **generated from the
code's env reads and drift-gated** (see the config-plane ideal in
[12-history-and-roadmap.md](../12-history-and-roadmap/00-overview.md)); until then it is
kept by hand against the source paths cited in each section and verified with
the grep recipe above.

---

