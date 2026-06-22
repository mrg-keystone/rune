import { assert, assertEquals } from "#std/assert";
import { join } from "#std/path";
import { findGitRoot, readWorkspaceMembers } from "./mod.ts";

Deno.test("findGitRoot — resolves to repo root", async () => {
  const root = await findGitRoot();
  assert(root.length > 0, "should return a path");
  assert(root.endsWith("rune"), "should end with repo name");
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
