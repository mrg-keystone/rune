import "#reflect-metadata";
import { assertEquals, assertStringIncludes } from "#assert";
import { setupWithSwagger } from "./mod.ts";
import { SwaggerBuilder } from "@foundation/domain/business/swagger-builder/mod.ts";
import { Server } from "@foundation/domain/business/server/mod.ts";

// Simple test modules - no @Module decorator needed for Server.registerModule.
// ChildModule is reachable only through TestModule's imports, mirroring a real
// root module that wires feature modules.
class ChildModule {}
Reflect.defineMetadata("module", {}, ChildModule);
class TestModule {}
Reflect.defineMetadata("module", { imports: [ChildModule] }, TestModule);

Deno.test(
  "SwaggerBuilder - builds swagger docs and index page from server modules",
  async () => {
    const server = Server.create();
    server.registerModule(TestModule);
    const builder = new SwaggerBuilder();
    const { swaggerDocs, docsIndexHtml } = await builder.build(server);

    // TestModule is a pure composition wrapper (imports, no controllers) — it is
    // skipped; only the imported feature module is documented.
    assertEquals(swaggerDocs.length, 1);
    assertEquals(swaggerDocs[0].path, "/child");
    assertEquals(swaggerDocs[0].doc.info.title, "Child");
    assertEquals(swaggerDocs[0].doc.info.version, "1.0");
    assertEquals(swaggerDocs[0].doc.openapi, "3.0.3");

    assertStringIncludes(docsIndexHtml, "<html");
    // Imported modules get an index card; the wrapper does not.
    assertStringIncludes(docsIndexHtml, 'href="docs/child"');
    assertEquals(docsIndexHtml.includes('href="docs/test"'), false);
  },
);

Deno.test(
  "setupWithSwagger - registers swagger doc and index route",
  async () => {
    const server = Server.create();
    server.registerModule(TestModule);
    const adapter = await setupWithSwagger(server);

    const routes = adapter.app.router.routes;
    const getPaths = routes
      .filter((r: { method: string }) => r.method === "GET")
      .map((r: { path: string }) => r.path);

    assertEquals(getPaths.includes("/docs"), true);
    // The imported feature module is routed; the controller-less wrapper is not.
    assertEquals(getPaths.includes("/docs/child"), true);
    assertEquals(getPaths.includes("/docs/test"), false);
  },
);
