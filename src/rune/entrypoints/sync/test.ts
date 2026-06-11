import { assertEquals, assertStringIncludes } from "#std/assert";
import { join } from "#std/path";
import {
  ensureBootstrap,
  renderAppRegistry,
  renderMain,
  scanSurfaceModules,
} from "./mod.ts";

async function tempProject(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "rune-sync-test-" });
}

async function addSurface(
  root: string,
  module: string,
  surface: string,
  exportName?: string,
): Promise<void> {
  const dir = join(root, "src", module, "entrypoints", surface);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(
    join(dir, "mod.ts"),
    `export const ${exportName ?? surface + "Module"} = {};\n`,
  );
}

Deno.test("scanSurfaceModules — finds surfaces across modules, sorted", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "tasks", "http");
    await addSurface(root, "checkout", "http");
    await addSurface(root, "checkout", "cli");
    const found = await scanSurfaceModules(root);
    assertEquals(
      found.map((s) => `${s.module}/${s.surface}:${s.alias}`),
      [
        "checkout/cli:checkoutCliModule",
        "checkout/http:checkoutHttpModule",
        "tasks/http:tasksHttpModule",
      ],
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("scanSurfaceModules — reads a diverged export name from the file", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http", "storefrontModule");
    const [s] = await scanSurfaceModules(root);
    assertEquals(s.exportName, "storefrontModule");
    assertEquals(s.alias, "checkoutHttpModule");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("renderAppRegistry — imports each surface and exports the array", () => {
  const out = renderAppRegistry([
    {
      module: "checkout",
      surface: "http",
      exportName: "httpModule",
      alias: "checkoutHttpModule",
    },
  ]);
  assertStringIncludes(
    out,
    'import { httpModule as checkoutHttpModule } from "@/src/checkout/entrypoints/http/mod.ts";',
  );
  assertStringIncludes(out, "export const modules = [\n  checkoutHttpModule,\n];");
});

Deno.test("renderMain — wires the registry into bootstrapServer", () => {
  const out = renderMain("shop");
  assertStringIncludes(out, 'import { bootstrapServer } from "@mrg-keystone/keep";');
  assertStringIncludes(out, 'import { modules } from "@/bootstrap/modules.ts";');
  assertStringIncludes(
    out,
    'await bootstrapServer("shop", modules, { port: config.port });',
  );
});

Deno.test("ensureBootstrap — creates app.ts + main.ts, then add/remove updates only app.ts", async () => {
  const root = await tempProject();
  const ioErrors: string[] = [];
  try {
    await addSurface(root, "checkout", "http");
    let notes = await ensureBootstrap(root, ioErrors);
    assertEquals(notes.length, 3); // created modules.ts + config.ts + mod.ts
    const main1 = await Deno.readTextFile(join(root, "bootstrap", "mod.ts"));

    // Dev customizes main.ts; a new module appears.
    await Deno.writeTextFile(join(root, "bootstrap", "mod.ts"), main1 + "// custom\n");
    await addSurface(root, "tasks", "http");
    notes = await ensureBootstrap(root, ioErrors);
    assertEquals(notes, ["updated bootstrap/modules.ts (module registry: 2 surface module(s))"]);
    assertStringIncludes(
      await Deno.readTextFile(join(root, "bootstrap", "modules.ts")),
      "tasksHttpModule",
    );
    assertStringIncludes(
      await Deno.readTextFile(join(root, "bootstrap", "mod.ts")),
      "// custom",
    );

    // The module's rune goes away (its tree is deleted) → registry drops it.
    await Deno.remove(join(root, "src", "tasks"), { recursive: true });
    notes = await ensureBootstrap(root, ioErrors);
    assertEquals(notes, ["updated bootstrap/modules.ts (module registry: 1 surface module(s))"]);
    assertEquals(
      (await Deno.readTextFile(join(root, "bootstrap", "modules.ts"))).includes("tasksHttpModule"),
      false,
    );
    assertEquals(ioErrors, []);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — no surfaces and no registry → generates nothing", async () => {
  const root = await tempProject();
  try {
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes, []);
    assertEquals(await exists(join(root, "bootstrap", "mod.ts")), false);
    assertEquals(await exists(join(root, "bootstrap", "modules.ts")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — a hand-written modules.ts is never clobbered", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await Deno.mkdir(join(root, "bootstrap"), { recursive: true });
    await Deno.writeTextFile(join(root, "bootstrap", "modules.ts"), "// mine\n");
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes.length, 1);
    assertStringIncludes(notes[0], "left untouched");
    assertEquals(await Deno.readTextFile(join(root, "bootstrap", "modules.ts")), "// mine\n");
    assertEquals(await exists(join(root, "bootstrap", "mod.ts")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

// ---- ghost stubs (bootstrap/stubs.ts) ----------------------------------------

// Consumes [TYP:ext] memberId that nothing in the module produces.
const CHECKOUT_RUNE = `[MOD] checkout

[ENT] http.start(StartDto): TicketDto

[DTO] StartDto: item, memberId
    what to buy and who buys it
[DTO] TicketDto: ticketId
    the opened ticket

[TYP:ext] memberId: string
    minted by the members module
[TYP] item: string
    a thing to buy
[TYP] ticketId: string
    a ticket id
`;

// Produces memberId — the real producer that evaporates the ghost.
const MEMBERS_RUNE = `[MOD] members

[ENT] http.join(JoinDto): MemberDto

[DTO] JoinDto: alias
    who joins
[DTO] MemberDto: memberId
    the minted member

[TYP] alias: string
    a display name
[TYP] memberId: string
    a member id
`;

async function addSpec(root: string, module: string, text: string): Promise<void> {
  const dir = join(root, "src", module);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, `${module}.rune`), text);
}

Deno.test("ensureBootstrap — ghost stubs created for unfulfilled ext inputs, gated in the registry", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await addSpec(root, "checkout", CHECKOUT_RUNE);
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes.some((n) => n.includes("created bootstrap/stubs.ts")), true);
    const stubs = await Deno.readTextFile(join(root, "bootstrap", "stubs.ts"));
    assertEquals(stubs.startsWith("// Generated by rune sync — DO NOT EDIT."), true);
    assertStringIncludes(stubs, 'path: "mint-member-id"');
    assertStringIncludes(stubs, "stub: true");
    const registry = await Deno.readTextFile(join(root, "bootstrap", "modules.ts"));
    assertStringIncludes(registry, 'import { stubsModule } from "@/bootstrap/stubs.ts";');
    assertStringIncludes(
      registry,
      '...(Deno.env.get("DENO_ENV") === "production" ? [] : [stubsModule]),',
    );
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — ghost stubs evaporate when a real producer module appears", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await addSpec(root, "checkout", CHECKOUT_RUNE);
    await ensureBootstrap(root, []);
    assertEquals(await exists(join(root, "bootstrap", "stubs.ts")), true);

    await addSurface(root, "members", "http");
    await addSpec(root, "members", MEMBERS_RUNE);
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes.some((n) => n.includes("removed bootstrap/stubs.ts")), true);
    assertEquals(await exists(join(root, "bootstrap", "stubs.ts")), false);
    const registry = await Deno.readTextFile(join(root, "bootstrap", "modules.ts"));
    assertEquals(registry.includes("stubsModule"), false);
    assertEquals(registry.includes("DENO_ENV"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — a real module named 'stubs' disables the ghost", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await addSpec(root, "checkout", CHECKOUT_RUNE);
    await addSurface(root, "stubs", "http");
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes.some((n) => n.includes("module 'stubs' exists — ghost stubs disabled")), true);
    assertEquals(await exists(join(root, "bootstrap", "stubs.ts")), false);
    const registry = await Deno.readTextFile(join(root, "bootstrap", "modules.ts"));
    assertStringIncludes(registry, "stubsHttpModule"); // the real module, scanned normally
    assertEquals(registry.includes("@/bootstrap/stubs.ts"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — a hand-written bootstrap/stubs.ts is never clobbered or deleted", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await addSpec(root, "checkout", CHECKOUT_RUNE);
    await Deno.mkdir(join(root, "bootstrap"), { recursive: true });
    await Deno.writeTextFile(join(root, "bootstrap", "stubs.ts"), "// mine\n");
    const notes = await ensureBootstrap(root, []);
    assertEquals(
      notes.some((n) =>
        n.includes("bootstrap/stubs.ts exists but was not generated by rune sync")
      ),
      true,
    );
    assertEquals(await Deno.readTextFile(join(root, "bootstrap", "stubs.ts")), "// mine\n");
    const registry = await Deno.readTextFile(join(root, "bootstrap", "modules.ts"));
    assertEquals(registry.includes("stubsModule"), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureBootstrap — ghost stubs refresh is byte-identical-skip and tracks new fields", async () => {
  const root = await tempProject();
  try {
    await addSurface(root, "checkout", "http");
    await addSpec(root, "checkout", CHECKOUT_RUNE);
    await ensureBootstrap(root, []);
    // Re-run with no changes: no stub note (byte-identical skip).
    const notes = await ensureBootstrap(root, []);
    assertEquals(notes.some((n) => n.includes("bootstrap/stubs.ts")), false);
    // A second ext field appears → the ghost is refreshed.
    await addSpec(
      root,
      "checkout",
      CHECKOUT_RUNE.replace("StartDto: item, memberId", "StartDto: item, memberId, tenantKey") +
        "[TYP:ext] tenantKey: string\n    issued by ops\n",
    );
    const notes2 = await ensureBootstrap(root, []);
    assertEquals(notes2.some((n) => n.includes("updated bootstrap/stubs.ts")), true);
    const stubs = await Deno.readTextFile(join(root, "bootstrap", "stubs.ts"));
    assertStringIncludes(stubs, 'path: "mint-tenant-key"');
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}
