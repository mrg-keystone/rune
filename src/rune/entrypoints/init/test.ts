import { assert, assertEquals, assertRejects } from "#std/assert";
import { join } from "#std/path";
import { runInit } from "./mod.ts";

// runInit resolves the project dir from the CWD, so each filesystem test runs
// inside a throwaway dir and restores the original CWD afterward.
async function inTempCwd(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir();
  const orig = Deno.cwd();
  Deno.chdir(dir);
  try {
    await fn(dir);
  } finally {
    Deno.chdir(orig);
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("runInit — scaffolds the spec/ skeleton (deno.json + spec/core.rune + bootstrap/ + empty src/)", async () => {
  await inTempCwd(async (dir) => {
    assertEquals(await runInit(["myapp"]), 0);
    const proj = join(dir, "myapp");

    // Exactly the skeleton: the import map, the core spec in spec/, and bootstrap/.
    for (
      const p of [
        "deno.json",
        "spec/core.rune",
        "bootstrap/mod.ts",
        "bootstrap/config.ts",
        "bootstrap/modules.ts",
      ]
    ) {
      assert((await Deno.stat(join(proj, p))).isFile, `missing ${p}`);
    }

    // src/ exists but is empty — codegen lands here when you `rune sync`.
    assert((await Deno.stat(join(proj, "src"))).isDirectory, "src/ should exist");
    assertEquals([...Deno.readDirSync(join(proj, "src"))].length, 0, "src/ should be empty");

    // No module spec and no generated code — that's the author's + `rune sync`'s job.
    await assertRejects(() => Deno.stat(join(proj, "spec", "tasks.rune")));
    await assertRejects(() => Deno.stat(join(proj, "src", "core")));

    // deno.json pins the published runtime so the skeleton type-checks as-is.
    const denoJson = await Deno.readTextFile(join(proj, "deno.json"));
    assert(
      denoJson.includes("jsr:@mrg-keystone/rune@^1"),
      "deno.json should pin jsr:@mrg-keystone/rune@^1",
    );
  });
});

Deno.test("runInit — exit 2 with no project name", async () => {
  assertEquals(await runInit([]), 2);
});

Deno.test("runInit — exit 2 on a path-like name", async () => {
  assertEquals(await runInit(["../escape"]), 2);
});

Deno.test("runInit — exit 2 into a non-empty existing dir", async () => {
  await inTempCwd(async (dir) => {
    await Deno.mkdir(join(dir, "taken"));
    await Deno.writeTextFile(join(dir, "taken", "x"), "");
    assertEquals(await runInit(["taken"]), 2);
  });
});
