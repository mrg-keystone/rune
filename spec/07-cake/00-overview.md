# The Cake, the System Map, and the Headless Runner

> Part of the [project spec series](../README.md). Source:
> `keep/src/foundation/domain/business/{emulator-ui,map-ui,trace-ui,
> fixtures-store,heal,endpoint-spec,process-graph}/` and
> `keep/src/foundation/domain/coordinators/exercise-harness/`. These are the
> self-verification surfaces built on the `x-keep-process` metadata
> ([06-runtime.md](../06-runtime/00-overview.md)), shipped as the addable **`DocsModule`**
> (below).

With the docs module added, every module gets three docs pages:

| Path | What |
| --- | --- |
| `/docs/<module>` | the **cake** — a Postman-style guided walk of the module's process |
| `/docs/<module>/swagger` | standard Swagger UI |
| `/docs/<module>/json` | the raw OpenAPI spec |

**Every `/docs/*` route is open** — no auth, no bearer, no gate. keep is
auth-agnostic (the runtime enforces nothing; [06-runtime.md](../06-runtime/00-overview.md)),
and the docs surface is no exception: a browser can always load any page, and
every `/docs/_*` data door answers any caller:

| Door | What it backs | Method(s) | Browser vs headless |
| --- | --- | --- | --- |
| `_run` | the headless runner walk — `exerciseEndpoints`/CI, and the map's **Run all** ([→03](03-the-system-map-docs-map.md), [→04](04-the-headless-runner-exerciseendpoints-opts.md)) | `POST` | both — the map's Run all (browser) and curl/CI (headless) hit the same door |
| `_fixtures` | the fixtures artifact `spec/misc/cake.json` — on-load baseline and **Save fixtures** ([→02](02-the-cake-docs-module.md)) | `GET`, `POST` | browser only — the cake reads/writes it; neither headless path (`exerciseEndpoints` nor `POST /docs/_run`) reads `cake.json` |
| `_scenarios` | saved walk recordings under `spec/misc/scenarios/` ([→02](02-the-cake-docs-module.md)) | `GET`, `POST` | both — the Scenarios card (browser) lists/loads/saves; `POST /docs/_run {"scenario": ...}` replays one by reading the file server-side |
| `_heal` | Tier-3 "Ask Claude" diagnosis ([→02](02-the-cake-docs-module.md)) | `POST` | browser only — fired from the heal panel |
| `_heal-rules` | Tier-2 declarative rules, `spec/misc/heal-rules.json` ([→02](02-the-cake-docs-module.md)) | `GET` | browser fetches it once at page load; the headless runner derives its retry slugs from the same file read directly, not through this door |
| `_traces` | the `/docs/_trace` waterfall's data ([→05](05-dev-mode-and-tracing-pages.md)) | `GET`, `POST` (`clear`) | browser only — polled by the `_trace` page |
| `_dev` | dev-mode status + `bootId` for the injected poller ([→05](05-dev-mode-and-tracing-pages.md)) | `GET` | browser only — polled when `KEEP_DEV` is set |

The cake and map render from data **inlined into the shell server-side** —
the cake as `window.__KEEP_EMULATOR__`, the map as `window.__KEEP_MAP__`
(exact shapes owned by [→02](02-the-cake-docs-module.md) and
[→03](03-the-system-map-docs-map.md) respectively) — neither page fetches
anything to render. Everything else the pages need, they fetch straight off
the open doors: the cake fires live endpoint calls
(steps and setup steps), generates paste-ready curl, and links the raw
OpenAPI JSON; the Swagger page fetches its spec — all uncredentialed, because
nothing on the surface asks for a credential. The runner's `api` option
carries the same in-process `backend.fetch` client `bootstrapServer` returns
as the headless path to the same walk.

### Golden path: browser walk to CI replay

1. Add `DocsModule` to the app's module imports and set `KEEP_DOCS=1`
   ([→01](01-the-docs-module-docsmodule.md)) — `/docs/orders` and its
   siblings come alive.
2. Open `/docs/orders`, walk its steps in dependency order, and pin an
   Expect block on the ones that must hold (`status == 200`, `body.id
   exists`). Click **Save fixtures**: the pinned expectations, any setup
   steps, and the shared variables land in the committed
   `spec/misc/cake.json` ([→02](02-the-cake-docs-module.md)).
3. In CI, replay the same walk headlessly — in-process with
   `exerciseEndpoints({ api })`, or over HTTP with
   `POST /docs/_run` ([→04](04-the-headless-runner-exerciseendpoints-opts.md)).
   Both drive the identical `x-keep-process` graph through the same
   bind/order machinery the browser walk used — but the two aren't
   guaranteed to pick the same producer for a `$`-input: the cake's `auto:`
   index applies no downstream exclusion while the runner adds one, so in
   the transitive-cycle case they order producers differently
   ([→02](02-the-cake-docs-module.md#cross-module-auto-wiring),
   [→04](04-the-headless-runner-exerciseendpoints-opts.md#-input-resolution--producer-discovery)).
   The bigger gap: neither headless path reads `cake.json`
   (see the `_fixtures` row above), so none of it applies — step 2's setup
   steps don't run, its persisted variables don't seed, and its pinned
   Expect checks don't evaluate. Step 3 only re-fires the endpoints the
   walk itself declares, checking each for a bare 2xx; any request whose
   body or reachability depended on setup-seeded state isn't reproduced
   the same way headlessly ([→02](02-the-cake-docs-module.md),
   [→04](04-the-headless-runner-exerciseendpoints-opts.md)).

**The current invariant:** the `/docs/*` surface is fully open end to end —
the cake and map pages render from data inlined server-side, and everything
else they need (the fixtures baseline and **Save fixtures**, the
**Scenarios** card, heal tiers 2–3, the map's **Run all** and its live
write-back into cake sessions, the `/docs/_trace` page's data) they fetch off
the open doors above, uncredentialed, with nothing to gate the fetch. Test
evidence for this surface lives with the suites that own it
([10-testing-and-verification.md](../10-testing-and-verification/00-overview.md)).

The section's content lives in its sibling files, one page or door per file:

- [The docs module (`DocsModule`)](01-the-docs-module-docsmodule.md) — the
  addable module and its `KEEP_DOCS` gate; read this to wire the surface into
  an app.
- [The cake (`/docs/<module>`)](02-the-cake-docs-module.md) — the
  guided-walk page: steps, expectations, fixtures, and scenarios; read this
  to author or debug a module's endpoints.
- [The system map (`/docs/_map`)](03-the-system-map-docs-map.md) — the
  whole composed app as one graph, with its own **Run all**; read this to
  trace cross-module dependencies.
- [The headless runner — `exerciseEndpoints(opts)`](04-the-headless-runner-exerciseendpoints-opts.md)
  — the same walk run programmatically or from CI; read this to write
  contract tests or drive `/docs/_run` directly.
- [Dev mode and tracing pages](05-dev-mode-and-tracing-pages.md) — the
  `KEEP_DEV` poller and the `/docs/_trace` waterfall; read this to wire
  `rune dev` or debug a live request.

