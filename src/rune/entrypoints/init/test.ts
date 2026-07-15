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
  // The composed monorepo split: a ui/ UI package + a server/ keep-backend package,
  // a shared spec/ at the root, and the git-root serve.ts + workspace deno.json.
  await Deno.mkdir(join(proj, "server", "bootstrap"), { recursive: true });
  await Deno.mkdir(join(proj, "ui", "src", "pages", "home"), { recursive: true });
  // git-root workspace deno.json
  await Deno.writeTextFile(
    join(proj, "deno.json"),
    JSON.stringify(
      {
        workspace: ["./ui", "./server"],
        tasks: {
          dev: "sprig dev",
          build: "sprig build",
          start: "deno serve -A serve.ts",
        },
      },
      null,
      2,
    ) + "\n",
  );
  // ui/ member: the sprig UI package
  await Deno.writeTextFile(
    join(proj, "ui", "deno.json"),
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
          "reflect-metadata": "npm:reflect-metadata@0.1.13",
        },
      },
      null,
      2,
    ) + "\n",
  );
  // server/ member: the keep backend package (its own pins; rune overlays @/ etc.)
  await Deno.writeTextFile(
    join(proj, "server", "deno.json"),
    JSON.stringify(
      {
        name: "@app/myapp-server",
        compilerOptions: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
        imports: {
          "@sprig/core": "jsr:@sprig/core@^0.20.2",
          "@mrg-keystone/rune": "jsr:@mrg-keystone/rune@^4.1.0",
          "reflect-metadata": "npm:reflect-metadata@0.1.13",
        },
      },
      null,
      2,
    ) + "\n",
  );
  // git-root serve.ts — imports the keep backend from ./server/bootstrap/mod.ts
  await Deno.writeTextFile(
    join(proj, "serve.ts"),
    `import { serveSprig } from "@sprig/keep";\nimport { api } from "./server/bootstrap/mod.ts";\nexport default serveSprig({ keep: api });\n`,
  );
  // server/bootstrap/mod.ts — sprig's empty keep backend (overlay replaces it)
  await Deno.writeTextFile(
    join(proj, "server", "bootstrap", "mod.ts"),
    `import { bootstrapServer } from "@mrg-keystone/rune";\nexport const api = await bootstrapServer("myapp", [], {});\n`,
  );
  await Deno.writeTextFile(
    join(proj, "ui", "src", "mod.ts"),
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

    // server/bootstrap/ is now the registry-driven backend (renderMain), plus registry + config.
    for (
      const p of [
        "server/bootstrap/mod.ts",
        "server/bootstrap/config.ts",
        "server/bootstrap/modules.ts",
        "spec/runes/core.rune",
      ]
    ) {
      assert((await Deno.stat(join(proj, p))).isFile, `missing ${p}`);
    }
    const boot = await Deno.readTextFile(
      join(proj, "server", "bootstrap", "mod.ts"),
    );
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
    // The canonical layout is recorded as an artifact (a decision, not an accident),
    // with a Deviations section for intentional divergence.
    const layout = await Deno.readTextFile(
      join(proj, "spec", "misc", "layout.md"),
    );
    assertStringIncludes(layout, "# Composed-repo layout");
    assertStringIncludes(layout, "serveSprig");
    assertStringIncludes(layout, "## Deviations");
    assert(
      (await Deno.stat(join(proj, "spec", "ui"))).isDirectory,
      "spec/ui/ should exist",
    );

    // sprig's UI entry is untouched.
    assert(
      (await Deno.stat(join(proj, "ui", "src", "mod.ts"))).isFile,
      "sprig's ui/src/mod.ts must survive the overlay",
    );

    // server/deno.json now carries BOTH sprig's pins and rune's engine import map,
    // merged additively — sprig's @mrg-keystone/rune pin is preserved (not clobbered).
    const denoJson = await Deno.readTextFile(join(proj, "server", "deno.json"));
    assertStringIncludes(denoJson, "@sprig/core", "sprig's pins must survive");
    assertStringIncludes(
      denoJson,
      "jsr:@mrg-keystone/rune@^4.1.0",
      "sprig's rune pin is preserved, not clobbered",
    );
    assertStringIncludes(denoJson, '"@/": "./"', "rune's @/ alias is added");
    assertStringIncludes(
      denoJson,
      "jsr:@mrg-keystone/rune@^4/assert",
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
