import { assertEquals, assertExists } from "#assert";
import { Module } from "#danet/core";
import { Crawler } from "./mod.ts";

Deno.test("constructs a Crawler", () => {
  assertExists(new Crawler());
});

Deno.test("it should get all import constructors from a module", () => {
  @Module({})
  class ImportedModuleA {}

  @Module({})
  class ImportedModuleC {}

  @Module({
    imports: [ImportedModuleA, ImportedModuleC],
  })
  class ImportedModuleB {}

  const crawler = new Crawler();
  const imports = crawler.getModuleImports(ImportedModuleB);
  assertEquals(imports.length, 2);
  assertEquals(imports, [ImportedModuleA, ImportedModuleC]);
});

Deno.test("it should crawl all modules", () => {
  @Module({})
  class ImportedModuleA {}

  @Module({
    imports: [ImportedModuleA],
  })
  class ImportedModuleC {}

  @Module({
    imports: [ImportedModuleA, ImportedModuleC],
  })
  class ImportedModuleB {}

  const crawler = new Crawler();
  const allModules = crawler.crawl([ImportedModuleB]);
  assertEquals(allModules.length, 3);
  assertEquals(allModules, [ImportedModuleB, ImportedModuleA, ImportedModuleC]);
});

Deno.test("it dedups a module reached via multiple import paths (Set-based)", () => {
  @Module({})
  class Shared {}

  @Module({ imports: [Shared] })
  class Left {}

  @Module({ imports: [Shared] })
  class Right {}

  @Module({ imports: [Left, Right] })
  class Root {}

  // Shared is imported by both Left and Right but must appear exactly once.
  const allModules = new Crawler().crawl([Root]);
  assertEquals(allModules.length, 4);
  assertEquals(allModules.filter((m) => m === Shared).length, 1);
});

Deno.test("it terminates on a circular import instead of recursing forever", () => {
  @Module({})
  class A {}

  @Module({ imports: [A] })
  class B {}

  // Close the cycle A→B (B already imports A) so crawl would loop without dedup.
  Reflect.defineMetadata("module", { imports: [B] }, A);

  const allModules = new Crawler().crawl([A]);
  assertEquals(allModules.length, 2);
  assertEquals(new Set(allModules), new Set([A, B]));
});
