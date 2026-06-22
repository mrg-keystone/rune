import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { artifactToOptions, DEFAULT_TEMPLATES, planManifest } from "./mod.ts";
import type { SrvNode } from "@rune/domain/business/rune-parse/mod.ts";

Deno.test("planManifest — coordinator + DTO + TYP for a simple rune", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id

[DTO] InDto: providerName, externalId
    desc

[TYP] id: string
    desc
[TYP] providerName: string
    desc
[TYP] externalId: string
    desc`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  assertEquals(plan.errors, []);
  assertEquals(plan.module, "recording");
  const paths = plan.toCreate.map((f) => f.path);
  // coordinator
  assertEquals(
    paths.includes("src/recording/domain/coordinators/recording-set/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes(
      "src/recording/domain/coordinators/recording-set/int.test.ts",
    ),
    true,
  );
  // business feature for "id"
  assertEquals(paths.includes("src/recording/domain/business/id/mod.ts"), true);
  assertEquals(
    paths.includes("src/recording/domain/business/id/test.ts"),
    true,
  );
  // dto file with stripped Dto
  assertEquals(paths.includes("src/recording/dto/in.ts"), true);
  // typ file
  assertEquals(paths.includes("src/recording/dto/id.ts"), true);
  // mod-root — regenerated every sync now (was create-once), so it lands in toRegenerate
  assertEquals(
    plan.toRegenerate.map((f) => f.path).includes("src/recording/mod-root.ts"),
    true,
  );
});

Deno.test("planManifest — boundary calls produce adapter folders", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
    os:storage.save(id, data): void`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(
    paths.includes("src/recording/domain/data/metadata/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/data/metadata/smk.test.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/data/storage/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/data/storage/smk.test.ts"),
    true,
  );
});

Deno.test("planManifest — [PLY] generates base, implementations, poly-mod", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(id): data
        [CSE] genie
        ex:provider.search(id): SearchDto
        [CSE] fiveNine
        ex:provider.search(id): SearchDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(
    paths.includes("src/recording/domain/business/provider/base/mod.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/business/provider/base/test.ts"),
    true,
  );
  assertEquals(
    paths.includes("src/recording/domain/business/provider/poly-mod.ts"),
    true,
  );
  assertEquals(
    paths.includes(
      "src/recording/domain/business/provider/implementations/genie/mod.ts",
    ),
    true,
  );
  assertEquals(
    paths.includes(
      "src/recording/domain/business/provider/implementations/five-nine/mod.ts",
    ),
    true,
  );
});

Deno.test("planManifest — [PLY] noun does NOT produce a flat business mod.ts", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    [PLY] provider.getRecording(id): data
        [CSE] genie
        ex:provider.search(id): SearchDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  // The poly noun "provider" lives at base/mod.ts, not business/provider/mod.ts.
  assertEquals(
    paths.includes("src/recording/domain/business/provider/mod.ts"),
    false,
  );
});

Deno.test("planManifest — [ENT] produces entrypoint folder", () => {
  const rune = `[MOD] recording

[ENT] http.postRecording(InDto): IdDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(paths.includes("src/recording/entrypoints/http/mod.ts"), true);
  assertEquals(
    paths.includes("src/recording/entrypoints/http/e2e.test.ts"),
    true,
  );
});

Deno.test("planManifest — [ENT]s on one surface become one keep controller", () => {
  const rune = `[MOD] checkout

[ENT] http.createOrder(NewOrderDto): OrderDto
[ENT] http.payOrder(PayDto): ReceiptDto

[REQ] order.create(NewOrderDto): OrderDto
    [NEW] order
    [RET] OrderDto

[REQ] payment.pay(PayDto): ReceiptDto
    [NEW] payment
    [RET] ReceiptDto

[DTO] NewOrderDto: item
    a new order
[DTO] OrderDto: id, item
    a created order
[DTO] PayDto: id
    a payment
[DTO] ReceiptDto: receipt
    a receipt

[TYP] item: string
    x
[TYP] id: string
    x
[TYP] receipt: string
    x`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/checkout/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // Both [ENT]s land in ONE controller (no path collision).
  assertEquals(
    plan.toCreate.filter((f) => f.path.startsWith("src/checkout/entrypoints/")).map((f) => f.path)
      .sort(),
    ["src/checkout/entrypoints/http/e2e.test.ts", "src/checkout/entrypoints/http/mod.ts"],
  );
  assertStringIncludes(mod.content, '@EndpointController("http")');
  assertStringIncludes(mod.content, "export class HttpController");
  assertStringIncludes(mod.content, "createOrder(body: NewOrderDto): Promise<OrderDto>");
  assertStringIncludes(mod.content, "payOrder(body: PayDto): Promise<ReceiptDto>");
  // distinct sub-path per endpoint (the action) so routes don't collide.
  assertStringIncludes(mod.content, 'path: "create-order", input: NewOrderDto, output: OrderDto, order: 1');
  // order/dependsOn/bind auto-derived from the DTO field graph (PayDto.id <- OrderDto.id).
  assertStringIncludes(
    mod.content,
    'path: "pay-order", input: PayDto, output: ReceiptDto, order: 2, dependsOn: ["createOrder"], bind: {"id":"createOrder.id"}',
  );
  // Delegates to the (input,output)-matched coordinators.
  assertStringIncludes(mod.content, "return orderCreate(body)");
  assertStringIncludes(mod.content, "return paymentPay(body)");
  assertStringIncludes(mod.content, 'from "@mrg-keystone/keep"');
  assertStringIncludes(mod.content, 'endpointModule("Checkout", [HttpController])');
});

Deno.test("planManifest — [ENT:flow] branches: flows, the OR-join, and [ENT:optional]", () => {
  const rune = `[MOD] checkout

[ENT] http.start(StartDto): TicketDto
[ENT:card] http.payCard(PayDto): PaymentDto
[ENT:cash] http.payCash(PayDto): PaymentDto
[ENT] http.fulfill(FulfillDto): DoneDto
[ENT:optional] http.survey(SurveyDto): DoneDto

[DTO] StartDto: item
    what to buy
[DTO] TicketDto: ticketId
    the started checkout
[DTO] PayDto: ticketId
    the checkout to pay
[DTO] PaymentDto: paymentId
    a settled payment
[DTO] FulfillDto: paymentId
    the payment to fulfill
[DTO] DoneDto: done
    completion
[DTO] SurveyDto: rating
    feedback

[TYP] item: string
    x
[TYP] ticketId: string
    x
[TYP] paymentId: string
    x
[TYP] done: boolean
    x
[TYP] rating: number
    x`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/checkout/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // The branch steps carry their flow; both bind the shared upstream ticket.
  assertStringIncludes(
    mod.content,
    'dependsOn: ["start"], bind: {"ticketId":"start.ticketId"}, flows: "card"',
  );
  assertStringIncludes(
    mod.content,
    'dependsOn: ["start"], bind: {"ticketId":"start.ticketId"}, flows: "cash"',
  );
  // The join: producers in different flows are alternatives — depend on all, bind as an array.
  assertStringIncludes(
    mod.content,
    'dependsOn: ["payCard","payCash"], bind: {"paymentId":["payCard.paymentId","payCash.paymentId"]}',
  );
  // [ENT:optional] marks the step attempted-but-not-required.
  assertStringIncludes(mod.content, "optional: true");
});

Deno.test("planManifest — [TYP:ext] turns an unproduced field into a $external-input bind", () => {
  const rune = `[MOD] billing

[ENT] http.join(JoinDto): MembershipDto

[DTO] JoinDto: tenantId, plan
    a membership request
[DTO] MembershipDto: membershipId
    the created membership

[TYP:ext] tenantId: string
    minted by the tenants module
[TYP] plan: string
    x
[TYP] membershipId: string
    x`;
  const plan = planManifest("specs/billing.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/billing/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // tenantId has no producer and is [TYP:ext] ⇒ a $tenantId external-input bind, no dependsOn.
  assertStringIncludes(mod.content, 'bind: {"tenantId":"$tenantId"}');
  // plan is also unproduced but NOT ext ⇒ stays unbound (a plain editor field).
  assertEquals(mod.content.includes('"plan":'), false);
  assertEquals(mod.content.includes("dependsOn"), false);
});

Deno.test("planManifest — [TYP:ext] seeds the generated e2e with a typed placeholder", () => {
  const rune = `[MOD] checkout

[ENT] http.join(JoinDto): MembershipDto

[DTO] JoinDto: memberId
    a membership request
[DTO] MembershipDto: membershipId
    the created membership

[TYP:ext] memberId: string
    minted elsewhere
[TYP] membershipId: string
    x`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  const e2e = plan.toCreate.find((f) => f.path === "src/checkout/entrypoints/http/e2e.test.ts");
  if (!e2e) throw new Error("no entrypoint e2e.test.ts generated");

  // The $memberId external input gets a string placeholder seed in isolation.
  assertStringIncludes(e2e.content, 'overrides: { seeds: { memberId: "memberId-stub" } }');
});

Deno.test("planManifest — bind derivation breaks a producer cycle with a $input fallback", () => {
  // enable consumes `selected` (select mints it); select consumes `enabled` (enable mints it).
  // Earliest-producer-wins keeps enable→select; the edge that would close the cycle (select→enable)
  // is dropped and `enabled` falls back to a $input bind instead of a circular dependsOn.
  const rune = `[MOD] meta

[ENT] http.enable(EnableDto): EnabledDto
[ENT] http.select(SelectDto): SelectedDto

[DTO] EnableDto: selected
    needs the selection
[DTO] EnabledDto: enabled
    the enabled flag
[DTO] SelectDto: enabled
    needs the enabled flag
[DTO] SelectedDto: selected
    the selection

[TYP] selected: string
    x
[TYP] enabled: string
    x`;
  const plan = planManifest("specs/meta.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const mod = plan.toCreate.find((f) =>
    f.path === "src/meta/entrypoints/http/mod.ts"
  );
  if (!mod) throw new Error("no entrypoint mod.ts generated");
  // The first consumer keeps its producer edge.
  assertStringIncludes(
    mod.content,
    'dependsOn: ["select"], bind: {"selected":"select.selected"}',
  );
  // The cycle-closing edge is gone; select's field is supplied externally instead.
  assertStringIncludes(mod.content, 'bind: {"enabled":"$enabled"}');
  assertEquals(mod.content.includes('dependsOn: ["enable"]'), false);
});

Deno.test("planManifest — ({}) input omits @Endpoint input and makes a no-param handler", () => {
  const rune = `[MOD] ticker

[ENT] http.refresh({}): StatusDto

[DTO] StatusDto: count
    how many

[TYP] count: number
    x`;
  const plan = planManifest("specs/ticker.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const mod = plan.toCreate.find((f) =>
    f.path === "src/ticker/entrypoints/http/mod.ts"
  );
  if (!mod) throw new Error("no entrypoint mod.ts generated");
  // `input: {}` (TS2740) is gone and the handler takes no body.
  assertEquals(mod.content.includes("input: {}"), false);
  assertStringIncludes(mod.content, "refresh(): Promise<StatusDto>");
});

Deno.test("planManifest — ambiguous ENT→[REQ] delegation (same signature) is an error", () => {
  // Two [REQ]s share (InDto): CatalogDto, so the ent's (input, output) match is ambiguous.
  const rune = `[MOD] catalog

[ENT] http.fetch(InDto): CatalogDto

[REQ] catalog.list(InDto): CatalogDto
    items::compute(x): items
[REQ] catalog.discover(InDto): CatalogDto
    items::compute(x): items

[DTO] InDto: x
    in
[DTO] CatalogDto: items
    out

[TYP] x: string
    a
[TYP] items: string
    b`;
  const plan = planManifest("specs/catalog.rune", rune, new Set());
  assertEquals(plan.errors.length > 0, true);
  assertStringIncludes(plan.errors.join("\n"), "ambiguous");
});

Deno.test("planManifest — documented [ENT] body [REQ] delegates (no stepless shadow)", () => {
  // The indented [REQ] is the ent's delegation target, NOT a second stepless coordinator.
  const rune = `[MOD] recording

[ENT] http.postRecording(GetRecordingDto): IdDto
    [REQ] recording.set(GetRecordingDto): IdDto

[REQ] recording.set(GetRecordingDto): IdDto
    db:store.lookup(name): id

[DTO] GetRecordingDto: name
    in
[DTO] IdDto: id
    out

[TYP] name: string
    a
[TYP] id: string
    b`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  // No shadow REQ, so no ambiguity error and codegen succeeds.
  assertEquals(plan.errors, []);
  const mod = plan.toCreate.find((f) =>
    f.path === "src/recording/entrypoints/http/mod.ts"
  );
  if (!mod) throw new Error("no entrypoint mod.ts generated");
  // The ent delegates to the named coordinator.
  assertStringIncludes(mod.content, "return recordingSet(body)");
  // And the generated coordinator is the REAL block (has its reads), not an empty shadow.
  const coord = plan.toCreate.find((f) =>
    f.path === "src/recording/domain/coordinators/recording-set/mod.ts"
  );
  if (!coord) throw new Error("no coordinator generated");
  assertStringIncludes(coord.content, "// reads");
});

Deno.test("planManifest — number-typed [TYP:ext] seeds a numeric placeholder", () => {
  const rune = `[MOD] billing

[ENT] http.charge(ChargeDto): ReceiptDto

[DTO] ChargeDto: amount, memberId
    a charge request
[DTO] ReceiptDto: receiptId
    the receipt

[TYP:ext] amount: number
    set by the caller
[TYP:ext] memberId: string
    minted elsewhere
[TYP] receiptId: string
    x`;
  const plan = planManifest("specs/billing.rune", rune, new Set());
  const e2e = plan.toCreate.find((f) => f.path === "src/billing/entrypoints/http/e2e.test.ts");
  if (!e2e) throw new Error("no entrypoint e2e.test.ts generated");

  // Seeds are sorted by name; number TYPs get a numeric placeholder, strings a stub.
  assertStringIncludes(
    e2e.content,
    'overrides: { seeds: { amount: 7, memberId: "memberId-stub" } }',
  );
});

Deno.test("planManifest — no [TYP:ext] inputs ⇒ generated e2e has no overrides", () => {
  const rune = `[MOD] recording

[ENT] http.create(InDto): OutDto

[DTO] InDto: providerName
    in
[DTO] OutDto: id
    out

[TYP] providerName: string
    x
[TYP] id: string
    x`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const e2e = plan.toCreate.find((f) => f.path === "src/recording/entrypoints/http/e2e.test.ts");
  if (!e2e) throw new Error("no entrypoint e2e.test.ts generated");

  assertEquals(e2e.content.includes("overrides:"), false);
  assertStringIncludes(e2e.content, "exerciseEndpoints({ api });");
});

Deno.test("planManifest — :core DTO routes to src/core/dto/", () => {
  const rune = `[MOD] recording

[DTO:core] CommonDto: a, b
    desc

[TYP:core] timestamp: number
    desc`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const paths = plan.toCreate.map((f) => f.path);
  assertEquals(paths.includes("src/core/dto/common.ts"), true);
  assertEquals(paths.includes("src/core/dto/timestamp.ts"), true);
});

Deno.test("planManifest — idempotent: existing files go to toSkip", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id`;
  const existing = new Set([
    "src/recording/domain/coordinators/recording-set/mod.ts",
    "src/recording/domain/business/id/mod.ts",
  ]);
  const plan = planManifest("specs/recording.rune", rune, existing);
  assertEquals(
    plan.toSkip.some((f) =>
      f.path === "src/recording/domain/coordinators/recording-set/mod.ts"
    ),
    true,
  );
  assertEquals(
    plan.toSkip.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    true,
  );
  // Other files still go to toCreate
  assertEquals(
    plan.toCreate.some((f) =>
      f.path === "src/recording/domain/business/id/test.ts"
    ),
    true,
  );
});

Deno.test("planManifest — content includes the verb signature", () => {
  const rune = `[MOD] recording

[REQ] recording.set(GetRecordingDto): IdDto
    id::create(name): id`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const coord = plan.toCreate.find((f) =>
    f.path.endsWith("recording-set/mod.ts")
  );
  assertEquals(coord !== undefined, true);
  assertEquals(coord!.content.includes("function set"), true);
  assertEquals(coord!.content.includes("GetRecordingDto"), true);
  assertEquals(coord!.content.includes("IdDto"), true);
});

Deno.test("planManifest — int.test.ts has one Deno.test per fault", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id
      invalid-id
    db:metadata.set(id, x): void
      timed-out network-error`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const intTest = plan.toCreate.find((f) =>
    f.path.endsWith("recording-set/int.test.ts")
  );
  assertEquals(intTest !== undefined, true);
  assertEquals(intTest!.content.includes(`Deno.test("invalid-id"`), true);
  assertEquals(intTest!.content.includes(`Deno.test("timed-out"`), true);
  assertEquals(intTest!.content.includes(`Deno.test("network-error"`), true);
});

Deno.test("planManifest — adapter smk.test.ts has one Deno.test per fault", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
      timed-out network-error`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const smk = plan.toCreate.find((f) =>
    f.path.endsWith("data/metadata/smk.test.ts")
  );
  assertEquals(smk !== undefined, true);
  assertEquals(smk!.content.includes(`Deno.test("timed-out"`), true);
  assertEquals(smk!.content.includes(`Deno.test("network-error"`), true);
});

Deno.test("planManifest — DTO is a class-validator class with typed fields", () => {
  const rune = `[MOD] recording

[TYP] providerName: string
    p
[TYP] externalId: string
    e
[DTO] GetRecordingDto: providerName, externalId
    input dto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const dto = plan.toCreate.find((f) =>
    f.path.endsWith("dto/get-recording.ts")
  );
  assertEquals(dto !== undefined, true);
  assertEquals(dto!.content.includes("export class GetRecordingDto"), true);
  assertEquals(dto!.content.includes('from "class-validator"'), true);
  assertEquals(dto!.content.includes("@IsString()"), true);
  assertEquals(dto!.content.includes("providerName!: string"), true);
  assertEquals(dto!.content.includes("externalId!: string"), true);
  // no class-transformer @Expose noise
  assertEquals(dto!.content.includes("@Expose"), false);
});

Deno.test("planManifest — DTO field modifiers: (s) -> array, ? -> optional", () => {
  const rune = `[MOD] lists

[TYP] taskId: string
    t
[TYP] note: string
    n
[DTO] ListDto: taskId(s), note?
    a list`;
  const plan = planManifest("specs/lists.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path.endsWith("dto/list.ts"));
  assertEquals(dto !== undefined, true);
  // `(s)` pluralizes the property and types it as an array of the base [TYP],
  // with element-wise validation.
  assertEquals(dto!.content.includes("taskIds!: string[]"), true);
  assertEquals(dto!.content.includes("@IsArray()"), true);
  assertEquals(dto!.content.includes("@IsString({ each: true })"), true);
  // `?` makes the field optional (TS `?:` + @IsOptional()).
  assertEquals(dto!.content.includes("note?: string"), true);
  assertEquals(dto!.content.includes("@IsOptional()"), true);
  // the raw modifier syntax must never leak into a field DECLARATION (it may
  // legitimately appear in an explanatory `// rune:` comment).
  assertEquals(/\(s\)[!?:]/.test(dto!.content), false);
});

Deno.test("planManifest — renderDto maps [TYP] primitives to validators; unmapped gets @Allow", () => {
  const rune = `[MOD] m

[TYP] name: string
    n
[TYP] age: number
    a
[TYP] active: boolean
    b
[DTO] PersonDto: name, age, active, mystery
    a person`;
  const plan = planManifest("specs/m.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path.endsWith("dto/person.ts"));
  assertEquals(dto !== undefined, true);
  const c = dto!.content;
  // each primitive [TYP] -> its class-validator decorator + concrete TS type
  assertEquals(c.includes("@IsString()"), true);
  assertEquals(c.includes("name!: string"), true);
  assertEquals(c.includes("@IsNumber()"), true);
  assertEquals(c.includes("age!: number"), true);
  assertEquals(c.includes("@IsBoolean()"), true);
  assertEquals(c.includes("active!: boolean"), true);
  // unmapped field (no [TYP]) -> `unknown` + @Allow() (assert validates with
  // whitelist: true — an undecorated field would be silently stripped) and a
  // visible TODO marker.
  assertEquals(c.includes("mystery!: unknown"), true);
  assertEquals(c.includes("TODO: tighten"), true);
  assertStringIncludes(c, '// TODO: tighten — "mystery" has no [TYP], left as unknown\n  // Add `[TYP] mystery: <type>` to the .rune to type it.\n  @Allow()\n  mystery!: unknown;');
  // imports are the sorted union of the decorators actually used
  assertEquals(
    c.includes('import { Allow, IsBoolean, IsNumber, IsString } from "class-validator";'),
    true,
  );
});

Deno.test("planManifest — mod-root re-exports each REQ verb", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id


[REQ] recording.get(InDto): OutDto
    id::create(name): id`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const modRoot = plan.toRegenerate.find((f) =>
    f.path === "src/recording/mod-root.ts"
  );
  assertEquals(modRoot !== undefined, true);
  assertEquals(modRoot!.content.includes("export { set }"), true);
  assertEquals(modRoot!.content.includes("export { get }"), true);
});

// Bug report 2026-06-14 (Datrix) #3: two [REQ]s with different nouns but the
// SAME verb both re-exported `resolve` from mod-root.ts -> TS2300 duplicate
// identifier. The colliding re-exports must be noun-qualified; unique verbs
// stay bare.
Deno.test("planManifest — mod-root disambiguates same-verb REQs across nouns", () => {
  const rune = `[MOD] acc

[REQ] access.resolve(InDto): OutDto
    [NEW] access
    access.run(InDto): OutDto
    access.toDto(): OutDto

[REQ] rules.resolve(InDto): OutDto
    [NEW] rules
    rules.run(InDto): OutDto
    rules.toDto(): OutDto

[REQ] audit.scan(InDto): OutDto
    [NEW] audit
    audit.run(InDto): OutDto
    audit.toDto(): OutDto

[TYP] id: string
    an id
[DTO] InDto: id
    in
[DTO] OutDto: id
    out`;
  const plan = planManifest("specs/acc.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const c = plan.toRegenerate.find((f) => f.path === "src/acc/mod-root.ts")!.content;
  // colliding verb -> noun-qualified alias
  assertStringIncludes(c, "export { resolve as accessResolve } from \"./domain/coordinators/access-resolve/mod.ts\";");
  assertStringIncludes(c, "export { resolve as rulesResolve } from \"./domain/coordinators/rules-resolve/mod.ts\";");
  // a unique verb is untouched (no needless alias)
  assertStringIncludes(c, "export { scan } from \"./domain/coordinators/audit-scan/mod.ts\";");
  // never a bare duplicate
  assertEquals(c.includes("export { resolve } from"), false);
});

Deno.test("planManifest — missing [MOD] yields error", () => {
  const rune = `[REQ] x.y(InDto): OutDto
    a::b(c): d`;
  const plan = planManifest("just/random.rune", rune, new Set());
  // No [MOD], path doesn't match spec convention → no module derived → error
  assertEquals(plan.errors.length > 0, true);
  assertEquals(plan.toCreate.length, 0);
});

Deno.test("planManifest — boundary noun deduped across multiple calls", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    db:metadata.set(id, x): void
    db:metadata.get(id): MetaDto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const adapterMods = plan.toCreate.filter((f) =>
    f.path.endsWith("data/metadata/mod.ts")
  );
  assertEquals(adapterMods.length, 1);
});

// ---- nested DTOs: @ValidateNested/@Type + isCore-aware imports ----

Deno.test("planManifest — nested DTO fields: convention, [TYP] alias, (s) arrays, core path", () => {
  const rune = `[MOD] orders

[TYP] qty: number
    q
[TYP] sku: string
    s
[TYP] payment: PaymentDto
    alias to a dto
[DTO] LineItemDto: sku, qty
    one line
[DTO] PaymentDto: sku
    pay info
[DTO:core] AuditDto: sku
    shared audit record
[DTO] OrderDto: lineItem(s), payment, audit
    an order`;
  const plan = planManifest("specs/orders.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/orders/dto/order.ts");
  if (!dto) throw new Error("no order.ts generated");
  const c = dto.content;
  // @Type reads Reflect metadata at decoration time — side-effect import first.
  assertStringIncludes(c, 'import "reflect-metadata";\nimport { Type } from "class-transformer";');
  // The sorted one-line class-validator import.
  assertStringIncludes(c, 'import { IsArray, ValidateNested } from "class-validator";');
  // Nested classes are value imports; the :core one routes to src/core/dto.
  assertStringIncludes(c, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
  assertStringIncludes(c, 'import { LineItemDto } from "@/src/orders/dto/line-item.ts";');
  assertStringIncludes(c, 'import { PaymentDto } from "@/src/orders/dto/payment.ts";');
  // (s) array of a nested DTO: each-form + @Type + pluralized array field.
  assertStringIncludes(
    c,
    "  @IsArray()\n  @ValidateNested({ each: true })\n  @Type(() => LineItemDto)\n  lineItems!: LineItemDto[];",
  );
  // [TYP] alias to a DTO resolves to the class (scalar form).
  assertStringIncludes(
    c,
    "  @ValidateNested()\n  @Type(() => PaymentDto)\n  payment!: PaymentDto;",
  );
  // pascal+Dto convention resolves too.
  assertStringIncludes(
    c,
    "  @ValidateNested()\n  @Type(() => AuditDto)\n  audit!: AuditDto;",
  );
});

Deno.test("planManifest — a property naming a DTO verbatim nests it", () => {
  const rune = `[MOD] pay

[TYP] sku: string
    s
[DTO] PaymentDto: sku
    pay info
[DTO] WrapDto: PaymentDto
    wraps a payment`;
  const plan = planManifest("specs/pay.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/pay/dto/wrap.ts");
  if (!dto) throw new Error("no wrap.ts generated");
  assertStringIncludes(
    dto.content,
    "  @ValidateNested()\n  @Type(() => PaymentDto)\n  PaymentDto!: PaymentDto;",
  );
  assertStringIncludes(dto.content, 'import { PaymentDto } from "@/src/pay/dto/payment.ts";');
});

// ---- regression: an exact [TYP] field must win over a same-stem [DTO] ----

// Bug report 2026-06-14 (Datrix): a [DTO] field whose name collides with the
// stem of an existing [DTO] (field `principal` <-> `PrincipalDto`) was generated
// as that nested DTO instead of resolving to its declared [TYP]. When the
// colliding DTO is the field's own container the result is self-referential
// (`PrincipalDto.principal!: PrincipalDto`) -> infinite @ValidateNested chain,
// green `deno check`, runtime 422. An exact `[TYP] <field>` must take precedence
// over the pascal+Dto convention.
Deno.test("planManifest — exact [TYP] beats a same-stem [DTO] (no self-nesting)", () => {
  const rune = `[MOD] demo

[REQ] access.resolve(PrincipalDto): OkDto
    [NEW] access
    access.run(PrincipalDto): OkDto
    access.toDto(): OkDto

[TYP] principal: string
    the console user id
[TYP] role: string
    one role the principal holds
[TYP] ok: boolean
    whether it resolved
[DTO] PrincipalDto: principal, role(s)
    a console user and the roles they hold
[DTO] OkDto: ok
    the result

[NON] access
    the resolver`;
  const plan = planManifest("specs/demo.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/demo/dto/principal.ts");
  if (!dto) throw new Error("no principal.ts generated");
  const c = dto.content;
  // `principal` is declared `[TYP] principal: string` -> primitive, validated.
  assertStringIncludes(c, "  @IsString()\n  principal!: string;");
  // It must NOT nest itself (the bug).
  assertEquals(c.includes("@Type(() => PrincipalDto)"), false);
  assertEquals(c.includes("principal!: PrincipalDto"), false);
});

// A [TYP] field (scalar and (s)-array) must beat a same-stem [DTO], while a
// genuinely-nested field (no [TYP], resolved by the pascal+Dto convention) in
// the SAME class still nests — the fix is precedence, not a blanket disable.
Deno.test("planManifest — [TYP] fields and a convention-nested field coexist", () => {
  const rune = `[MOD] cfg

[REQ] config.read(ScopeDto): OkDto
    [NEW] config
    config.run(ScopeDto): OkDto
    config.toDto(): OkDto

[TYP] scope: string
    the scope name
[TYP] role: string
    a role the scope grants
[TYP] ok: boolean
    result
[DTO] RoleDto: ok
    a same-stem [DTO] for the role field
[DTO] ScopeDto: scope, role(s), detail
    colliding scalar + colliding array + a genuine nested field
[DTO] DetailDto: ok
    a nested detail
[DTO] OkDto: ok
    result

[NON] config
    cfg`;
  const plan = planManifest("specs/cfg.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/cfg/dto/scope.ts");
  if (!dto) throw new Error("no scope.ts generated");
  const c = dto.content;
  // scalar collision: scope -> [TYP] string (not the self-named ScopeDto).
  assertStringIncludes(c, "  @IsString()\n  scope!: string;");
  // (s)-array collision: role(s) -> string[] (not RoleDto[]).
  assertStringIncludes(
    c,
    "  @IsArray()\n  @IsString({ each: true })\n  roles!: string[];",
  );
  // genuine nesting still works: detail has no [TYP] -> DetailDto by convention.
  assertStringIncludes(c, "  @ValidateNested()\n  @Type(() => DetailDto)\n  detail!: DetailDto;");
  // neither colliding [DTO] was nested.
  assertEquals(c.includes("@Type(() => ScopeDto)"), false);
  assertEquals(c.includes("@Type(() => RoleDto)"), false);
});

// ---- [TYP] constraint modifiers -> class-validator decorators ----

Deno.test("planManifest — [TYP] constraint modifiers become decorators; int replaces IsNumber", () => {
  const rune = `[MOD] inv

[TYP:uuid] id: string
    u
[TYP:nonempty] title: string
    t
[TYP:int] qty: number
    q
[TYP:min=0,max=100] score: number
    s
[TYP:positive] price: number
    p
[TYP:ext,uuid] memberId: string
    ext composes with constraints
[DTO] ItemDto: id, title, qty, score(s), price, memberId
    an item`;
  const plan = planManifest("specs/inv.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path === "src/inv/dto/item.ts");
  if (!dto) throw new Error("no item.ts generated");
  const c = dto.content;
  // string constraints compose with the base check.
  assertStringIncludes(c, "  @IsString()\n  @IsUUID()\n  id!: string;");
  assertStringIncludes(c, "  @IsString()\n  @IsNotEmpty()\n  title!: string;");
  // int REPLACES IsNumber.
  assertStringIncludes(c, "  @IsInt()\n  qty!: number;");
  assertEquals(c.includes("@IsNumber()\n  qty"), false);
  // min=0 each-form on an (s) array (0 must survive — falsy value).
  assertStringIncludes(
    c,
    "  @IsArray()\n  @IsNumber({ each: true })\n  @Min(0, { each: true })\n  @Max(100, { each: true })\n  scores!: number[];",
  );
  assertStringIncludes(c, "  @IsNumber()\n  @IsPositive()\n  price!: number;");
  // ext is placement-only; the uuid beside it still validates.
  assertStringIncludes(c, "  @IsString()\n  @IsUUID()\n  memberId!: string;");
  // sorted one-line union of everything used.
  assertStringIncludes(
    c,
    'import { IsArray, IsInt, IsNotEmpty, IsNumber, IsPositive, IsString, IsUUID, Max, Min } from "class-validator";',
  );
});

Deno.test("planManifest — a [TYP] aliasing a [DTO] imports the class it aliases", () => {
  const rune = `[MOD] pay

[TYP] sku: string
    s
[TYP] payment: PaymentDto
    alias to a module dto
[TYP] audit: AuditDto
    alias to a core dto
[DTO] PaymentDto: sku
    pay info
[DTO:core] AuditDto: sku
    shared`;
  const plan = planManifest("specs/pay.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const payment = plan.toCreate.find((f) => f.path === "src/pay/dto/payment.ts");
  // The DTO class wins the payment.ts slot (first writer); the alias files get
  // their own slots and import the class so the alias type-checks.
  assertStringIncludes(payment!.content, "export class PaymentDto");
  const audit = plan.toCreate.find((f) => f.path === "src/pay/dto/audit.ts");
  assertStringIncludes(audit!.content, 'import type { AuditDto } from "@/src/core/dto/audit.ts";');
  assertStringIncludes(audit!.content, "export type Audit = AuditDto;");
});

Deno.test("planManifest — renderTyp carries the modifiers in its declaration comment", () => {
  const rune = `[MOD] inv

[TYP:min=0,max=100] score: number
    a bounded score
[TYP] plain: string
    no modifiers`;
  const plan = planManifest("specs/inv.rune", rune, new Set());
  const score = plan.toCreate.find((f) => f.path === "src/inv/dto/score.ts");
  const plain = plan.toCreate.find((f) => f.path === "src/inv/dto/plain.ts");
  assertStringIncludes(score!.content, "// rune declares: [TYP:min=0,max=100] score: number");
  assertStringIncludes(plain!.content, "// rune declares: [TYP] plain: string");
});

// ---- coordinator weave: assert at every seam ----

const TASKS_RUNE = `[MOD] tasks

[REQ] task.create(CreateTaskDto): TaskDto
    db:task.load(id): TaskDto
    db:task.save(TaskDto): void

[DTO] CreateTaskDto: id, title
    in
[DTO] TaskDto: id, title
    the task

[TYP] id: string
    i
[TYP] title: string
    t`;

Deno.test("planManifest — coordinator weave: input/read/write/output asserts", () => {
  const plan = planManifest("specs/tasks.rune", TASKS_RUNE, new Set());
  assertEquals(plan.errors, []);
  const coord = plan.toCreate.find((f) =>
    f.path === "src/tasks/domain/coordinators/task-create/mod.ts"
  );
  if (!coord) throw new Error("no coordinator generated");
  const c = coord.content;
  // DTO classes are runtime contracts now: value imports + the assert runtime.
  assertStringIncludes(c, 'import { CreateTaskDto } from "@/src/tasks/dto/create-task.ts";');
  assertStringIncludes(c, 'import { TaskDto } from "@/src/tasks/dto/task.ts";');
  assertStringIncludes(c, 'import { assert } from "#assert";');
  assertEquals(c.includes("import type"), false);
  // input assert is the first statement; downstream reads use validInput.
  assertStringIncludes(
    c,
    'export async function create(input: CreateTaskDto): Promise<TaskDto> {\n  const validInput = assert(CreateTaskDto, input, "task.create input");',
  );
  assertStringIncludes(c, "  // reads — load inputs through the data adapters (validated at the seam)");
  assertStringIncludes(
    c,
    '  const taskLoad = assert(TaskDto, await taskData.load(validInput.id), "task.load");',
  );
  assertStringIncludes(c, "  const out = createCore(validInput, taskLoad);");
  assertStringIncludes(c, "  // writes — side effects through the data adapters (validated before they leave)");
  assertStringIncludes(
    c,
    '  await taskData.save(assert(TaskDto, out.save, "task.save input"));',
  );
  assertStringIncludes(c, '  return assert(TaskDto, out.result, "task.create output");');
  // the raw `input.` reference and the old blind cast are gone.
  assertEquals(c.includes("input.id"), false);
  assertEquals(/ as TaskDto/.test(c), false);
});

Deno.test("planManifest — coordinator weave: no reads / no writes omit their sections", () => {
  const noRead = `[MOD] m

[REQ] task.archive(ArchiveDto): ReceiptDto
    db:task.save(TaskDto): void

[DTO] ArchiveDto: id
    in
[DTO] TaskDto: id
    t
[DTO] ReceiptDto: id
    out
[TYP] id: string
    i`;
  const planA = planManifest("specs/m.rune", noRead, new Set());
  const a = planA.toCreate.find((f) => f.path.endsWith("task-archive/mod.ts"))!.content;
  assertEquals(a.includes("// reads"), false);
  assertStringIncludes(a, "  const out = archiveCore(validInput);");
  assertStringIncludes(a, '  await taskData.save(assert(TaskDto, out.save, "task.save input"));');

  const noWrite = `[MOD] m

[REQ] task.peek(PeekDto): TaskDto
    db:task.load(id): TaskDto

[DTO] PeekDto: id
    in
[DTO] TaskDto: id
    t
[TYP] id: string
    i`;
  const planB = planManifest("specs/m.rune", noWrite, new Set());
  const b = planB.toCreate.find((f) => f.path.endsWith("task-peek/mod.ts"))!.content;
  assertEquals(b.includes("// writes"), false);
  assertStringIncludes(b, '  const taskLoad = assert(TaskDto, await taskData.load(validInput.id), "task.load");');
  assertStringIncludes(b, '  return assert(TaskDto, out.result, "task.peek output");');
});

Deno.test("planManifest — coordinator weave: empty-output boundary is a write (no `as ;`)", () => {
  const rune = `[MOD] audit

[REQ] event.record(EventDto): ReceiptDto
    db:log.append(message)

[DTO] EventDto: message
    in
[DTO] ReceiptDto: message
    out
[TYP] message: string
    m`;
  const plan = planManifest("specs/audit.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const c = plan.toCreate.find((f) => f.path.endsWith("event-record/mod.ts"))!.content;
  // the proven invalid-TS shape is gone…
  assertEquals(c.includes("as ;"), false);
  // …replaced by a fire-and-forget write fed from the validated input.
  assertStringIncludes(c, "  // writes — side effects through the data adapters (validated before they leave)");
  assertStringIncludes(c, "  await logData.append(validInput.message);");
  // it contributes no read variable and no core-output field.
  assertEquals(c.includes("logAppend"), false);
  assertStringIncludes(c, "  const out = recordCore(validInput);");
  assertStringIncludes(c, "): { result: ReceiptDto } {");
});

Deno.test("planManifest — coordinator weave: primitive and opaque read seams", () => {
  const rune = `[MOD] geo

[REQ] place.find(FindDto): PlaceDto
    db:counter.next(): id
    ex:geo.lookup(query): GeoPoint

[DTO] FindDto: query
    in
[DTO] PlaceDto: query
    out
[TYP] id: string
    i
[TYP] query: string
    q`;
  const plan = planManifest("specs/geo.rune", rune, new Set());
  const c = plan.toCreate.find((f) => f.path.endsWith("place-find/mod.ts"))!.content;
  // [TYP] alias to a primitive: assert.<prim>, no cast — the alias IS the primitive.
  assertStringIncludes(c, '  const counterNext = assert.string(await counterData.next(), "counter.next");');
  // unresolvable named type keeps the cast, flagged as unvalidated.
  assertStringIncludes(
    c,
    '  const geoLookup = await geoData.lookup(validInput.query) as GeoPoint; // unvalidated: GeoPoint has no runtime contract',
  );
  // the core signature collapses the alias to its primitive.
  assertStringIncludes(c, "counterNext: string, geoLookup: GeoPoint");
});

// Bug report 2026-06-14 (Datrix) #2: a [REQ] whose noun has no instance steps
// (boundary-only / [RET] / pure namespace) still imported + `new`ed a
// business/<noun>/mod.ts that codegen never generates (business modules come
// only from instance steps) -> TS2307. The import + `new` must track the nouns
// that actually have instance steps, not the REQ noun unconditionally.
Deno.test("planManifest — boundary-only REQ noun emits no business import or `new`", () => {
  const rune = `[MOD] eng

[REQ] cache.read(InDto): OutDto
    db:store.fetch(InDto): OutDto
    [RET] OutDto

[REQ] report.build(InDto): OutDto
    [NEW] report
    report.compose(InDto): OutDto
    report.toDto(): OutDto

[TYP] id: string
    an id
[DTO] InDto: id
    in
[DTO] OutDto: id
    out`;
  const plan = planManifest("specs/eng.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const paths = plan.toCreate.map((f) => f.path);
  // codegen does NOT generate a business module for the namespace noun…
  assertEquals(paths.includes("src/eng/domain/business/cache/mod.ts"), false);
  // …so its coordinator must not import or instantiate one.
  const cache = plan.toCreate.find((f) => f.path.endsWith("cache-read/mod.ts"))!.content;
  assertEquals(cache.includes("domain/business/cache/mod.ts"), false);
  assertEquals(cache.includes("new Cache()"), false);
  assertEquals(/import \{ Cache \}/.test(cache), false);
  // the core still builds from inputs/reads.
  assertStringIncludes(cache, "  const out = readCore(validInput, storeFetch);");
  // the recipe lists the spec's non-boundary steps in order ([RET] here; the
  // db: fetch is the shell's read, not a core step).
  assertStringIncludes(cache, "  // Recipe from [REQ] cache.read (run in order):");
  assertStringIncludes(cache, "  //   1. [RET] OutDto");

  // a sibling REQ WITH an instance step DOES generate + use its business class.
  assertEquals(paths.includes("src/eng/domain/business/report/mod.ts"), true);
  const report = plan.toCreate.find((f) => f.path.endsWith("report-build/mod.ts"))!.content;
  assertStringIncludes(report, 'import { Report } from "@/src/eng/domain/business/report/mod.ts";');
  assertStringIncludes(report, "  const report = new Report();");
  // and the recipe walks [NEW] + the two instance steps in order.
  assertStringIncludes(report, "  //   1. [NEW] report");
  assertStringIncludes(report, "  //   2. report.compose(InDto): OutDto");
  assertStringIncludes(report, "  //   3. report.toDto(): OutDto");
});

Deno.test("planManifest — :core DTOs import from src/core/dto in coordinator + controller", () => {
  const rune = `[MOD] billing

[ENT] http.charge(ChargeDto): AuditDto

[REQ] charge.run(ChargeDto): AuditDto
    [NEW] charge
    [RET] AuditDto

[DTO] ChargeDto: amount
    in
[DTO:core] AuditDto: amount
    shared audit record
[TYP] amount: number
    a`;
  const plan = planManifest("specs/billing.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const coord = plan.toCreate.find((f) => f.path.endsWith("charge-run/mod.ts"))!.content;
  assertStringIncludes(coord, 'import { ChargeDto } from "@/src/billing/dto/charge.ts";');
  assertStringIncludes(coord, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
  const ctrl = plan.toCreate.find((f) => f.path === "src/billing/entrypoints/http/mod.ts")!.content;
  assertStringIncludes(ctrl, 'import { ChargeDto } from "@/src/billing/dto/charge.ts";');
  assertStringIncludes(ctrl, 'import { AuditDto } from "@/src/core/dto/audit.ts";');
});

// ---- typed stubs through the full plan ----

Deno.test("planManifest — adapter stubs are typed and Promise-wrapped", () => {
  const plan = planManifest("specs/tasks.rune", TASKS_RUNE, new Set());
  const adapter = plan.toCreate.find((f) =>
    f.path === "src/tasks/domain/data/task/mod.ts"
  );
  if (!adapter) throw new Error("no adapter generated");
  assertStringIncludes(adapter.content, 'import { TaskDto } from "@/src/tasks/dto/task.ts";');
  assertStringIncludes(adapter.content, "  load(id: string): Promise<TaskDto> {");
  assertStringIncludes(adapter.content, "  save(taskDto: TaskDto): Promise<void> {");
  assertStringIncludes(adapter.content, 'throw new Error("not implemented");');
});

Deno.test("planManifest — business stubs are typed and sync", () => {
  const rune = `[MOD] tasks

[REQ] task.create(CreateTaskDto): TaskDto
    task.build(title): TaskDto

[DTO] CreateTaskDto: title
    in
[DTO] TaskDto: title
    t
[TYP] title: string
    x`;
  const plan = planManifest("specs/tasks.rune", rune, new Set());
  const impl = plan.toCreate.find((f) =>
    f.path === "src/tasks/domain/business/task/mod.ts"
  );
  if (!impl) throw new Error("no business impl generated");
  assertStringIncludes(impl.content, "  build(title: string): TaskDto {");
  assertEquals(impl.content.includes("Promise<"), false);
});

// ---- dead templates removed (design §8) ----

Deno.test("DEFAULT_TEMPLATES — only the tpl()-honoring roles remain", () => {
  assertEquals(Object.keys(DEFAULT_TEMPLATES).sort(), [
    "adapter-smk-test",
    "coordinator-int-test",
    "mod-root",
    "poly-base-mod",
    "poly-base-test",
    "poly-impl-mod",
    "poly-impl-test",
    "poly-mod",
  ]);
});

// ---- WO-8: registry-driven lifecycle policy ----

Deno.test("planManifest — policy can flip a dev-owned role to regenerate", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id

[DTO] InDto: providerName
    desc`;
  // Default: business mod.ts is create-once (toCreate), never regenerated.
  const def = planManifest("specs/recording.rune", rune, new Set());
  assertEquals(
    def.toCreate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    true,
  );
  assertEquals(
    def.toRegenerate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    false,
  );

  // Override: business-impl -> regenerate. Now mod.ts is rewritten every run.
  const over = planManifest("specs/recording.rune", rune, new Set(), {
    policies: { "business-impl": { lifecycle: "regenerate" } },
  });
  assertEquals(
    over.toCreate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    false,
  );
  assertEquals(
    over.toRegenerate.some((f) =>
      f.path === "src/recording/domain/business/id/mod.ts"
    ),
    true,
  );
});

Deno.test("artifactToOptions — maps bindings, templates, and policies", () => {
  const artifact = {
    bindings: { "<name>": { from: ["DTO"], caseStyle: "kebab" } },
    codegen: {
      templates: { "dto": "BODY" },
      policies: {
        "business-impl": { lifecycle: "regenerate", prunable: false },
      },
    },
  } as unknown as Parameters<typeof artifactToOptions>[0];
  const opts = artifactToOptions(artifact);
  assertEquals(opts.codegen?.["dto"], "BODY");
  assertEquals(opts.policies?.["business-impl"], {
    lifecycle: "regenerate",
    prunable: false,
  });
  assertEquals(!!opts.bindings?.["<name>"], true);
});

Deno.test("planManifest — a plural producer turns the singular consumer into a $bind (list→item)", () => {
  const rune = `[MOD] metadata

[ENT] http.discover(DiscoverDto): CatalogDto
[ENT] http.enableRead(EnableDto): TableDto

[DTO] DiscoverDto: realm
    where to look
[DTO] CatalogDto: tableName(s)
    every discovered table
[DTO] EnableDto: tableName
    the table to track
[DTO] TableDto: trackedId
    the tracked table

[TYP] realm: string
    x
[TYP] tableName: string
    x
[TYP] trackedId: string
    x`;
  const plan = planManifest("specs/metadata.rune", rune, new Set());
  const mod = plan.toCreate.find((f) => f.path === "src/metadata/entrypoints/http/mod.ts");
  if (!mod) throw new Error("no entrypoint mod.ts generated");

  // discover outputs tableNames (plural); enableRead consumes tableName (singular).
  // keep's contract resolves $tableName from tableNames[0] — so the consumer gets
  // a $tableName bind instead of staying unwired (the list→item gap).
  assertStringIncludes(mod.content, 'bind: {"tableName":"$tableName"}');
});

Deno.test("planManifest — [TYP:example=…] emits @ApiProperty({ example }) on the DTO field", () => {
  const rune = `[MOD] shop

[ENT] http.order(OrderDto): TicketDto

[REQ] order.place(OrderDto): TicketDto
    [NEW] ticket
    ticket.toDto(): TicketDto

[DTO] OrderDto: item, qty
    what to buy
[DTO] TicketDto: ticketId
    the opened ticket

[TYP:example=widget] item: string
    a thing to buy
[TYP:example=3,min=1] qty: number
    how many
[TYP] ticketId: string
    x`;
  const plan = planManifest("specs/shop.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path === "src/shop/dto/order.ts");
  if (!dto) throw new Error("no order.ts DTO generated");

  // ONE merged @ApiProperty per field: description + example (string quoted,
  // number a numeric literal) + schema hints (min=1 -> minimum). The swagger
  // decorator import rides on the #api-doc alias.
  assertStringIncludes(
    dto.content,
    '@ApiProperty({ description: "a thing to buy", example: "widget" })',
  );
  assertStringIncludes(
    dto.content,
    '@ApiProperty({ description: "how many", example: 3, minimum: 1 })',
  );
  assertStringIncludes(dto.content, "@Min(1)");
  assertStringIncludes(dto.content, 'import { ApiProperty } from "#api-doc";');
});

Deno.test("planManifest — [TYP] vs same-stem [DTO] file collision: distinct files", () => {
  // [TYP] receipt and [DTO] ReceiptDto both kebab to dto/receipt.ts. The [DTO]
  // keeps the clean name; the [TYP] takes a `-type` suffix, so neither silently
  // clobbers the other (previously the [TYP] was dropped, breaking rune-typ-shape).
  const rune = `[MOD] shop

[REQ] order.read(RefDto): ReceiptDto
    db:order.load(RefDto): ReceiptDto

[DTO] RefDto: id
    a reference
[DTO] ReceiptDto: receipt
    a receipt

[TYP] id: string
    x
[TYP] receipt: string
    the receipt code`;
  const plan = planManifest("specs/shop.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const paths = [...plan.toCreate, ...plan.toRegenerate].map((f) => f.path);
  // Both files exist — the DTO at the clean stem, the TYP disambiguated.
  assertEquals(paths.includes("src/shop/dto/receipt.ts"), true);
  assertEquals(paths.includes("src/shop/dto/receipt-type.ts"), true);
  const typ = plan.toCreate.find((f) => f.path === "src/shop/dto/receipt-type.ts");
  assertStringIncludes(typ!.content, "export type Receipt = string;");
  const dto = plan.toCreate.find((f) => f.path === "src/shop/dto/receipt.ts");
  assertStringIncludes(dto!.content, "export class ReceiptDto");
});

Deno.test("planManifest — business test.ts scaffolds a Deno.test per untagged-step fault", () => {
  // Faults on UNTAGGED (business) steps must get a stub in business/<noun>/test.ts
  // (smk.test/int.test already do this for boundary/REQ faults) so rune-fault-
  // coverage has a case to verify instead of flagging an un-fillable gap.
  const rune = `[MOD] policy

[REQ] gate.evaluate(InputDto): OutputDto
    [NEW] gate
    gate.check(InputDto): OutputDto
      invalid-input
      out-of-range

[DTO] InputDto: id
    in
[DTO] OutputDto: id
    out

[TYP] id: string
    x`;
  const plan = planManifest("specs/policy.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const test = plan.toCreate.find((f) =>
    f.path === "src/policy/domain/business/gate/test.ts"
  );
  if (!test) throw new Error("no business test.ts generated");
  assertStringIncludes(test.content, 'Deno.test("invalid-input", () => {');
  assertStringIncludes(test.content, 'Deno.test("out-of-range", () => {');
});

Deno.test("planManifest — DTO/TYP fields carry description JSDoc + provenance", () => {
  const rune = `[MOD] shop

[REQ] order.make(MakeDto): MakeDto
    id::gen(): id

[DTO] MakeDto: id
    an order to make

[TYP:uuid] id: string
    the unique order id`;
  const plan = planManifest("specs/shop.rune", rune, new Set());
  const dto = plan.toCreate.find((f) => f.path.endsWith("dto/make.ts"))!;
  // field-level [TYP] description JSDoc + provenance (E23/E24)
  assertStringIncludes(dto.content, "/** the unique order id */");
  assertStringIncludes(dto.content, "// rune declares: [TYP:uuid] id: string");
  // class JSDoc + visibility + provenance (E26)
  assertStringIncludes(dto.content, " * an order to make");
  assertStringIncludes(dto.content, " * @internal");
  assertStringIncludes(dto.content, "// rune declares: [DTO] MakeDto: id");
  const typ = plan.toCreate.find((f) => f.path.endsWith("dto/id.ts"))!;
  // TYP alias JSDoc + enforced-decorator prose + line provenance (E29/E30)
  assertStringIncludes(typ.content, "/** the unique order id */");
  assertStringIncludes(typ.content, "// enforced on DTO fields: @IsUUID()");
  assertStringIncludes(typ.content, "shop.rune:9.");
});

Deno.test("planManifest — coordinator carries spec-line provenance + JSDoc", () => {
  // The coordinator header points at the [REQ]'s 1-based spec line (E1), and the
  // exported verb gets a JSDoc block with @param/@returns and one @throws per
  // declared fault, attributed to the step that raises it (E2).
  const rune = `[MOD] checkout

[REQ] order.create(NewOrderDto): OrderDto
    db:order.save(OrderDto): void
      timeout
    [RET] OrderDto

[DTO] NewOrderDto: item
    a new order to create
[DTO] OrderDto: id, item
    a created order

[TYP] item: string
    the item to order
[TYP] id: string
    the order id`;
  const plan = planManifest("specs/checkout.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const coord = [...plan.toCreate, ...plan.toRegenerate].find((f) =>
    f.path === "src/checkout/domain/coordinators/order-create/mod.ts"
  );
  if (!coord) throw new Error("no coordinator generated");
  // [REQ] is on line 3 (1-based).
  assertStringIncludes(coord.content, "from specs/checkout.rune:3.");
  assertStringIncludes(coord.content, "@param input NewOrderDto");
  assertStringIncludes(coord.content, "@returns OrderDto");
  assertStringIncludes(coord.content, "@throws timeout — raised by order.save");
});

Deno.test("planManifest — mod-root front-door doc + [MOD] desc + glossary (E10/E46)", () => {
  const rune = `[MOD] checkout: takes an order.

[REQ] order.create(NewOrderDto): OrderDto
    [NEW] order
    order.fill(item): order
    firebase:order.save(OrderDto): void
    [RET] OrderDto

[DTO] NewOrderDto: item
    a new order
[DTO] OrderDto: id, item
    a created order
[TYP] item: string
    the item to order
[TYP] id: string
    the order id
[NON] order
    a created order in flight

[SRV] (SDK)firebase: FIREBASE_API_KEY, FIREBASE_PROJECT_ID
    Firebase callable
    @docs https://firebase.google.com/docs/functions`;
  const plan = planManifest("checkout.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const mr = [...plan.toCreate, ...plan.toRegenerate].find((f) =>
    f.path.endsWith("mod-root.ts")
  )!;
  assertStringIncludes(mr.content, "// takes an order.");
  assertStringIncludes(mr.content, "// Domain nouns (from [NON]):");
  assertStringIncludes(mr.content, "//   order: a created order in flight");
  assertStringIncludes(mr.content, "// Type vocabulary (from [TYP]):");
  assertStringIncludes(mr.content, "//   item: string — the item to order");
  assertStringIncludes(mr.content, "// Backing services (shared, from src/core/core.rune):");
  assertStringIncludes(mr.content, "//   firebase (SDK): FIREBASE_API_KEY, FIREBASE_PROJECT_ID");
  // int-test carries the recipe with spec-line provenance (E33/E36)
  const it = [...plan.toCreate, ...plan.toRegenerate].find((f) =>
    f.path.endsWith("order-create/int.test.ts")
  )!;
  assertStringIncludes(it.content, "// Recipe (from [REQ] order.create @ checkout.rune:3):");
  assertStringIncludes(it.content, "//   2. order.fill(item): order");
});

Deno.test("planManifest — @ApiProperty stays within #api-doc's Schema type (E27 fix)", () => {
  // Regression: @ApiProperty must only use keys/values valid on @danet/swagger's
  // Schema — NO `required` (it's string[], not boolean), NO `isArray`, and
  // `format` only for valid DataFormat (uuid/email/uri are NOT — their
  // validators enforce them). Earlier these produced TS2322/2353 in real keep.
  const rune = `[MOD] shop

[REQ] order.make(MakeDto): MakeDto
    id::gen(): id

[DTO] MakeDto: id, tag?, label(s)
    an order

[TYP:uuid] id: string
    the id
[TYP:email] tag: string
    a contact tag
[TYP] label: string
    a label`;
  const plan = planManifest("shop.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const dto = plan.toCreate.find((f) => f.path.endsWith("dto/make.ts"))!.content;
  // uuid field: @IsUUID enforces it; @ApiProperty carries NO invalid format.
  assertStringIncludes(dto, "@IsUUID()");
  assertEquals(dto.includes('format: "uuid"'), false);
  assertEquals(dto.includes('format: "email"'), false);
  // optional + array must NOT leak the non-Schema keys.
  assertEquals(dto.includes("required: false"), false);
  assertEquals(dto.includes("isArray: true"), false);
});

Deno.test("planManifest — read boundary consuming a core-built DTO runs post-core (TS2345 fix)", () => {
  // cdn:doc.distribute(ManifestDto): DocDto — distribute returns the REQ output
  // AND consumes a ManifestDto built mid-flow (Manifest::build). It must run
  // AFTER the core, fed from out.manifestDto; loading it pre-core passed the
  // request input (PubReqDto) where ManifestDto was expected (a type error).
  const rune = `[MOD] pub

[REQ] doc.publish(PubReqDto): DocDto
    Manifest::build(PubReqDto): ManifestDto
    cdn:doc.distribute(ManifestDto): DocDto

[DTO] PubReqDto: id
    a request
[DTO] ManifestDto: id
    a manifest
[DTO] DocDto: id
    a doc
[TYP] id: string
    an id`;
  const plan = planManifest("pub.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const c = [...plan.toCreate, ...plan.toRegenerate].find((f) =>
    f.path.endsWith("coordinators/doc-publish/mod.ts")
  )!.content;
  // the boundary runs AFTER the core, fed the asserted core-built DTO
  assertStringIncludes(c, "// core — pure business logic");
  assertStringIncludes(c, "assert(ManifestDto, out.manifestDto");
  // it produces the result → returned directly (not out.result)
  assertStringIncludes(c, "return docDistribute;");
  assertEquals(c.includes("out.result"), false);
  // the core produces the consumed DTO, not a bogus result
  assertStringIncludes(c, "manifestDto: ManifestDto");
  // and the wrong-typed pre-core load is GONE
  assertEquals(c.includes("distribute(validInput)"), false);
});

Deno.test("planManifest — a noun that is BOTH [PLY] and a boundary keeps its adapter methods (TS2339 fix)", () => {
  // gw is polymorphic for auth ([PLY]) AND a plain boundary for capture. The
  // data adapter must still carry capture() — deleting the whole poly noun left
  // an empty Gateway class and the coordinator's gwData.capture() failed (TS2339).
  const rune = `[MOD] pay

[REQ] charge.run(ReqDto): OutDto
    [PLY] gw.auth(ReqDto): OutDto
        [CSE] visa
            svc:gw.authVisa(ReqDto): OutDto

[REQ] settle.go(ReqDto): OutDto
    svc:gw.capture(ReqDto): OutDto

[DTO] ReqDto: id
    a request
[DTO] OutDto: id
    an out
[TYP] id: string
    an id
[NON] gw
    the gateway`;
  const plan = planManifest("pay.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const adapter = plan.toCreate.find((f) =>
    f.path.endsWith("domain/data/gw/mod.ts")
  );
  if (!adapter) throw new Error("no gw data adapter generated");
  // both the [PLY]-case boundary and the standalone boundary land on the adapter
  assertStringIncludes(adapter.content, "capture(reqDto: ReqDto)");
  assertStringIncludes(adapter.content, "authVisa(reqDto: ReqDto)");
  // and NO concrete business class for the poly noun (it gets a base/variants)
  assertEquals(
    plan.toCreate.some((f) => f.path.endsWith("domain/business/gw/mod.ts")),
    false,
  );
});

Deno.test("planManifest — core.rune generates shared service clients", () => {
  const rune = `[MOD] core
[SRV] (SIDECAR)db: DB_URL
    the datastore
    @docs https://docs.example.com/db
[SRV] (HTTP)ex: EX_BASE_URL
    external http
    @docs https://example.com/api`;
  const plan = planManifest("src/core/core.rune", rune, new Set());
  assertEquals(plan.errors, []);
  const all = [...plan.toCreate, ...plan.toRegenerate, ...plan.toSkip];
  const db = all.find((f) => f.path === "src/core/data/db/mod.ts");
  assert(db !== undefined);
  assertStringIncludes(db!.content, "export class DbService {");
  assertStringIncludes(db!.content, "db (transport SIDECAR) — env: DB_URL");
  assertStringIncludes(db!.content, "@see https://docs.example.com/db");
  const ex = all.find((f) => f.path === "src/core/data/ex/mod.ts");
  assert(ex !== undefined);
  assertStringIncludes(ex!.content, "export class ExService {");
});

Deno.test("planManifest — module spec resolves boundary services from sharedSrvs", () => {
  const sharedSrvs = new Map<string, SrvNode>([
    ["db", {
      transport: "SIDECAR",
      name: "db",
      envVars: ["DB_URL"],
      description: "datastore",
      docsLink: "https://x",
      line: 0,
    }],
  ]);
  const rune = `[MOD] tasks
[REQ] task.create(InDto): OutDto
    db:task.save(InDto): void
    [RET] OutDto
[DTO] InDto: id
    x
[DTO] OutDto: id
    y
[TYP] id: string
    z`;
  const plan = planManifest("src/tasks/tasks.rune", rune, new Set(), {}, sharedSrvs);
  assertEquals(plan.errors, []);
  const all = [...plan.toCreate, ...plan.toRegenerate, ...plan.toSkip];
  // The module does NOT emit the shared client — only core.rune does.
  assertEquals(all.some((f) => f.path.startsWith("src/core/data/")), false);
  // Its data adapter imports + constructs the shared client.
  const adapter = all.find((f) => f.path === "src/tasks/domain/data/task/mod.ts");
  assert(adapter !== undefined);
  assertStringIncludes(
    adapter!.content,
    'import { DbService } from "@/src/core/data/db/mod.ts";',
  );
  assertStringIncludes(adapter!.content, "new DbService()");
  // mod-root lists the shared service it references.
  const mr = all.find((f) => f.path === "src/tasks/mod-root.ts");
  assertStringIncludes(mr!.content, "Backing services (shared, from src/core/core.rune):");
  assertStringIncludes(mr!.content, "db (SIDECAR): DB_URL");
});

Deno.test("planManifest — strictServices errors on an undeclared boundary service", () => {
  const rune = `[MOD] catalog
[REQ] product.add(InDto): OutDto
    cache:product.save(InDto): void
    [RET] OutDto
[DTO] InDto: id
    x
[DTO] OutDto: id
    y
[TYP] id: string
    z`;
  // Raw codegen (no strictServices) tolerates an undeclared service.
  assertEquals(
    planManifest("src/catalog/catalog.rune", rune, new Set()).errors,
    [],
  );
  // strictServices (what check/sync/manifest set) makes it a hard error.
  const strict = planManifest("src/catalog/catalog.rune", rune, new Set(), {
    strictServices: true,
  });
  assert(strict.errors.some((e) => e.includes('undeclared service "cache"')));
  // Declaring it via core.rune (sharedSrvs) clears the error.
  const shared = new Map<string, SrvNode>([
    ["cache", {
      transport: "SIDECAR",
      name: "cache",
      envVars: ["CACHE_URL"],
      description: "",
      docsLink: "https://x",
      line: 0,
    }],
  ]);
  assertEquals(
    planManifest("src/catalog/catalog.rune", rune, new Set(), {
      strictServices: true,
    }, shared).errors,
    [],
  );
});
