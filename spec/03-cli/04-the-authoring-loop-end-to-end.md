## The authoring loop (end to end)

```sh
# 1. write a spec at spec/runes/<module>.rune (or draft as <module>.in-prog.rune)
rune check spec/runes/tasks.rune       # validate as you go (same errors as the LSP)

# 2. generate / reconcile — drafted a .in-prog.rune in step 1? point sync at
# that path instead (spec/runes/tasks.in-prog.rune); it finalizes in place,
# dropping the .in-prog infix and leaving spec/runes/tasks.rune beside it
# (see [rune sync — semantics that matter](../03-cli/02-rune-sync-semantics-that-matter.md),
# step 5) — every command below, and step 1 on the next pass through this
# loop, then operates on that finalized tasks.rune
rune sync spec/runes/tasks.rune        # scaffold into server/src/tasks/, red by design

# 3. fill the developer-owned bodies (coordinator cores, adapters); contracts (mod-root.ts) are generated
deno check server/src/**/*.ts          # shows exactly what to reconcile after a spec edit

# 4. lint against the architecture
rune lint                              # lints server/ from the git root; "All clear — no violations found." = exit 0

# or automate steps 1-3 continuously — the spec stays put in the shared git-root
# spec/runes/, which `rune dev` watches as an active spec target: an edit to a
# finalized <module>.rune there auto-fires a check → sync → restart cycle (see
# [rune dev — the live loop](../03-cli/03-rune-dev-the-live-loop.md)), no
# manual `rune sync` needed. Editing a `.in-prog.rune` draft does NOT fire
# this cycle — drafts are excluded from every auto-discovery scan, so only
# the finalized spec is watched. `rune dev` also watches the generated source
# under server/src/ and restarts on save. Step 4 (`rune lint`) is not part of
# this cycle — run it separately (by hand or in CI) to gate architecture
# violations.
rune dev
```
