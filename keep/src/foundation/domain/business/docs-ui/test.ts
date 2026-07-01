import { assertEquals, assertStringIncludes } from "#assert";
import { Hono } from "#hono";
import {
  createDocsJsonHandler,
  docsSeedScript,
  injectDocsScript,
  swaggerShellHtml,
} from "./mod.ts";
import { createJwksVerifier } from "@foundation/domain/business/token/mod.ts";
import { createTestSigner } from "@foundation/domain/business/token/session.testkit.ts";
import { INTERNAL_REQUEST_HEADER } from "@foundation/domain/business/backend-client/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

const signer = await createTestSigner();
const verifier = createJwksVerifier({
  fetchJwks: () => Promise.resolve(signer.jwks),
});
/** A bearer for the "app" app carrying the given app-grants (comma-separated). */
const bearerFor = (appGrants?: string) =>
  signer.sign({
    source: "docs",
    claims: appGrants ? { app: appGrants } : {},
  });

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
const INTERNAL = "internal-key";

function jsonApp() {
  const logger = new Logger();
  logger.configure({ appName: "test" });
  const app = new Hono();
  app.get(
    "/docs/app/json",
    createDocsJsonHandler({
      specJson: SPEC,
      verifier,
      appName: "app",
      internalKey: INTERNAL,
      logger,
    }),
  );
  const at = (init?: RequestInit, query = "") =>
    app.fetch(new Request(`http://app/docs/app/json${query}`, init));
  return { at };
}

Deno.test("docs json: the in-process client (internal key) bypasses the gate", async () => {
  const res = await jsonApp().at({
    headers: { [INTERNAL_REQUEST_HEADER]: INTERNAL },
  });
  assertEquals(res.status, 200);
  assertEquals((await res.json()).openapi, "3.0.0");
});

Deno.test("docs json: a network caller without a token gets 401", async () => {
  const res = await jsonApp().at();
  assertEquals(res.status, 401);
});

Deno.test("docs json: a bearer WITHOUT a dev/* grant is denied (401)", async () => {
  const token = await bearerFor("read"); // holds a grant, but not dev/*
  const res = await jsonApp().at({
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 401);
});

Deno.test("docs json: a dev-grant bearer authorizes via ?token", async () => {
  const token = await bearerFor("dev");
  const res = await jsonApp().at(undefined, `?token=${token}`);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).openapi, "3.0.0");
});

Deno.test("docs json: a dev-grant bearer authorizes via the Authorization header", async () => {
  const token = await bearerFor("dev");
  const res = await jsonApp().at({
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);
});

Deno.test("docs json: a `*` skeleton-grant bearer authorizes too", async () => {
  const token = await bearerFor("*");
  const res = await jsonApp().at({
    headers: { authorization: `Bearer ${token}` },
  });
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
