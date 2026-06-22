import { assert, assertEquals } from "#std/assert";
import { findGitRoot, readWorkspaceMembers } from "./mod.ts";

Deno.test("findGitRoot — resolves to repo root", async () => {
  const root = await findGitRoot();
  assert(root.length > 0, "should return a path");
  assert(root.endsWith("rune"), "should end with repo name");
});

Deno.test("readWorkspaceMembers — returns null when no workspace key", async () => {
  const root = await findGitRoot();
  const members = await readWorkspaceMembers(root);
  assertEquals(members, null);
});
