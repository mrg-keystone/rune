import { assertEquals, assertStringIncludes } from "#assert";
import { Hono } from "#hono";
import { createMintUi } from "./mod.ts";
import { verifyToken } from "@foundation/domain/business/token/mod.ts";
import { Logger } from "@foundation/domain/business/logger/mod.ts";

const KEY = "mint-test-key";

function app(signingKey = KEY) {
  const logger = new Logger();
  logger.configure({ appName: "billing" });
  const ui = createMintUi({ appName: "billing", signingKey, logger });
  const hono = new Hono();
  hono.get("/_mint", ui.form);
  hono.post("/_mint", ui.mint);
  // Drive Hono with conn info in `env`, exactly as Deno.serve does. Default: loopback peer.
  return (req: Request, hostname = "127.0.0.1") =>
    logger.runInRequest("r", () => hono.fetch(req, { remoteAddr: { hostname } }));
}

const future = 4_102_444_800;

Deno.test("GET serves the form on localhost", async () => {
  const res = await app()(new Request("http://localhost/_mint"));
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "Mint access token");
});

Deno.test("non-localhost requests are forbidden", async () => {
  const form = await app()(new Request("http://host/_mint"), "203.0.113.7");
  assertEquals(form.status, 403);

  const body = new FormData();
  body.set("source", "x");
  body.set("expiry", String(future));
  const post = await app()(
    new Request("http://host/_mint", { method: "POST", body }),
    "203.0.113.7",
  );
  assertEquals(post.status, 403);
});

Deno.test("POST mints a verifiable token", async () => {
  const body = new FormData();
  body.set("source", "ci-runner");
  body.set("appName", "billing");
  body.set("expiry", String(future));

  const res = await app()(new Request("http://localhost/_mint", { method: "POST", body }));
  assertEquals(res.status, 200);

  const page = await res.text();
  const token = page.match(/<pre>([^<]+)<\/pre>/)?.[1];
  assertEquals(typeof token, "string");
  assertEquals(await verifyToken(token!, KEY), {
    source: "ci-runner",
    appName: "billing",
    expiry: future,
  });
});

Deno.test("POST validates source and expiry", async () => {
  const body = new FormData();
  body.set("source", "");
  body.set("expiry", "not-a-number");
  const res = await app()(new Request("http://localhost/_mint", { method: "POST", body }));
  assertEquals(res.status, 400);
});

Deno.test("POST without a signing key fails closed", async () => {
  const body = new FormData();
  body.set("source", "ci");
  body.set("expiry", String(future));
  const res = await app("")(new Request("http://localhost/_mint", { method: "POST", body }));
  assertEquals(res.status, 500);
});
