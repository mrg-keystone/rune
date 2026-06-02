import { assertEquals } from "#std/assert";
import { artifactToOptions, planManifest } from "./mod.ts";

Deno.test("planManifest — coordinator + DTO + TYP for a simple rune", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id

[DTO] InDto: providerName, externalId
    desc

[TYP] id: string
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
  // mod-root
  assertEquals(paths.includes("src/recording/mod-root.ts"), true);
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
    plan.toSkip.includes(
      "src/recording/domain/coordinators/recording-set/mod.ts",
    ),
    true,
  );
  assertEquals(
    plan.toSkip.includes("src/recording/domain/business/id/mod.ts"),
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

Deno.test("planManifest — DTO file has Zod schema with each property", () => {
  const rune = `[MOD] recording

[DTO] GetRecordingDto: providerName, externalId
    input dto`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const dto = plan.toCreate.find((f) =>
    f.path.endsWith("dto/get-recording.ts")
  );
  assertEquals(dto !== undefined, true);
  assertEquals(dto!.content.includes("z.object"), true);
  assertEquals(dto!.content.includes("providerName"), true);
  assertEquals(dto!.content.includes("externalId"), true);
});

Deno.test("planManifest — mod-root re-exports each REQ verb", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id


[REQ] recording.get(InDto): OutDto
    id::create(name): id`;
  const plan = planManifest("specs/recording.rune", rune, new Set());
  const modRoot = plan.toCreate.find((f) =>
    f.path === "src/recording/mod-root.ts"
  );
  assertEquals(modRoot !== undefined, true);
  assertEquals(modRoot!.content.includes("export { set }"), true);
  assertEquals(modRoot!.content.includes("export { get }"), true);
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

// ---- WO-8: registry-driven lifecycle policy ----

Deno.test("planManifest — policy can flip a dev-owned role to regenerate", () => {
  const rune = `[MOD] recording

[REQ] recording.set(InDto): OutDto
    id::create(name): id

[DTO] InDto: providerName
    desc`;
  // Default: business mod.ts is create-once (toCreate), sig.ts regenerates.
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
  // sig.ts is unaffected — still regenerates.
  assertEquals(
    over.toRegenerate.some((f) =>
      f.path === "src/recording/domain/business/id/sig.ts"
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
