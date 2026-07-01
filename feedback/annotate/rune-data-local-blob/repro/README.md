# Repro: `blobs[]` cannot represent a local file

Self-contained. Needs only Deno + the `rune:data` skill scripts.

> ✅ **Resolved in rune 2.0.6:** a `"fs"` (local file) blob kind was added. A blob with
> `store: "fs"` now validates clean and renders as a local sidecar file (not S3). The captured
> output below is the original pre-fix run; `cases/local-blob-rejected.json` used `store: "fs_json"`
> (still rejected — blobs use `"fs"`, not `"fs_json"`), so it documents the gap as filed.

## Run

```sh
cd repro
V=~/.claude/skills/rune:data/scripts/validate_data.ts
deno run -A "$V" cases/local-blob-rejected.json   # tries store:"fs_json" on a blob
deno run -A "$V" cases/blob-store-omitted.json     # the only passing option
```

## Captured output (rune 2.0.5)

```
$ deno run -A validate_data.ts cases/local-blob-rejected.json
✗ entity 'shot' blobs[0]: `store` must be "s3" (got "fs_json")

1 error(s), 0 warning(s) — data.json is NOT valid.
exit: 1

$ deno run -A validate_data.ts cases/blob-store-omitted.json
✓ cases/blob-store-omitted.json is valid. 0 warning(s).
exit: 0
```

## What it shows

- **`cases/local-blob-rejected.json` (exit 1)** — a blob with `store: "fs_json"` (the honest
  "this is a local file" value, now that `fs_json` is a real store) is **rejected**: `blobs[]`
  hard-requires `store: "s3"` (`validate_data.ts:109`). There is no local blob kind.

- **`cases/blob-store-omitted.json` (exit 0)** — omitting `store` is the *only* way to pass with a
  blob, but it's still S3 downstream: `validate_data.ts:110-111` calls `key` "the S3 object key
  pattern", and `render_review.ts` prints "offloaded to S3" (`:195`), adds `s3` to the used stores
  whenever any blob exists (`:210`), and lists the blob under the **S3 panel** (`:219`). A local
  PNG ends up drawn in a cloud bucket.

## The ask

Let a blob name a local file — accept `blobs[].store: "fs_json"` (or add an `fs` kind) and bucket
local blobs under the local panel, not S3. Full write-up in [`../proposal.md`](../proposal.md).
