# Branch: `phase2-test` — keep building blocks for the rune → keep workflow

Companion to `mrg-keystone/rune` branch `phase2-keep-integration` (the codegen that emits the
controllers these blocks serve). This branch is the **keep** half: the runtime building blocks plus
a committed end-to-end acceptance.

## Scope

**New building blocks** (`src/foundation/domain/`):
- `business/endpoint-decorator/` — `@Endpoint` / `@EndpointController` / `endpointModule`. `@Endpoint`
  composes danet's route + body decorators with `@danet/swagger`'s schema decorators (`BodyType` /
  `ReturnedType` / `ApiProperty`) and stamps **process metadata** — `order`, `dependsOn`, and a
  `bind` map (`{ thisInputField: "otherEndpointId.outputField" }`).
- `business/document-builder/` — attaches that metadata to each OpenAPI operation as the
  **`x-keep-process`** vendor extension, so the UI and the runner read one source of truth.
- `business/emulator-ui/` — the per-module **process emulator** served at `/docs/<module>`: an
  ordered checklist with per-endpoint "Emulate" buttons, progressive unlock, output→input autofill,
  and checkmarks, plus "Run all in order". Standard Swagger UI moves to `/docs/<module>/swagger`;
  the raw spec stays at `/docs/<module>/json`.
- `business/endpoint-spec/`, `business/process-graph/`, `business/rate-limiter/` — spec extraction,
  explicit-dependency topological ordering (+ cycle detection), and a token-bucket limiter.
- `coordinators/exercise-harness/` — `exerciseEndpoints(...)`: discovers endpoints from the built
  docs, orders them, chains outputs into inputs via `bind`, rate-limits, and loops to green.
  In-process `backend.fetch` by default; Playwright `APIRequestContext` when given a `baseUrl`.
- `bootstrapServer` now returns the built `docs` (`SwaggerDocEntry[]`); new exports + types are wired
  through `mod-root.ts` and `bootstrap/mod.ts`; README documents the surface.

**Committed acceptance** (`e2e/cake/`): the rune-generated "cake" module (six chained endpoints,
coordinator bodies filled to chain deterministically) with its own `deno.json` (resolves keep
locally; `reflect-metadata` pinned to 0.1.13 so one polyfill backs the program). `cake.e2e.test.ts`
asserts the spec shape + `x-keep-process` chain, drives the chain green in-process via
`exerciseEndpoints`, and — gated on `KEEP_BROWSER=1` — walks all six steps in headless chromium
(each step: unlocked, next still locked, body autofilled from the prior capture, checkmark on run).

**Regression guard:** `business/emulator-ui/browser.test.ts` (gated `KEEP_BROWSER=1`) drives the
emulator UI in chromium independently of the cake fixture.

## How to test / verify

```sh
deno task test          # full unit/integration suite — 199 passed, 2 ignored (gated browser/smoke)
deno task test:e2e      # cake acceptance, in-process (no browser) — 14 passed, 2 ignored
deno task cake          # provisions chromium (idempotent) then runs the 6-step emulator drive HEADED
KEEP_BROWSER=1 deno task test:e2e   # cake acceptance incl. the headless browser stage
deno task test:browser  # emulator browser regression (KEEP_BROWSER=1)
deno task test:smoke    # exercise-harness Playwright HTTP smoke (KEEP_PLAYWRIGHT_SMOKE=1)
```

Manual: `deno run -A --config e2e/cake/deno.json e2e/cake/server.ts` → open `http://localhost:8722/docs/cake`.

## Notes

- **Playwright is an optional peer** (`#playwright` → `npm:playwright`). The default `deno task test`
  is browser-free; only the gated stages need a provisioned browser
  (`deno run -A npm:playwright install chromium chromium-headless-shell`, which `deno task cake` does
  for you). `node_modules/` and `e2e/cake/deno.lock` are gitignored.
- The default suite **excludes `e2e/cake/`** (it has its own import map / config); that fixture is run
  via `deno task test:e2e`.
- Risk that the acceptance specifically guards: a `reflect-metadata` version mismatch between a
  generated project and keep could blank out the decorator metadata — the cake run proves
  `x-keep-process` + DTO schemas survive end to end.
