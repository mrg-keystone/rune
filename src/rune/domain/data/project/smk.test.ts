import { assert, assertEquals } from "#std/assert";
import { fromFileUrl, isAbsolute, join } from "#std/path";
import { findGitRoot, readWorkspaceMembers } from "./mod.ts";

Deno.test("findGitRoot — resolves to repo root", async () => {
  const root = await findGitRoot();
  assert(root.length > 0, "should return a path");
  // Checkout-name-independent: assert git-root PROPERTIES, not the basename
  // (a checkout may live at any dir name — `rune/main`, say).
  assert(isAbsolute(root), "should be an absolute path");
  // A git root carries a `.git` entry — a directory in a plain clone, a file
  // in a linked worktree; either proves this is a repository root.
  const dotGit = await Deno.stat(join(root, ".git"));
  assert(dotGit.isDirectory || dotGit.isFile, ".git should exist at the root");
  // This test file lives inside the repo, so the resolved root must contain it.
  const here = fromFileUrl(import.meta.url);
  assert(
    here.startsWith(root + "/") || here.startsWith(root + "\\"),
    `test file ${here} should live under the resolved root ${root}`,
  );
});

Deno.test("readWorkspaceMembers — returns null when no deno.json", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readWorkspaceMembers(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readWorkspaceMembers — returns null when no workspace key", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "deno.json"), `{ "name": "solo" }`);
    assertEquals(await readWorkspaceMembers(dir), null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readWorkspaceMembers — returns members when workspace key present", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      join(dir, "deno.json"),
      `{ "workspace": ["./keep"] }`,
    );
    assertEquals(await readWorkspaceMembers(dir), [
      "./keep",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
