import { assertEquals, assertStringIncludes } from "#std/assert";
import { formatEastern, isNewer, latestCommitUrl } from "./mod.ts";

Deno.test("latestCommitUrl — points at the release's commit.txt asset (default latest)", () => {
  assertEquals(
    latestCommitUrl(),
    "https://github.com/mrg-keystone/rune/releases/download/latest/commit.txt",
  );
});

Deno.test("latestCommitUrl — honors a pinned tag", () => {
  assertEquals(
    latestCommitUrl("v0.1.0"),
    "https://github.com/mrg-keystone/rune/releases/download/v0.1.0/commit.txt",
  );
});

Deno.test("isNewer — differing commits means a newer release is out", () => {
  assertEquals(isNewer("aaaaaaa", "bbbbbbb"), true);
});

Deno.test("isNewer — same commit is up to date", () => {
  assertEquals(isNewer("aaaaaaa", "aaaaaaa"), false);
});

Deno.test("isNewer — unknown baked commit (dev build) never nags", () => {
  assertEquals(isNewer("unknown", "bbbbbbb"), false);
  assertEquals(isNewer(undefined, "bbbbbbb"), false);
});

Deno.test("isNewer — unreachable API (no latest sha) never nags", () => {
  assertEquals(isNewer("aaaaaaa", undefined), false);
});

Deno.test("formatEastern — summer UTC instant renders in EDT (UTC-4)", () => {
  // 19:32 UTC on Jun 26 → 15:32 (3:32 PM) EDT.
  const s = formatEastern("2026-06-26T19:32:00Z");
  assertEquals(s !== null, true);
  assertStringIncludes(s!, "Jun 26, 2026");
  assertStringIncludes(s!, "3:32");
  assertStringIncludes(s!, "EDT");
});

Deno.test("formatEastern — winter UTC instant renders in EST (UTC-5)", () => {
  // 19:32 UTC on Jan 15 → 14:32 (2:32 PM) EST — the zone label tracks the season.
  const s = formatEastern("2026-01-15T19:32:00Z");
  assertEquals(s !== null, true);
  assertStringIncludes(s!, "Jan 15, 2026");
  assertStringIncludes(s!, "2:32");
  assertStringIncludes(s!, "EST");
});

Deno.test("formatEastern — missing/unparseable stamp yields null (line omitted)", () => {
  assertEquals(formatEastern("unknown"), null);
  assertEquals(formatEastern(""), null);
});
