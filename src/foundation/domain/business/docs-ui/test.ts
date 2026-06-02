import { assertEquals, assertStringIncludes } from "#assert";
import { docsSeedScript, injectDocsScript, swaggerShellHtml } from "./mod.ts";

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

Deno.test("swaggerShellHtml builds a page that loads the spec with the token and wipes on 401", () => {
  const html = swaggerShellHtml("API · users");
  assertStringIncludes(html, "<html");
  assertStringIncludes(html, "swagger-ui");
  // fetches <currentPath>/json
  assertStringIncludes(html, '"/json"');
  // attaches the bearer token from storage
  assertStringIncludes(html, 'req.headers["Authorization"] = "Bearer " + t');
  // wipes the token on a 401
  assertStringIncludes(html, "res.status === 401");
  assertStringIncludes(html, "window.__danetDocs.wipe()");
  // title is escaped/rendered
  assertStringIncludes(html, "API · users");
});
