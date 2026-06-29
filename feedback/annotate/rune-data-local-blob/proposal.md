# Proposal: a local-file blob kind for `data.json` (`blobs[]` is S3-only)

**Status:** proposal · **Affects:** the `rune:data` skill — `scripts/validate_data.ts` (blob rule),
`scripts/render_review.ts` (S3 bucketing), and the store rubric.
**Origin:** designing the `annotate` module's data. Self-contained repro in [`./repro/`](./repro/).
**Verified against:** the installed skill scripts (rune 2.0.5).

## Summary

`data.json`'s `blobs[]` construct is hardwired to S3. There is no way to declare a **local binary
file** — e.g. a PNG written next to an `fs_json` store. Add a local blob kind: accept
`blobs[].store ∈ {s3, fs_json}` (or a dedicated `fs`/`file`), and have the renderer bucket local
blobs under the local panel instead of S3. This is the direct parallel of the just-shipped
`fs_json` store kind and the `NATIVE` `[SRV]` transport.

## The gap (repro — captured output in [`repro/README.md`](./repro/README.md))

| Case | blob `store` | `validate_data.ts` |
|------|--------------|--------------------|
| A | `"fs_json"` (try to say "local") | **ERROR (exit 1):** `entity 'shot' blobs[0]: `store` must be "s3" (got "fs_json")` |
| B | omitted | OK (exit 0) — the only passing option, but still S3-semantic |

So the only two ways to express a blob are `store: "s3"` or omitted — and **both are S3** downstream:
`validate_data.ts:110-111` documents `key` as *"the S3 object key pattern"* and `field` as the
*"S3 reference"*; `render_review.ts` prints *"offloaded to S3"* (`:195`), pushes `s3` into the used
stores whenever `blobs.length` (`:210`), and lists blobs under the **S3 panel** (`:219`).

## Why it matters

Any local app (`fs_json` or `sqlite`) that writes binary sidecar files — screenshots, exports,
thumbnails, generated assets — has nowhere honest to declare them. Today you choose between:

- **(a) declare a blob** → forced `store: "s3"`, rendered "offloaded to S3", `key` = "S3 object key
  pattern". A lie for a file that's committed next to the JSON.
- **(b) drop `blobs[]`** and model the file as a plain string field → honest about locality, but
  loses the *"this is large binary data, stored out-of-band"* signal that `blobs[]` exists to give.

We shipped **(b)** for `annotate` (the screenshot is just a local sibling file). That's correct for
this case, but the schema still cannot *name* a local large file — which is the actual gap.

## Proposed change

### `validate_data.ts`
- `:109` — relax `if (b?.store && b.store !== "s3")` to accept a local kind, e.g.
  `b.store ∈ {"s3", "fs_json"}` (mirrors `STORES` now including `fs_json`), or add a dedicated
  `"fs"` blob store.
- `:110-111` — make the `key`/`field` warnings store-aware: "local file path/pattern" for a local
  blob, "S3 object key pattern" only for `s3`.
- `:107` comment ("offloaded to S3") — acknowledge local blobs.
- Retention: `fs-json-sweep` (already in `RET_MECHS` as of 2.0.5) is the natural mechanism for a
  timed local blob.

### `render_review.ts`
- `:195` — "offloaded to S3" should describe **only** `s3` blobs; local blobs → "local sidecar
  files beside the store".
- `:210` — a local blob must **not** push `s3` into `usedStores`; it belongs to its owner's store
  panel (e.g. `fs_json`).
- `:219` — list `s3` blobs under the S3 panel, local blobs under the local panel.
- `:68` — `.badge.blob` uses the S3 palette; a local blob badge should use the local store's color.

## Alternatives considered
1. **Do nothing.** Local binary files keep masquerading as S3, or get dropped from the design
   (losing the large-binary signal).
2. **Only the (b) workaround.** Fine for small cases, but the schema still can't name a local large
   file — exactly the gap this closes.

## The pattern (context for the maintainer)

This is the **third** local-vs-remote closed-set gap surfaced from the same `annotate` work, and
the first two were already fixed the same way — *add the local kind, stop forcing local things
through the remote bucket*:

| Layer | Closed set lacked | Fixed in |
|-------|-------------------|----------|
| `[SRV]` transport | a native/in-process kind | `NATIVE` — rune 2.0.4 |
| store enum | a local-JSON-file kind | `fs_json` — rune 2.0.5 |
| `blobs[]` | a local-file kind | **this proposal** |

## References (exact edit sites)
- `validate_data.ts`: `:107-112` (blob rule), `:13` `STORES`, `:17` `RET_MECHS`.
- `render_review.ts`: `:68` (blob badge), `:192`, `:195`, `:208`, `:210`, `:219`.
