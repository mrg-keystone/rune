## Parked proposals (`maybe/`)

Where [Architecture Decision Records](01-architecture-decision-records-docs-adr.md)
hold what's **decided** and [the diamond](04-the-diamond-upgrades-md-the-strategic-direction.md)
holds what's **in flight** and [the DX roadmap](03-the-dx-roadmap-todos-complete.md)
holds what's **done**, `maybe/` holds proposals considered and set aside — it's
the source of truth this table summarizes; read a proposal's own file in full
before reviving it.

| Field | |
| --- | --- |
| Proposal | [`single-owner-runtime-and-hmr.md`](../../maybe/single-owner-runtime-and-hmr.md) |
| Draft date | 2026-07-02 |
| Why parked for rune | After two prod-only sprig incidents (a dual-runtime bundle killing island hydration), the proposal makes the sprig CLI the single owner of the runtime and the emitted bundle the single source of truth for dev and prod, plus HMR without dev/prod skew — a sprig-side redesign. Its conclusion for rune is **"rune changes nothing"**: keep is re-`bootstrapServer`'d in-process behind a mutable handler and needs no HMR, per rune's own runtime model — see [06-runtime.md § `bootstrapServer(appName, module, options?)`](../06-runtime/01-bootstrapserver-appname-module-options.md), whose returned `handler` is exactly the dispatcher the proposal repoints on each in-process rebuild. |
| Revisit if | keep ever emits a standalone bundle (rather than being invoked via `bootstrapServer` in-process) or gains a dev/prod runtime split — either would break the "re-bootstrap behind a mutable handler, no HMR" premise this parking rests on. |
| Full doc | [`maybe/single-owner-runtime-and-hmr.md`](../../maybe/single-owner-runtime-and-hmr.md) |

