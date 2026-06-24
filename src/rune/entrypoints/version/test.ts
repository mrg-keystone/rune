import { assertEquals } from "#std/assert";
import { isNewer } from "./mod.ts";

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
