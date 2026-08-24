## The docs surface — an addable module

**Part 3 — docs/cake.** `bootstrapServer` still builds the per-module OpenAPI
documents (the `docs` return, gated by the `swagger` option — see
[06-runtime/01](01-bootstrapserver-appname-module-options.md)); the addable
`DocsModule` only renders and serves pages **from** that `docs` return — it
builds nothing itself. A module excluded from the OpenAPI build (`swagger:
false`, or named in a `{ filters: string[] }` exclusion) contributes no
`docs` entry, and so gets no cake, no system-map node, and no Swagger page:
there is nothing for `DocsModule` to render. Toggling `swagger` or `filters`
therefore silently blanks pages — the module's routes keep serving, but its
docs surface vanishes with no error.

The interactive `/docs/*` surface itself — the per-module cake pages, the
system map, the `/docs/_trace` viewer, and the headless runner
(`POST /docs/_run`) — is **no longer hardwired into `bootstrapServer`**. It is
an **addable `DocsModule`** you register on the Danet app alongside your own
modules, **gated behind `KEEP_DOCS`, off by default**.

The gate is **AND**: `DocsModule` registered **and** `KEEP_DOCS` truthy.
Registering the module alone (e.g. left in for local-dev convenience) does
not expose the surface — `KEEP_DOCS` must also be set, and since
`bootstrapServer` auto-registers `DocsModule`, a bare `KEEP_DOCS=1` alone
suffices to expose it there too. This keeps the interactive cake/runner off
unless a deploy deliberately does both, so it never reaches production
unless explicitly opted in.
[06-runtime/06-composition-serving.md](06-composition-serving.md) and
[13-environment-variables/02-keep-runtime-serving-behavior.md](../13-environment-variables/02-keep-runtime-serving-behavior.md)
state this same AND gate.

Add the module **and** set `KEEP_DOCS` truthy to expose it.

`/docs/*` is the backend's own route space — paths are given relative to the
backend mount throughout this doc:

| Mount context | Docs prefix | Representative door |
| --- | --- | --- |
| raw `bootstrapServer` handler (unprefixed) | `/docs/*` | `/docs/_trace` |
| through `Backend`'s `/api/` mount | `/api/docs/*` | `/api/docs/_trace`, `POST /api/docs/_run` |

An app that layers auth over keep must gate or exempt `/docs/*` deliberately
— the surface's open doors are enumerated in
[07-cake.md](../07-cake/00-overview.md).

Full detail — the pages, the system map, expectations, and scenarios — is in
[07-cake.md](../07-cake/00-overview.md).

