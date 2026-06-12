import "#reflect-metadata";
import { getMetadataStorage } from "class-validator";
import type { Server } from "@foundation/domain/business/server/mod.ts";
import type { Type } from "@types";
import { Crawler } from "@foundation/domain/business/crawler/mod.ts";
import { DanetDocumentBuilder } from "@foundation/domain/business/document-builder/mod.ts";
import { IndexPageBuilder } from "@foundation/domain/business/index-page-builder/mod.ts";

/**
 * @danet/swagger only honors its own `@Optional()` decorator when computing a
 * schema's `required` array — plain class-validator DTOs (everything rune
 * generates) mark optionality with `@IsOptional()`, which it never reads, so
 * every property lands in `required`. That lie cascades: the emulator trusts
 * `required` to decide which fields belong in a default request body, so
 * optional numbers prefill as 0 and immediately fail their own validation.
 * Collect the truth from class-validator's metadata storage (keyed by class
 * name — the same name the $refs use) so build() can repair the documents.
 */
export function optionalPropsByClassName(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  // `validationMetadatas` is TS-private but runtime-stable: a Map of
  // target constructor -> ValidationMetadata[].
  const storage = getMetadataStorage() as unknown as {
    validationMetadatas: Map<
      unknown,
      Array<{ type: string; propertyName: string }>
    >;
  };
  for (const [target, metas] of storage.validationMetadatas.entries()) {
    const name = typeof target === "function" ? target.name : String(target);
    for (const m of metas) {
      if (m.type !== "conditionalValidation") continue; // @IsOptional marker
      if (!out.has(name)) out.set(name, new Set());
      out.get(name)!.add(m.propertyName);
    }
  }
  return out;
}

/** Strip class-validator-optional properties from every schema's `required`. */
export function honorOptionalProps(
  doc: unknown,
  optionals: Map<string, Set<string>>,
): void {
  const schemas = (doc as {
    components?: { schemas?: Record<string, { required?: string[] }> };
  }).components?.schemas;
  if (!schemas) return;
  for (const [name, schema] of Object.entries(schemas)) {
    const opt = optionals.get(name);
    if (!opt || !Array.isArray(schema.required)) continue;
    schema.required = schema.required.filter((p) => !opt.has(p));
    if (schema.required.length === 0) delete schema.required;
  }
}

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
    // class-validator @IsOptional is as authoritative as @Optional() — see
    // optionalPropsByClassName above. (Entries are {doc, path} wrappers.)
    const optionals = optionalPropsByClassName();
    swaggerDocs.forEach((entry) => honorOptionalProps(entry.doc, optionals));
    // Index from the CRAWLED modules, not server.moduleNames — the server only
    // registers the root module, so an imported module would get a /docs/<name>
    // page but no card on the index.
    // The system map link is relative for the same mount-prefix reason as the cards above.
    const docsIndexHtml = this.indexPageBuilder.build(
      allModules.map((m) => m.name),
      { mapHref: "docs/_map" },
    );
    return { swaggerDocs, docsIndexHtml };
  }
}
