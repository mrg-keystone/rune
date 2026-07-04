import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { join } from "#std/path";
import { overlayRuneBackend, runInit } from "./mod.ts";

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

/** Minimal stand-in for what `sprig init` writes: a deno.json with sprig's pins +
 *  tasks, an empty keep backend, and the src/ UI entry. Lets us test the overlay
 *  without shelling out to (or installing) the sprig CLI. */
async function fakeSprigScaffold(proj: string): Promise<void> {
  await Deno.mkdir(join(proj, "bootstrap"), { recursive: true });
  await Deno.mkdir(join(proj, "src", "pages", "home"), { recursive: true });
  await Deno.writeTextFile(
    join(proj, "deno.json"),
    JSON.stringify(
      {
        name: "@app/myapp",
        exports: "./src/mod.ts",
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        imports: {
          "$": "./src/mod.ts",
          "@sprig/core": "jsr:@sprig/core@^0.20.2",
          "@sprig/keep": "jsr:@sprig/core@^0.20.2/keep",
          "@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^3.1.0",
          "reflect-metadata": "npm:reflect-metadata@0.1.13",
        },
        tasks: {
          dev: "sprig dev .",
          build: "sprig build .",
          start: "deno serve -A --unstable-kv serve.ts",
        },
      },
      null,
      2,
    ) + "\n",
  );
  await Deno.writeTextFile(
    join(proj, "serve.ts"),
    `import { serveSprig } from "@sprig/keep";\nimport { api } from "./bootstrap/mod.ts";\nimport { sprigApp } from "$";\nexport default serveSprig({ keep: api, app: sprigApp, base: "/ui" });\n`,
  );
  await Deno.writeTextFile(
    join(proj, "bootstrap", "mod.ts"),
    `import { bootstrapServer } from "@mrg-keystone/rune";\nexport const api = await bootstrapServer("myapp", [], {});\n`,
  );
  await Deno.writeTextFile(
    join(proj, "src", "mod.ts"),
    `export const sprigApp = {} as unknown;\n`,
  );
}

Deno.test("overlayRuneBackend — lays the rune keep backend + spec/ over a sprig scaffold", async () => {
  await inTempCwd(async (dir) => {
    const proj = join(dir, "myapp");
    await fakeSprigScaffold(proj);

    const ioErrors: string[] = [];
    await overlayRuneBackend(proj, "myapp", ioErrors);
    assertEquals(ioErrors, [], "overlay should not report I/O errors");

    // bootstrap/ is now the registry-driven backend (renderMain), plus registry + config.
    for (
      const p of [
        "bootstrap/mod.ts",
        "bootstrap/config.ts",
        "bootstrap/modules.ts",
        "spec/runes/core.rune",
      ]
    ) {
      assert((await Deno.stat(join(proj, p))).isFile, `missing ${p}`);
    }
    const boot = await Deno.readTextFile(join(proj, "bootstrap", "mod.ts"));
    assertStringIncludes(
      boot,
      'import { bootstrapServer } from "@mrg-keystone/rune";',
    );
    assertStringIncludes(
      boot,
      "import.meta.main",
      "renderMain keeps the backend-only listen for `rune dev`",
    );

    // The spec/ authoring layout exists.
    assert(
      (await Deno.stat(join(proj, "spec", "misc"))).isDirectory,
      "spec/misc/ should exist",
    );
    assert(
      (await Deno.stat(join(proj, "spec", "ui"))).isDirectory,
      "spec/ui/ should exist",
    );

    // sprig's UI entry is untouched.
    assert(
      (await Deno.stat(join(proj, "src", "mod.ts"))).isFile,
      "sprig's src/mod.ts must survive the overlay",
    );

    // deno.json now carries BOTH sprig's pins and rune's engine import map, merged
    // additively — sprig's @mrg-keystone/rune pin is preserved (not clobbered).
    const denoJson = await Deno.readTextFile(join(proj, "deno.json"));
    assertStringIncludes(denoJson, "@sprig/core", "sprig's pins must survive");
    assertStringIncludes(
      denoJson,
      "jsr:@mrg-keystone/rune@^3.1.0",
      "sprig's rune pin is preserved, not clobbered",
    );
    assertStringIncludes(denoJson, '"@/": "./"', "rune's @/ alias is added");
    assertStringIncludes(
      denoJson,
      "jsr:@mrg-keystone/rune@^3/assert",
      "rune's #assert is added",
    );
  });
});

Deno.test("runInit — exit 2 with no project name", async () => {
  assertEquals(await runInit([]), 2);
});

Deno.test("runInit — exit 2 on a path-like name", async () => {
  assertEquals(await runInit(["../escape"]), 2);
});

Deno.test("runInit — exit 2 into an existing dir (before any sprig shell-out)", async () => {
  await inTempCwd(async (dir) => {
    await Deno.mkdir(join(dir, "taken"));
    assertEquals(await runInit(["taken"]), 2);
  });
});
