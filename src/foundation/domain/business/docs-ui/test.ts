import { assertEquals, assertStringIncludes } from "#assert";
import { Hono } from "#hono";
import {
  createDocsJsonHandler,
  docsSeedScript,
  injectDocsScript,
  swaggerShellHtml,
} from "./mod.ts";
import { signToken } from "@foundation/domain/business/token/mod.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

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

const SPEC = JSON.stringify({ openapi: "3.0.0", info: { title: "t", version: "1" } });
const KEY = "docs-signing-key";
const INTERNAL = "internal-key";

function jsonApp(trustLocalhost?: boolean) {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const app = new Hono();
  app.get(
    "/docs/app/json",
    createDocsJsonHandler({
      specJson: SPEC,
      signingKey: KEY,
      internalKey: INTERNAL,
      logger,
      trustLocalhost,
    }),
  );
  const at = (hostname?: string, init?: RequestInit, query = "") => {
    const env = hostname === undefined ? undefined : { remoteAddr: { hostname } };
    return app.fetch(new Request(`http://app/docs/app/json${query}`, init), env);
  };
  return { at };
}

Deno.test("docs json: localhost callers need no token", async () => {
  const res = await jsonApp().at("127.0.0.1");
  assertEquals(res.status, 200);
  assertEquals((await res.json()).openapi, "3.0.0");
});

Deno.test("docs json: in-process callers (internal key) need no token", async () => {
  const res = await jsonApp().at("203.0.113.4", {
    headers: { [INTERNAL_REQUEST_HEADER]: INTERNAL },
  });
  assertEquals(res.status, 200);
});

Deno.test("docs json: network callers without a token get 401", async () => {
  const res = await jsonApp().at("203.0.113.4");
  assertEquals(res.status, 401);
});

Deno.test("docs json: trustLocalhost:false requires a token from localhost too", async () => {
  const app = jsonApp(false);
  assertEquals((await app.at("127.0.0.1")).status, 401);
  const token = await signToken({ source: "docs", appName: "test", expiry: 4_102_444_800 }, KEY);
  assertEquals((await app.at("127.0.0.1", undefined, `?token=${token}`)).status, 200);
});

Deno.test("docs json: network callers authorize with a ?token", async () => {
  const token = await signToken({ source: "docs", appName: "test", expiry: 4_102_444_800 }, KEY);
  const res = await jsonApp().at("203.0.113.4", undefined, `?token=${token}`);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).openapi, "3.0.0");
});

Deno.test("docs json: network callers authorize with an Authorization header", async () => {
  const token = await signToken({ source: "docs", appName: "test", expiry: 4_102_444_800 }, KEY);
  const res = await jsonApp().at("203.0.113.4", { headers: { authorization: `Bearer ${token}` } });
  assertEquals(res.status, 200);
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
