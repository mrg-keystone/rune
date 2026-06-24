import { assertEquals } from "#std/assert";
import { isNewer, latestCommitUrl } from "./mod.ts";

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
