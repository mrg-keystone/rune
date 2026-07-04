# Proposal: single-owner runtime, bundle-as-truth, and HMR without dev/prod skew

**Status:** Draft (maybe/) · **Date:** 2026-07-02

This proposal is primarily about the **sprig** build/runtime model. It lives in the rune
repo because the last question it answers is "what does rune have to change?" — and the
answer is **nothing**. It's captured here so that decision is on the record.

---

## 1. Motivation — two prod incidents, one shape

Both were defects that were **invisible in dev and live in prod**:

1. A `/auth` route present in dev 404'd in prod, because `sprig dev` didn't serve the real
   prod composition (`serveSprig`). Dev and prod ran different servers. *(Fixed.)*

2. **2026-07-02:** a hotfix bumped `@sprig/core` 0.14.0 → 0.15.0. Prod then served a
   **dual-core bundle** — two copies of the sprig runtime in one document — so *every* island
   failed to hydrate with `inject() must be called synchronously…` and the entire UI's
   interactivity was dead. **Local dev was fine.**

   Evidence: prod loaded `chunk-VXD366IM.js` (via `client.js`) **and** `chunk-OR2645XP.js`
   (via the island chunks) — two runtime copies. The committed/local build loaded one shared
   `chunk-TIISMP5E.js`. The bundle prod served existed in **no commit**; it was built at
   deploy time with a version drift.

Same class both times: **dev and prod are allowed to differ, and the difference only
surfaces after ship.** This proposal removes the permission to differ.

---

## 2. Root cause — the real flaw

`@sprig/core` is a **stateful singleton**. Correctness depends on there being exactly one
instance of `core.ts` in the page: the DI ambient context (`let current`), the token symbol
registry, the `__sprig_runtime` flag, the class-identity `WeakMap`s. "One runtime" is a hard
invariant, not an optimization — `client.js` sets `current` right before an island's
`setup()`, and the island's `inject()` reads it back; that handoff only works if writer and
reader are the same module instance.

But the runtime is a **bundled dependency wired in through two uncoordinated paths**:

1. The CLI *generates* `client.js` + `isl.*.ts` and points their imports at **its own** copy
   of the runtime (`new URL("./hydrate.ts", import.meta.url)` → the CLI's `core.ts`).
2. The app's island `logic.ts` imports `@sprig/core` through the **app's import map**.

Nothing forces those two to resolve to the same file. When the CLI version ≠ the app's pin,
esbuild sees two different `core.ts` source files, cannot dedup them, and emits **two** runtime
chunks. Two `core.ts` instances ⇒ two `current` variables ⇒ `inject()` finds an empty context
⇒ dead islands.

Three decisions compound it:

- **Ambient module-global DI state** makes duplication *fatal*, not merely wasteful.
- **The runtime is duplicable** (bundled) rather than a single externalized instance, so the
  packager is free to make two copies.
- **The invariant is enforced out-of-band** — a pre-flight bolted onto `infra ship`. Build any
  other way (a hotfix rebuild, a plain `deno deploy`, a teammate with a stale global CLI) and
  there is no check. The violation is silent at build and at `deno check`; it only appears at
  runtime, far from the cause.

`core.ts` even ships a `detectDualRuntime()` + a one-shot self-healing reload — the design
already *expects* this to happen and tries to recover. The deeper fix is to make a second copy
**impossible**, not to detect it after it has broken the page.

---

## 3. Proposal

**Make the CLI the single owner of the sprig runtime, and make the emitted bundle the single
source of truth that both dev and prod consume — identically.**

### 3.1 One owner of the runtime

- All sprig runtime libraries live **inside the CLI**: `@preact/signals-core`, the template
  compiler, the hydrate / DI / SSR runtime. The CLI ships as a single `deno bundle` published
  to JSR and carries preact internally. `@preact/signals-core` was never really an app
  dependency — it's an impl detail of `signal()` that leaked into every app's `deno.json`.
- `@sprig/core` on JSR becomes a **thin interface**: types + specifiers only, existing so app
  code type-checks and so the bundle emits the right imports. It carries **no second copy** of
  the implementation.
- The app declares **no runtime version**. It authors against the `@sprig/core` *interface*;
  the CLI supplies the one *implementation*, resolved through a **CLI-controlled import map** at
  check / build / serve time.

**Result:** exactly one `core.ts` (the CLI's), driving both the client bundle and SSR. No app
pin ⇒ nothing to drift against ⇒ **dual-core is structurally unrepresentable.** The
"CLI pin == app pin" rule disappears because there is only one pin: the CLI's.

### 3.2 The bundle is the single source of truth

- `build --rune` emits the bundle: client chunks + `app.css` + serialized template ASTs +
  the server composition.
- `serve --rune` **only consumes the bundle.** In dev the bundle is emitted (a hidden build
  artifact) and served — you must bundle before you see anything.
- Dev and prod run the **same artifact, byte-for-byte, including minification.** There is no
  `--dev` variant of the *output*.

This deliberately rejects the Vite model (dev serves unbundled native ESM, prod bundles — two
code paths, the skew factory). Making dev and prod run the *same* artifact is the point.

---

## 4. Why "identical" and "HMR" don't conflict

The bundle is **content-addressed chunks**. HMR re-emits *only the chunk that changed*, and
that chunk is byte-identical to what a full prod build produces (same deterministic minified
output). So dev serves the real prod artifacts, kept fresh incrementally. "Incremental" is not
"different."

Two disciplines make *identical* actually true:

- **HMR is a layer around an unmodified prod runtime — not a dev fork of it.** The prod runtime
  ships a tiny **dormant update-receiver**: in prod nothing connects to it (a few dead bytes);
  in dev the file-watcher opens the channel and pushes re-emitted chunks/ASTs into it. The
  running app cannot tell it is in dev — same bundle, same runtime, same code path. The only
  difference is whether a websocket is feeding the dormant hook: an *environment* fact, not a
  code fork. **Delete the current `--dev` bundle variant** (no baked-in HMR client, no
  `fetchAst`, no dev renderer).
- **One bundler invocation produces both.** Own the esbuild call directly (don't treat
  `deno bundle` as a black box). Prod = one `rebuild()` then close the context; dev = many
  `rebuild()`s on the same warm context. Identical config ⇒ identical output, guaranteed.

---

## 5. HMR latency — client

| Change | Mechanism | Floor |
|---|---|---|
| `template.html` | reparse the one file → push AST → runtime re-renders (no esbuild) | ~10–30 ms |
| `styles.css` | Tailwind incremental (v4 Rust/Oxide engine) → swap sheet (no esbuild) | ~30–100 ms |
| island `logic.ts` | warm esbuild re-emits just that chunk (**minified**) → push → re-hydrate, state preserved | ~50–150 ms |
| shared runtime chunk | re-emit shared chunk + all islands re-hydrate | rare — a *framework* edit, not app-dev |

The single biggest speedup over today: **warm, long-running services** — a persistent esbuild
context and Tailwind in watch mode — instead of spawning `deno bundle` and the Tailwind CLI as
fresh subprocesses per change. That process-startup + cold-parse tax is the current
multi-hundred-ms-to-second cost, and it is the difference between "feels like a build" and
"feels like HMR."

**Minify is free once incremental.** You only ever minify the ~KB chunk that changed (~1 ms),
so dev minifies too. Dev output then equals prod *including mangled names* — which closes the
last dev/prod gap: the `static key` / `constructor.name` name-mangling trap (a bug that today
is clean in dev and broken in prod) simply cannot exist.

---

## 6. Server-side reload

The one path that can't be a chunk-swap. **Don't restart the process** — the cost isn't the
bundle or Deno startup, it's **re-paying bootstrap**: backend connect, JWKS fetch, DI graph
construction, port bind, template-registry rescan.

Split the server:

- **Spine** — long-lived, inits **once**: the keep backend (`bootstrapServer` result), DI
  singletons, the SSR renderer, the open port.
- **App-logic graph** — re-imported on change: routes, guards, resolvers, page `logic.ts`.

`Deno.serve` binds **once** to a thin dispatcher `(req) => current(req)`, where `current` is a
mutable holder. On a change, rebuild only the affected layer and repoint `current`. The port
never rebinds; the spine never re-inits.

**The server probably shouldn't be bundled at all.** The browser forces client bundling; Deno
runs modules natively. With the CLI import map giving consistent resolution (one `@sprig/core`,
Deno dedups by resolved specifier ⇒ no dual-core server-side either), dev **and** prod can run
the server *as source through the CLI import map*. Then a server-logic edit is a cache-busted
dynamic re-import (`import(url + '?v=' + (++n))`) with no esbuild at all — single-digit to
low-double-digit ms. "Exactly the same as prod" is literal: same source, same import map, same
runtime; only the process lifecycle differs (dev keeps it, prod starts once).

| Change | Mechanism | Latency |
|---|---|---|
| routes / guards / resolve / page-logic | re-import the app-logic subgraph, swap the route table | ~20–80 ms |
| spine / composition (bootstrap wiring, DI registration) | rebuild that layer | restart-ish (uncommon) |

Re-import the app-logic *subgraph*, not one file (ESM caches by specifier, so pulling the whole
app-logic entry avoids stale references; the spine is excluded, so it stays small). A change to
a *shared* server service that many modules import is the one case that widens the re-import or
falls back to a restart. Accepted ceiling for the server path: **1 s** — comfortably met.

---

## 7. What rune has to change: nothing

- **Editing sprig server logic** (routes/guards/resolve/page-logic) never touches rune. The
  keep backend sits as a live black-box spine.
- **Editing rune backend logic** (coordinators/endpoints/DTOs) is handled by **re-running
  `bootstrapServer` in-process** — rune already returns `{ listen, stop, backend, handler }`
  and, in a `serveSprig` composition, binds no port of its own. The sprig dev server builds a
  fresh `api`, rebuilds the `serveSprig` handler, repoints `current`, and calls `oldApi.stop()`.
  That is rune's normal entry point, called a second time in the same process — **no HMR
  support needed inside rune.** It fits the 1 s ceiling as long as `bootstrapServer` does no
  slow *eager* I/O (alfred's connections are lazy/per-request — verified; its whole module
  graph registered inside one second at boot).

**Would rune-native module HMR be faster?** Yes. The floor for a leaf coordinator swap is
**~20–50 ms** — debounce-bound; the transpile + re-register compute is single-digit ms — i.e.
parity with client island HMR. But the millisecond floor is the easy part; **correctness is the
hard part.** Fine-grained module hot-swap means preserving live DI singletons, open
connections, and in-memory state across the swap — precisely where stale-reference bugs breed,
and precisely why backend frameworks default to restart-on-change. Given the 1 s budget is
already met by the zero-rune-change in-process re-bootstrap, rune-native HMR is a large,
fragile investment to beat a budget we're already beating.

**Recommendation: do not build rune HMR.** Keep all HMR orchestration in the sprig CLI; use
rune unchanged, behind a mutable handler holder.

---

## 8. Deployment (the seam that caused incident #2)

Prod must run the *same* artifact the CLI produces. Two shapes, one must be chosen
deliberately and the dev/prod artifacts must be **provably identical**:

- **(a) CLI-as-server:** the deploy entry *is* the CLI — `deno serve jsr:@sprig/core/cli@X …`
  — booting the server from app source + the CLI's bundled runtime.
- **(b) Self-contained server bundle:** `build --rune` emits a runnable server artifact
  (runtime baked in) that Deno Deploy runs with **no CLI present**.

Given §6 (the server runs as source through the CLI import map), **(a)** is the natural fit and
keeps a single execution path; **(b)** trades that for a CLI-free deploy at the cost of a second
"how the server starts" path — which is the kind of second path that started all of this.

---

## 9. Decisions needed

1. **Authoring / check.** The app authors against the `@sprig/core` *interface*; the CLI
   supplies the *implementation*. This implies **`deno check` no longer works standalone** —
   typecheck goes through `sprig check` (the CLI provides the import map). Accept? *(I think
   yes; it's the price of killing drift, and it's worth it.)*
2. **Prod entrypoint.** §8 (a) or (b)?
3. **rune boundary.** Confirm the CLI owns **only** the sprig runtime and composes the app's
   keep backend as-is — it never tries to bundle rune.
4. **Pinning.** One pin — the CLI version — pinned **per app** (deno task / a `sprig.json`), so
   a global CLI update can't silently change an app's runtime. (One pin can't disagree with
   itself; that's the whole win.)

---

## 10. Risks / non-goals

- **The CLI becomes a hard dependency for check / dev / build / deploy** — concentrated blast
  radius; a bad CLI release wedges everything at once. Mitigation: the per-app CLI pin (#4) plus
  the existing `install --dev` `file://` escape hatch.
- **Shipping the CLI as a `deno bundle` to JSR + the tree-sitter grammar.** JSR mangles any
  `.wasm` on ingest (the `grammar.wasm` → `grammar.bin` history). The grammar loads at runtime
  beside the bundle; confirm the published bundle keeps it resolvable — this is exactly the kind
  of thing that passes `--dry-run` and breaks on the published copy.
- **Not faster than Vite dev** (~50–150 ms vs ~20–50 ms). The trade is a slightly slower loop
  for **zero dev/prod skew** and a byte-identical prod artifact. Chosen deliberately; it's the
  thing that has burned us twice.
- **Non-goal:** rune-native HMR (§7).

---

## 11. One-line summary

Today the runtime is a singleton the build is *allowed* to duplicate, and dev is *allowed* to
differ from prod. Make the CLI the sole owner of the runtime and make one bundle the thing both
dev and prod run — then dual-core and dev/prod skew stop being mistakes you can make. rune
doesn't change; it just gets re-bootstrapped in-process behind a mutable handler.
