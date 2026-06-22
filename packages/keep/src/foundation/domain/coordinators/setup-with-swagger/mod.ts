import type { Server } from "@foundation/domain/business/server/mod.ts";
import { DanetHttpAdapter } from "@foundation/domain/data/http-adapter/mod.ts";

export class SwaggerSetup {
  private readonly filters: string[];

  constructor(...filters: string[]) {
    this.filters = filters;
  }

  async setup(server: Server) {
    // Lazy-load the Swagger builder (pulls CJS handlebars/openapi3-ts) only when docs are
    // actually built — keeps those out of every consumer's static graph (e.g. Vite SSR).
    const { SwaggerBuilder } = await import(
      "@foundation/domain/business/swagger-builder/mod.ts"
    );
    const builder = new SwaggerBuilder(...this.filters);
    const { docsIndexHtml, swaggerDocs } = await builder.build(server);
    const adapter = new DanetHttpAdapter();
    for (const { path, doc } of swaggerDocs) {
      adapter.registerSwaggerDocument(`/docs${path}`, doc);
    }
    adapter.registerRoute("get", "/docs", () =>
      new Response(docsIndexHtml, {
        headers: { "Content-Type": "text/html" },
      }));
    return adapter;
  }
}

export async function setupWithSwagger(
  server: Server,
  ...filters: string[]
): Promise<DanetHttpAdapter> {
  return new SwaggerSetup(...filters).setup(server);
}
