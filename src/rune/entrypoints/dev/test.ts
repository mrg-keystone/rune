import { assertEquals } from "#std/assert";
import {
  addSuppressions,
  classifyPath,
  isSuppressed,
  planCycle,
} from "./mod.ts";

// ---- classifyPath -------------------------------------------------------------

Deno.test("classifyPath — project specs are 'spec'", () => {
  assertEquals(classifyPath("spec/orders.rune"), "spec"); // singular (rune init)
  assertEquals(classifyPath("specs/orders.rune"), "spec"); // plural (staging)
  assertEquals(classifyPath("src/orders/orders.rune"), "spec");
  assertEquals(classifyPath("src/orders/spec.rune"), "spec");
});

Deno.test("classifyPath — non-project .rune files are ignored", () => {
  // Not a recognized project-spec slot → never drives a cycle (no sync, no
  // restart), so docs, scratch specs, and drafts stay out of the running app.
  assertEquals(classifyPath("src/orders/notes/scratch.rune"), "ignored");
  assertEquals(classifyPath("orders.rune"), "ignored");
});

Deno.test("classifyPath — .in-prog.rune drafts are ignored", () => {
  assertEquals(classifyPath("spec/orders.in-prog.rune"), "ignored");
  assertEquals(classifyPath("specs/orders.in-prog.rune"), "ignored");
});

Deno.test("classifyPath — generated/source files are 'source'", () => {
  assertEquals(classifyPath("src/orders/entrypoints/http/mod.ts"), "source");
  assertEquals(classifyPath("bootstrap/mod.ts"), "source");
  assertEquals(classifyPath("deno.json"), "source");
});

Deno.test("classifyPath — dotfiles, .DS_Store, and out-of-root paths are ignored", () => {
  assertEquals(classifyPath(".DS_Store"), "ignored");
  assertEquals(classifyPath("src/orders/.DS_Store"), "ignored");
  assertEquals(classifyPath("src/.cache/x.ts"), "ignored");
  assertEquals(classifyPath("../outside/file.ts"), "ignored");
  assertEquals(classifyPath(""), "ignored");
});

// ---- suppression set ------------------------------------------------------------

Deno.test("suppressions — a muted path is dropped until its expiry, then live again", () => {
  const set = new Map<string, number>();
  addSuppressions(set, ["/p/a.ts", "/p/b.ts"], 1000);
  assertEquals(isSuppressed(set, "/p/a.ts", 999), true);
  assertEquals(isSuppressed(set, "/p/a.ts", 1000), true); // inclusive boundary
  assertEquals(isSuppressed(set, "/p/a.ts", 1001), false); // expired
  assertEquals(set.has("/p/a.ts"), false); // pruned on expiry
  assertEquals(isSuppressed(set, "/p/b.ts", 500), true);
});

Deno.test("suppressions — unknown paths are never suppressed", () => {
  const set = new Map<string, number>();
  addSuppressions(set, ["/p/a.ts"], 1000);
  assertEquals(isSuppressed(set, "/p/other.ts", 0), false);
});

Deno.test("suppressions — a longer mute wins; a shorter re-add cannot shorten it", () => {
  const set = new Map<string, number>();
  addSuppressions(set, ["/p/a.ts"], 5000);
  addSuppressions(set, ["/p/a.ts"], 1000); // earlier expiry must not shrink the window
  assertEquals(isSuppressed(set, "/p/a.ts", 4000), true);
});

// ---- cycle planning -------------------------------------------------------------

Deno.test("planCycle — only noise → no cycle at all", () => {
  assertEquals(planCycle([]), null);
  assertEquals(planCycle([".DS_Store", "src/.tmp/x"]), null);
});

Deno.test("planCycle — spec changes are collected, deduped, sorted", () => {
  const plan = planCycle([
    "src/orders/orders.rune",
    "specs/members.rune",
    "src/orders/orders.rune",
  ]);
  assertEquals(plan, {
    specs: ["specs/members.rune", "src/orders/orders.rune"],
    restart: false,
  });
});

Deno.test("planCycle — source-only changes mean restart without sync", () => {
  const plan = planCycle(["src/orders/domain/coordinators/place/mod.ts"]);
  assertEquals(plan, { specs: [], restart: true });
});

Deno.test("planCycle — mixed batch carries both the specs and the restart flag", () => {
  const plan = planCycle([
    "src/orders/orders.rune",
    "bootstrap/config.ts",
    ".DS_Store",
  ]);
  assertEquals(plan, { specs: ["src/orders/orders.rune"], restart: true });
});
