import { assert, assertEquals } from "#std/assert";
import { parseBarrelTarget, planSync, polyBarrelNote } from "./mod.ts";

const SPEC = `[MOD] orders
[REQ] orders.place(PlaceDto): OrderDto
    cart.total(): money
    db:store.save(OrderDto): void
    [RET] OrderDto


[NON] cart
    the shopping cart
[TYP] money: number
    a monetary amount

[DTO] PlaceDto: money
    place-order input
[DTO] OrderDto: money
    the resulting order
`;

Deno.test("planSync scaffolds the canonical layout for a fresh module", () => {
  const plan = planSync("specs/orders.rune", SPEC, new Set<string>());
  assertEquals(plan.module, "orders");
  assertEquals(plan.errors, []);

  const created = new Set(plan.toCreate.map((f) => f.path));
  assert(created.has("src/orders/domain/coordinators/orders-place/mod.ts"));
  assert(created.has("src/orders/domain/business/cart/mod.ts"));
  assert(created.has("src/orders/domain/data/store/mod.ts"));
  // <name> binding strips the "Dto" suffix: PlaceDto → dto/place.ts
  assert(created.has("src/orders/dto/place.ts"));
  assert(created.has("src/orders/dto/money.ts"));
  assertEquals(plan.toPrune, []);
});

Deno.test("planSync preserves existing files and prunes orphans", () => {
  const existing = new Set<string>([
    // a filled-in feature the spec still declares → preserved, not pruned
    "src/orders/domain/business/cart/mod.ts",
    // an orphan business feature the spec no longer declares → pruned (folder)
    "src/orders/domain/business/legacy/mod.ts",
    "src/orders/domain/business/legacy/test.ts",
    // an orphan dto file → pruned (file)
    "src/orders/dto/old-dto.ts",
    // an unrelated module → untouched
    "src/billing/domain/business/invoice/mod.ts",
  ]);

  const plan = planSync("specs/orders.rune", SPEC, existing);

  // cart is predicted → skipped (preserved), never pruned
  assert(
    plan.toSkip.some((f) => f.path === "src/orders/domain/business/cart/mod.ts"),
  );
  assert(!plan.toPrune.includes("src/orders/domain/business/cart"));

  // orphans pruned: folder-level for features, file-level for dto
  assert(plan.toPrune.includes("src/orders/domain/business/legacy"));
  assert(plan.toPrune.includes("src/orders/dto/old-dto.ts"));

  // other modules are never touched
  assert(!plan.toPrune.some((p) => p.startsWith("src/billing/")));
});

Deno.test("planSync reports parse errors and plans nothing destructive", () => {
  const plan = planSync(
    "specs/broken.rune",
    "[REQ] no good",
    new Set<string>(),
  );
  assert(plan.errors.length > 0);
  assertEquals(plan.toPrune, []);
});

// ---- WO-8: registry-driven prune policy + dev-owned safety ----

Deno.test("planSync — prunable:false protects a role's orphans from deletion", () => {
  const existing = new Set<string>([
    "src/orders/domain/business/legacy/mod.ts", // dev-owned orphan
    "src/orders/dto/old-dto.ts", // spec-owned orphan
  ]);
  // Forbid pruning business features; dto stays prunable.
  const plan = planSync("specs/orders.rune", SPEC, existing, {
    policies: { "business-impl": { prunable: false } },
  });
  assert(!plan.toPrune.includes("src/orders/domain/business/legacy"));
  assert(plan.toPrune.includes("src/orders/dto/old-dto.ts"));
});

Deno.test("planSync — splits dev-owned orphans into toPruneOwned", () => {
  const existing = new Set<string>([
    "src/orders/domain/business/legacy/mod.ts", // dev-owned feature dir
    "src/orders/dto/old-dto.ts", // spec-owned dto file
  ]);
  const plan = planSync("specs/orders.rune", SPEC, existing);
  // dev-owned feature dir needs --force; dto file is safe to prune
  assert(plan.toPruneOwned.includes("src/orders/domain/business/legacy"));
  assert(!plan.toPruneOwned.includes("src/orders/dto/old-dto.ts"));
  // toPrune still lists both (back-compat)
  assert(plan.toPrune.includes("src/orders/domain/business/legacy"));
  assert(plan.toPrune.includes("src/orders/dto/old-dto.ts"));
});

const PLY_SPEC = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(id): data
        [CSE] genie
        ex:provider.search(id): SearchDto
        [CSE] fiveNine
        ex:provider.search(id): SearchDto`;

Deno.test("planSync — a removed [CSE] arm's implementations/<case>/ is a dev-owned orphan", () => {
  const base = "src/recording/domain/business/provider";
  const existing = new Set([
    `${base}/base/mod.ts`,
    `${base}/poly-mod.ts`,
    `${base}/implementations/genie/mod.ts`,
    `${base}/implementations/genie/test.ts`,
    `${base}/implementations/five-nine/mod.ts`,
    // a [CSE] arm the spec no longer declares — must become an orphan:
    `${base}/implementations/legacy/mod.ts`,
    `${base}/implementations/legacy/test.ts`,
  ]);
  const plan = planSync("specs/recording.rune", PLY_SPEC, existing);
  assertEquals(plan.errors, []);

  const legacy = `${base}/implementations/legacy`;
  // The removed arm is pruned — and dev-owned, so the entrypoint holds it back until --force.
  assert(plan.toPrune.includes(legacy), "removed [CSE] folder must be an orphan");
  assert(
    plan.toPruneOwned.includes(legacy),
    "removed [CSE] folder is dev-owned (--force gated)",
  );

  // Declared arms and the structural files must survive.
  assert(!plan.toPrune.includes(`${base}/implementations/genie`));
  assert(!plan.toPrune.includes(`${base}/implementations/five-nine`));
  assert(!plan.toPrune.includes(base), "the [PLY] feature dir itself is kept");
  assert(
    !plan.toPrune.some((p) => p === `${base}/base` || p.endsWith("/poly-mod.ts")),
    "base/ and the poly-mod barrel are not swept",
  );
});

Deno.test("parseBarrelTarget — reads the generated re-export, null on hand-rewrites", () => {
  assertEquals(
    parseBarrelTarget('export { default } from "./implementations/wyn/mod.ts";'),
    "wyn",
  );
  assertEquals(
    parseBarrelTarget("export { default } from './implementations/five-nine/mod.ts'"),
    "five-nine",
  );
  // A hand-rewritten runtime-switch barrel can't be read statically — skip, don't guess.
  assertEquals(
    parseBarrelTarget("export default pick(process.env.PROVIDER);"),
    null,
  );
  // A commented-out old generated line must NOT be read as the live re-export (false warning).
  assertEquals(
    parseBarrelTarget(
      '// export { default } from "./implementations/legacy/mod.ts";\nexport default pick(genie);',
    ),
    null,
  );
  assertEquals(
    parseBarrelTarget(
      '/* old: export { default } from "./implementations/legacy/mod.ts"; */\nimport g from "./implementations/genie/mod.ts";\nexport default g;',
    ),
    "genie",
  );
});

Deno.test("polyBarrelNote — warns on an absent or undeclared variant, silent when fine", () => {
  const dir = "src/recording/domain/business/provider";
  const cases = new Set(["genie", "five-nine"]);
  // points at a current, declared, existing variant → no warning
  assertEquals(polyBarrelNote(dir, "genie", cases, true), null);
  // points at a variant whose folder is gone (e.g. --force just pruned it) → warn
  const gone = polyBarrelNote(dir, "wyn", cases, false);
  assert(gone && gone.includes("no longer exists"), "absent folder must warn");
  // folder still on disk but no [CSE] declares it → warn to repoint
  const undeclared = polyBarrelNote(dir, "wyn", cases, true);
  assert(
    undeclared && undeclared.includes("no [CSE] declares"),
    "undeclared variant must warn",
  );
});
