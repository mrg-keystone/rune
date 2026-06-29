# Feedback: `data.json` `blobs[]` has no local-file kind (S3-only)

**From:** designing the `annotate` module's data with the `rune:data` skill.
**Target:** the `rune:data` skill — `scripts/validate_data.ts` + `scripts/render_review.ts`.
**Type:** missing local kind in a closed set · **Severity:** papercut (workaround exists)

## The short version

`data.json`'s `blobs[]` construct is hardwired to S3. A **local binary file** — e.g. a screenshot
PNG written next to an `fs_json` store — cannot be declared honestly: any local `store` value is
rejected, and even an omitted one renders as "offloaded to S3". Ask: **let a blob name a local
file** (`store: "fs_json"`, or a new `fs` kind), and bucket it under the local panel, not S3.

## Proven, with a runnable repro

`validate_data.ts` on two one-entity files (see [`repro/`](./repro/), output in
[`repro/README.md`](./repro/README.md)):

| Case | blob `store` | Result |
|------|--------------|--------|
| A | `"fs_json"` | **ERROR (exit 1):** `blobs[0]: store must be "s3" (got "fs_json")` |
| B | omitted | OK — the only passing option, but still S3 (`render_review.ts:195/210/219`, `key` = "S3 object key pattern") |

## This is the third one

Same local-vs-remote closed-set gap surfaced from the same work — the first two already fixed the
same way:

- `[SRV]` transport had no native kind → **`NATIVE`** (rune 2.0.4).
- store enum had no local-JSON kind → **`fs_json`** (rune 2.0.5).
- `blobs[]` has no local-file kind → **this**.

## Contents

- [`proposal.md`](./proposal.md) — motivation, the exact `validate_data.ts` + `render_review.ts`
  edits, alternatives, and the pattern.
- [`repro/`](./repro/) — two self-contained `validate_data.ts` cases + captured output.

## Note

For `annotate` itself this is already worked around (the screenshot is modeled as a plain local
file field, not a blob — no S3 in the design). The proposal is the *systematic* fix so a local
large binary file can be declared as a blob honestly, instead of being forced into S3 or dropped.
