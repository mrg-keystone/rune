import { assertEquals, assertStringIncludes } from "#std/assert";
import { join } from "#std/path";
import {
  ensureBootstrap,
  ensureHealRules,
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

// ---- ensureHealRules --------------------------------------------------------

// A keep-app spec with two endpoints: `enable` is the precondition, `write`
// declares the `not-enabled` (precondition) + `quota-exceeded` (no-signal) slugs.
const TABLES_SPEC = `[MOD] tables

[ENT] http.enable(EnableDto): TableDto
[ENT] http.write(WriteDto): RowDto

[REQ] table.enable(EnableDto): TableDto
    [NEW] table
    db:table.save(TableDto): void
      timeout
    table.toDto(): TableDto

[REQ] table.write(WriteDto): RowDto
    [NEW] row
    db:row.append(WriteDto): RowDto
      not-enabled
      quota-exceeded
    row.toDto(): RowDto

[DTO] EnableDto: name
    the table to track
[DTO] TableDto: tableId
    a tracked table
[DTO] WriteDto: tableId, payload
    a row to write
[DTO] RowDto: rowId
    a written row

[TYP] name: string
    a table name
[TYP] tableId: string
    a table id
[TYP] payload: string
    row contents
[TYP] rowId: string
    a row id
`;

Deno.test("ensureHealRules — scaffolds fixtures/heal-rules.json from endpoint slugs", async () => {
  const root = await tempProject();
  try {
    await addSpec(root, "tables", TABLES_SPEC);
    const notes = await ensureHealRules(root, []);
    assertEquals(notes.some((n) => n.includes("created fixtures/heal-rules.json")), true);
    // The enrichment nudge names every un-enriched (todo) slug — including the
    // run-step pre-fill, which is a heuristic guess flagged for verification.
    assertEquals(notes.some((n) => n.includes("need enrichment") && n.includes("quota-exceeded") && n.includes("not-enabled")), true);
    const rules = JSON.parse(
      await Deno.readTextFile(join(root, "fixtures", "heal-rules.json")),
    );
    assertEquals(rules.v, 1);
    // `timeout` is keep's reserved generic — excluded.
    assertEquals(Object.keys(rules.slugs).sort(), ["not-enabled", "quota-exceeded"]);
    // `not-enabled` pre-fills a run-step matching the enable endpoint.
    assertEquals(rules.slugs["not-enabled"][0].kind, "run-step");
    assertEquals(rules.slugs["not-enabled"][0].match, "/enable/i");
    // `quota-exceeded` has no signal → a TODO note.
    assertEquals(rules.slugs["quota-exceeded"][0].kind, "note");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureHealRules — enrichment nudge persists on a no-op re-sync while todos remain", async () => {
  const root = await tempProject();
  try {
    await addSpec(root, "tables", TABLES_SPEC);
    await ensureHealRules(root, []); // create
    // Second sync, nothing changed — the file is not rewritten, but the standing
    // nudge must still fire (a later session inherits the debt).
    const notes = await ensureHealRules(root, []);
    assertEquals(notes.some((n) => n.includes("created") || n.includes("updated")), false);
    assertEquals(notes.some((n) => n.includes("need enrichment") && n.includes("quota-exceeded")), true);

    // Enrich BOTH entries (drop todo) → the nudge stops.
    const path = join(root, "fixtures", "heal-rules.json");
    const r = JSON.parse(await Deno.readTextFile(path));
    r.slugs["quota-exceeded"] = [{ kind: "note", label: "raise the quota", why: "the table's write quota is exhausted" }];
    r.slugs["not-enabled"] = [{ kind: "run-step", match: "/enable/i", why: "the table must be enabled first" }];
    await Deno.writeTextFile(path, JSON.stringify(r, null, 2) + "\n");
    const after = await ensureHealRules(root, []);
    assertEquals(after.some((n) => n.includes("need enrichment")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureHealRules — no endpoints / no slugs → no file", async () => {
  const root = await tempProject();
  try {
    // A spec with a [REQ] but no [ENT] → no endpoint, no heal file.
    await addSpec(
      root,
      "lib",
      "[REQ] util.do(InDto): OutDto\n    [NEW] out\n    db:out.save(OutDto): void\n      boom-failure\n    out.toDto(): OutDto\n\n[DTO] InDto: x\n    in\n[DTO] OutDto: y\n    out\n\n[TYP] x: string\n    x\n[TYP] y: string\n    y\n",
    );
    const notes = await ensureHealRules(root, []);
    assertEquals(notes, []);
    assertEquals(await exists(join(root, "fixtures", "heal-rules.json")), false);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureHealRules — merge keeps human edits, appends new, reports stale", async () => {
  const root = await tempProject();
  try {
    await addSpec(root, "tables", TABLES_SPEC);
    await ensureHealRules(root, []);
    const path = join(root, "fixtures", "heal-rules.json");

    // Human curates `not-enabled` and adds a slug the spec doesn't declare.
    const curated = {
      v: 1,
      slugs: {
        "not-enabled": [{ kind: "run-step", target: "enable", why: "HUMAN" }],
        "quota-exceeded": JSON.parse(await Deno.readTextFile(path)).slugs["quota-exceeded"],
        "hand-added": [{ kind: "note", label: "mine" }],
      },
    };
    await Deno.writeTextFile(path, JSON.stringify(curated, null, 2) + "\n");

    // Add a new fault to the spec, re-run.
    await addSpec(
      root,
      "tables",
      TABLES_SPEC.replace("      quota-exceeded\n", "      quota-exceeded\n      payload-too-large\n"),
    );
    const notes = await ensureHealRules(root, []);

    const rules = JSON.parse(await Deno.readTextFile(path));
    // human edit preserved verbatim
    assertEquals(rules.slugs["not-enabled"], [{ kind: "run-step", target: "enable", why: "HUMAN" }]);
    // new spec slug appended
    assertEquals("payload-too-large" in rules.slugs, true);
    // hand-added slug not in the spec → kept and reported stale
    assertEquals("hand-added" in rules.slugs, true);
    assertEquals(notes.some((n) => n.includes("added 1 new slug(s): payload-too-large")), true);
    assertEquals(notes.some((n) => n.includes("no longer declared") && n.includes("hand-added")), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureHealRules — a non-heal-rules file is left untouched", async () => {
  const root = await tempProject();
  try {
    await addSpec(root, "tables", TABLES_SPEC);
    const dir = join(root, "fixtures");
    await Deno.mkdir(dir, { recursive: true });
    const path = join(dir, "heal-rules.json");
    await Deno.writeTextFile(path, '{ "unrelated": true }\n');
    const notes = await ensureHealRules(root, []);
    assertEquals(await Deno.readTextFile(path), '{ "unrelated": true }\n');
    assertEquals(notes.some((n) => n.includes("not a heal-rules document")), true);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("ensureHealRules — honors KEEP_FIXTURES_DIR override", async () => {
  const root = await tempProject();
  const prev = Deno.env.get("KEEP_FIXTURES_DIR");
  Deno.env.set("KEEP_FIXTURES_DIR", "keep-fixtures");
  try {
    await addSpec(root, "tables", TABLES_SPEC);
    await ensureHealRules(root, []);
    assertEquals(await exists(join(root, "keep-fixtures", "heal-rules.json")), true);
    assertEquals(await exists(join(root, "fixtures", "heal-rules.json")), false);
  } finally {
    if (prev === undefined) Deno.env.delete("KEEP_FIXTURES_DIR");
    else Deno.env.set("KEEP_FIXTURES_DIR", prev);
    await Deno.remove(root, { recursive: true });
  }
});
