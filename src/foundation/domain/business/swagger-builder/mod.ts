import "#reflect-metadata";
import type { Server } from "@foundation/domain/business/server/mod.ts";
import type { Type } from "@types";
import { Crawler } from "@foundation/domain/business/crawler/mod.ts";
import { DanetDocumentBuilder } from "@foundation/domain/business/document-builder/mod.ts";
import { IndexPageBuilder } from "@foundation/domain/business/index-page-builder/mod.ts";

export class SwaggerBuilder {
  private crawler: Crawler;
  private documentBuilder: DanetDocumentBuilder;
  private indexPageBuilder: IndexPageBuilder;

  constructor(...filters: string[]) {
    this.crawler = new Crawler(...filters);
    this.documentBuilder = new DanetDocumentBuilder();
    // particleCount left at the builder's modest default — 100 just bloated every rendered page.
    // Relative prefix: the index is served at "/docs" standalone and "/api/docs" mounted under
    // Fresh, and "docs/app" resolves correctly from both — "/docs/app" would escape the mount.
    this.indexPageBuilder = new IndexPageBuilder({
      prefix: "docs/",
    });
  }

  async build(server: Server) {
    // Skip pure composition wrappers (imports but no controllers of their own — e.g. the
    // appModule() root): they have nothing to document and would render an empty card.
    const allModules = this.crawler.crawl(server.modules).filter((m: Type) => {
      const meta = Reflect.getMetadata("module", m) as
        | { imports?: unknown[]; controllers?: unknown[] }
        | undefined;
      const isWrapper = (meta?.imports?.length ?? 0) > 0 &&
        (meta?.controllers?.length ?? 0) === 0;
      return !isWrapper;
    });
    const specs = allModules.map((m: Type) =>
      this.documentBuilder.createSpec(m)
    );
    const docs$ = specs.map((s) => this.documentBuilder.createDocument(s));
    const swaggerDocs = await Promise.all(docs$);
    // Index from the CRAWLED modules, not server.moduleNames — the server only
    // registers the root module, so an imported module would get a /docs/<name>
    // page but no card on the index.
    const docsIndexHtml = this.indexPageBuilder.build(
      allModules.map((m) => m.name),
    );
    return { swaggerDocs, docsIndexHtml };
  }
}
