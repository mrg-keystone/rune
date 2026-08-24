import { assertEquals, assertStringIncludes } from "#assert";
import { Hono } from "#hono";
import {
  createDocsJsonHandler,
  docsSeedScript,
  injectDocsScript,
  swaggerShellHtml,
} from "./mod.ts";

Deno.test("docsSeedScript seeds from ?token, stores, strips, and exposes helpers", () => {
  const js = docsSeedScript();
  assertStringIncludes(js, "danet_docs_token");
  assertStringIncludes(js, 'searchParams.get("token")');
  assertStringIncludes(js, "localStorage.setItem");
  assertStringIncludes(js, "history.replaceState");
  assertStringIncludes(js, "window.__danetDocs");
});

Deno.test("injectDocsScript inserts the seed script before </body>", () => {
  const out = injectDocsScript("<html><body><h1>Docs</h1></body></html>");
  assertStringIncludes(out, "<script>");
  assertStringIncludes(out, "window.__danetDocs");
  // inserted before the closing body tag
  assertEquals(out.indexOf("</script>") < out.indexOf("</body>"), true);
});

Deno.test("injectDocsScript appends when there is no </body>", () => {
  const out = injectDocsScript("<h1>no body tag</h1>");
  assertStringIncludes(out, "window.__danetDocs");
});

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "t", version: "1" },
});

function jsonApp() {
  const app = new Hono();
  app.get("/docs/app/json", createDocsJsonHandler({ specJson: SPEC }));
  const at = (init?: RequestInit, query = "") =>
    app.fetch(new Request(`http://app/docs/app/json${query}`, init));
  return { at };
}

Deno.test("docs json: the spec is served openly (zero built-in auth)", async () => {
  const res = await jsonApp().at();
  assertEquals(res.status, 200);
  assertEquals((await res.json()).openapi, "3.0.0");
});

Deno.test("docs json: a stray legacy ?token is harmless", async () => {
  const res = await jsonApp().at(undefined, "?token=stale-legacy-token");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).openapi, "3.0.0");
});

Deno.test("swaggerShellHtml builds a page that loads the spec (legacy token plumbing inert)", () => {
  const html = swaggerShellHtml("API · users");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "swagger-ui");
  // fetches <currentPath>/json
  assertStringIncludes(html, '"/json"');
  // title is escaped/rendered
  assertStringIncludes(html, "API · users");
});
