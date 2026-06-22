import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#assert";
import { SwaggerBuilder } from "./mod.ts";
import { Server } from "@foundation/domain/business/server/mod.ts";

class TestModule {}
Reflect.defineMetadata("module", {}, TestModule);

Deno.test("SwaggerBuilder - builds swagger docs and index page from server", async () => {
  const server = Server.create();
  server.registerModule(TestModule);

  const builder = new SwaggerBuilder();
  const { swaggerDocs, docsIndexHtml } = await builder.build(server);

  assertEquals(swaggerDocs.length, 1);
  assertEquals(swaggerDocs[0].path, "/test");
  assertEquals(swaggerDocs[0].doc.info.title, "Test");
  assertEquals(swaggerDocs[0].doc.info.version, "1.0");
  assertStringIncludes(docsIndexHtml, "<html");
  assertStringIncludes(docsIndexHtml, "Test");
  // Mount-relative so the index works at "/docs" standalone and "/api/docs" under Fresh.
  assertStringIncludes(docsIndexHtml, 'href="docs/test"');
});

Deno.test("SwaggerBuilder - respects filters", async () => {
  class ModuleA {}
  Reflect.defineMetadata("module", {}, ModuleA);
  class ModuleB {}
  Reflect.defineMetadata("module", {}, ModuleB);

  const server = Server.create();
  server.registerModule(ModuleA);
  server.registerModule(ModuleB);

  const builder = new SwaggerBuilder("ModuleB");
  const { swaggerDocs } = await builder.build(server);

  assertEquals(swaggerDocs.length, 1);
  assertEquals(swaggerDocs[0].doc.info.title, "ModuleA");
});

Deno.test("SwaggerBuilder - concurrent multi-module build leaves console.log intact", async () => {
  // Regression: build() inits one throwaway facade per module CONCURRENTLY, and each init
  // silences console.log. With per-call save/restore the second facade captured the first's
  // no-op as its "original" and restored that — console.log stayed dead for the host app.
  class LogModuleA {}
  Reflect.defineMetadata("module", {}, LogModuleA);
  class LogModuleB {}
  Reflect.defineMetadata("module", {}, LogModuleB);

  const server = Server.create();
  server.registerModule(LogModuleA);
  server.registerModule(LogModuleB);

  const original = console.log;
  const { swaggerDocs } = await new SwaggerBuilder().build(server);

  assertEquals(swaggerDocs.length, 2);
  assertEquals(
    console.log,
    original,
    "console.log must be restored to the host app's original after the concurrent facade inits",
  );
});

Deno.test("required honors class-validator @IsOptional", async () => {
  const { IsInt, IsOptional, IsString } = await import("class-validator");
  class OptionalProbeDto {
    @IsString()
    name!: string;
    @IsOptional()
    @IsInt()
    limit?: number;
  }
  // keep the class referenced so the decorators actually run
  void OptionalProbeDto;

  const { honorOptionalProps, optionalPropsByClassName } = await import(
    "./mod.ts"
  );
  const optionals = optionalPropsByClassName();
  assertEquals(optionals.get("OptionalProbeDto")?.has("limit"), true);

  const doc = {
    components: {
      schemas: {
        OptionalProbeDto: { required: ["name", "limit"] },
        Untouched: { required: ["x"] },
      },
    },
  };
  honorOptionalProps(doc, optionals);
  assertEquals(doc.components.schemas.OptionalProbeDto.required, ["name"]);
  assertEquals(doc.components.schemas.Untouched.required, ["x"]);
});
