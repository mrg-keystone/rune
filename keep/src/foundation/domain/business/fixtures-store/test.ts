import { assert, assertEquals } from "#assert";
import {
  type CakeFixtures,
  emptyFixtures,
  mergeFixtures,
  normalizeFixtures,
  normalizeHealRules,
  readFixtures,
  readHealRules,
  readScenarios,
  scenarioSlug,
  writeFixtures,
  writeScenario,
} from "./mod.ts";

Deno.test("normalizeFixtures - coerces junk and partial shapes to the empty artifact's fields", () => {
  assertEquals(normalizeFixtures(null), emptyFixtures());
  assertEquals(normalizeFixtures("nope"), emptyFixtures());
  assertEquals(normalizeFixtures([]), emptyFixtures());
  // variables that aren't an object are dropped; modules with a non-array setup become [].
  assertEquals(
    normalizeFixtures({ variables: 7, modules: { m: { setup: "x" } } }),
    { v: 1, variables: {}, modules: { m: { setup: [] } } },
  );
  // setup entries without a string id are filtered out.
  assertEquals(
    normalizeFixtures({ modules: { m: { setup: [{ id: "a" }, { bad: 1 }] } } }),
    { v: 1, variables: {}, modules: { m: { setup: [{ id: "a" }] } } },
  );
});

Deno.test("mergeFixtures - replaces only the patched module's setup, keeps the others", () => {
  const existing: CakeFixtures = {
    v: 1,
    variables: { tenantId: "t-1" },
    modules: {
      orders: { setup: [{ id: "seed" }] },
      members: { setup: [{ id: "enroll" }] },
    },
  };
  const merged = mergeFixtures(existing, {
    module: "orders",
    setup: [{ id: "createTenant", body: "{}" }],
    variables: { tenantId: "t-2", apiBase: "http://x" },
  });
  // orders' setup is replaced; members' is untouched.
  assertEquals(merged.modules.orders.setup, [{
    id: "createTenant",
    body: "{}",
  }]);
  assertEquals(merged.modules.members.setup, [{ id: "enroll" }]);
  // variables are replaced wholesale (the patch carries the complete persisted set).
  assertEquals(merged.variables, { tenantId: "t-2", apiBase: "http://x" });
});

Deno.test("mergeFixtures - a patch without variables keeps the existing ones; empty setup clears", () => {
  const merged = mergeFixtures(
    {
      v: 1,
      variables: { keep: "me" },
      modules: { orders: { setup: [{ id: "a" }] } },
    },
    { module: "orders" }, // no setup, no variables
  );
  assertEquals(merged.variables, { keep: "me" });
  assertEquals(merged.modules.orders.setup, []);
});

Deno.test("readFixtures - missing file yields the empty artifact (never throws)", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readFixtures(dir), emptyFixtures());
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("writeFixtures + readFixtures - round-trips, creates the dir, stamps savedAt", async () => {
  const base = await Deno.makeTempDir();
  const dir = `${base}/nested/fixtures`; // does not exist yet — must be created
  try {
    const data = mergeFixtures(emptyFixtures(), {
      module: "orders",
      setup: [{
        id: "createTenant",
        body: '{"name":"acme"}',
        params: { region: "eu" },
      }],
      variables: { tenantId: "t-9" },
    });
    const written = await writeFixtures(data, dir, 1234);
    assertEquals(written.savedAt, 1234);

    const round = await readFixtures(dir);
    assertEquals(round.variables, { tenantId: "t-9" });
    assertEquals(round.modules.orders.setup, [
      { id: "createTenant", body: '{"name":"acme"}', params: { region: "eu" } },
    ]);
    // The file is pretty-printed JSON at <dir>/cake.json.
    const raw = await Deno.readTextFile(`${dir}/cake.json`);
    assert(raw.includes("\n  "), "expected pretty-printed JSON");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

// ── asserts in the cake.json artifact ─────────────────────────────────────────

Deno.test("normalize/merge - asserts ride the module slice; junk specs are dropped", () => {
  const merged = mergeFixtures(emptyFixtures(), {
    module: "orders",
    setup: [],
    asserts: {
      create: { status: "201", checks: [{ path: "id", op: "exists" }] },
      junk: { checks: "nope" } as unknown as never,
      empty: { checks: [] },
    },
  });
  assertEquals(merged.modules.orders.asserts, {
    create: { status: "201", checks: [{ path: "id", op: "exists" }] },
  });
  // Round-trips through normalize (a hand-edited file keeps the same shape).
  const normalized = normalizeFixtures(JSON.parse(JSON.stringify(merged)));
  assertEquals(normalized.modules.orders.asserts!.create.status, "201");
});

// ── heal rules (fixtures/heal-rules.json) ─────────────────────────────────────

Deno.test("normalizeHealRules - keeps rule arrays with a kind, drops junk, tolerates extra fields", () => {
  assertEquals(normalizeHealRules(null), { v: 1, slugs: {} });
  assertEquals(normalizeHealRules({ slugs: "x" }), { v: 1, slugs: {} });
  const rules = normalizeHealRules({
    v: 1,
    slugs: {
      "not-enabled": [
        {
          kind: "run-step",
          match: "/enable/i",
          why: "track first",
          todo: true,
        },
        "junk",
        { noKind: 1 },
      ],
      "all-junk": ["a", 1],
    },
  });
  // The rune generator's forward-compat marker (todo) survives normalization untouched.
  assertEquals(rules.slugs["not-enabled"], [
    {
      kind: "run-step",
      match: "/enable/i",
      why: "track first",
      todo: true,
    } as unknown as never,
  ]);
  assertEquals(rules.slugs["all-junk"], undefined);
});

Deno.test("readHealRules - missing file yields the empty rule set", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readHealRules(dir), { v: 1, slugs: {} });
    await Deno.writeTextFile(
      `${dir}/heal-rules.json`,
      JSON.stringify({ v: 1, slugs: { "not-found": [{ kind: "retry" }] } }),
    );
    assertEquals((await readHealRules(dir)).slugs["not-found"], [{
      kind: "retry",
    }]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── scenarios (fixtures/scenarios/<name>.json) ────────────────────────────────

Deno.test("scenarioSlug - names become safe filename stems", () => {
  assertEquals(scenarioSlug("Happy Path (EU)"), "happy-path-eu");
  // An empty-base name still produces a non-empty stem, but distinct empty-base names must NOT
  // collapse to one constant stem (that was the cross-scenario overwrite bug).
  assert(scenarioSlug("---").startsWith("scenario"));
  assert(
    scenarioSlug("---") !== scenarioSlug("@@@"),
    "distinct empty-base names get distinct stems",
  );
});

Deno.test("scenarioSlug - distinct non-ASCII names get distinct stems (no collision)", () => {
  // CJK / accented names must NOT all collapse to one constant stem.
  assert(scenarioSlug("你好") !== scenarioSlug("世界"));
  assert(scenarioSlug("Café EU") !== "");
  // The é survives (not stripped as an ASCII-only class would).
  assert(scenarioSlug("Café EU") !== scenarioSlug("Caf EU"));
});

Deno.test("write/readScenarios - two distinct non-ASCII-named scenarios do NOT overwrite each other", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeScenario(
      { v: 1, name: "你好", module: "orders", steps: [{ id: "a" }] },
      dir,
    );
    await writeScenario(
      { v: 1, name: "世界", module: "orders", steps: [{ id: "b" }] },
      dir,
    );
    const list = await readScenarios(dir);
    const names = list.map((s) => s.name).sort();
    assertEquals(names, ["世界", "你好"], "both scenarios survive on disk");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("write/readScenarios - round-trips files; invalid files are skipped, list sorted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeScenario(
      {
        v: 1,
        name: "refund flow",
        module: "orders",
        flow: "card",
        steps: [{ id: "create", body: "{}" }],
      },
      dir,
      111,
    );
    await writeScenario(
      {
        v: 1,
        name: "happy path",
        module: "orders",
        steps: [{ id: "create", skip: true }],
      },
      dir,
      222,
    );
    // An invalid scenario file must not hide the others.
    await Deno.writeTextFile(`${dir}/scenarios/broken.json`, "not json {{");
    const list = await readScenarios(dir);
    assertEquals(list.map((s) => s.name), ["happy path", "refund flow"]);
    assertEquals(list[1].flow, "card");
    assertEquals(list[1].savedAt, 111);
    assertEquals(list[0].steps, [{ id: "create", skip: true }]);
    // Same-name save overwrites (one file per slug).
    await writeScenario(
      { v: 1, name: "happy path", module: "orders", steps: [] },
      dir,
      333,
    );
    const after = await readScenarios(dir);
    assertEquals(after.length, 2);
    assertEquals(after[0].savedAt, 333);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("readScenarios - missing directory yields []", async () => {
  const dir = await Deno.makeTempDir();
  try {
    assertEquals(await readScenarios(dir), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("normalize/merge - a module-qualified setup step survives the round-trip", () => {
  const merged = mergeFixtures(emptyFixtures(), {
    module: "greet",
    setup: [
      { id: "hello" }, // own module — no qualifier
      { id: "mintMember", module: "mint", body: "{}" }, // cross-module setup
    ],
  });
  assertEquals(merged.modules.greet.setup, [
    { id: "hello" },
    { id: "mintMember", module: "mint", body: "{}" },
  ]);
  const round = normalizeFixtures(JSON.parse(JSON.stringify(merged)));
  assertEquals(round.modules.greet.setup[1].module, "mint");
});
