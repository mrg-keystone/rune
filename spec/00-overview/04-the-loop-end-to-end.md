## The loop, end to end

```sh
rune init myapp && cd myapp            # composed ui/ + server/ monorepo, shared spec/
                                       # every command below runs at this monorepo root
# write spec/runes/<module>.rune       # the module's entrypoints, requirements (steps, boundaries), DTOs, faults
rune check spec/runes/<m>.rune         # spec diagnostics (same as the LSP), zero writes
rune sync  spec/runes/<m>.rune         # generate server/src/<m>/ — red by design
# fill the dev-owned bodies            # coordinator cores, adapters
deno check server/src/**/*.ts          # reconcile after any spec edit
rune lint .                            # lint against the architecture
rune dev                               # or run the whole loop live, cake auto-reloading
```

Then prove it: open `/docs/<module>` (the cake), walk the process on real
data, and pin expectations there — a browser-page check. In CI, replay the
same walk headlessly via `POST /docs/_run`: a real-data smoke that checks
each step for a 2xx, not the pinned expectations (see
[07-cake/00-overview.md](../07-cake/00-overview.md)).

